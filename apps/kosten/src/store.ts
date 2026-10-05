import { create } from 'zustand';
import type { Kosten, KostenPosition, Project } from '@core/model';
import { createProject } from '@core/model';
import { parseProjectData } from '@core/serialize';
import { logger } from '@core/platform/log';

/**
 * Zustand der Kostenermittlung: das Projekt im gemeinsamen Format (.oap/.akhp) – Gebäude, Geschosse und
 * Flächen kommen aus dem Flächenrechner bzw. der IFC, Kostenpositionen und Kostenstände pflegt dieses Tool.
 */

const log = logger('projekt');
const HISTORY = 100;

interface KostenState {
  project: Project;
  /** Dateiname beim letzten Öffnen/Speichern */
  datei: string | null;
  /** Projekt beim letzten Öffnen/Speichern – Grundlage fürs Zusammenführen mit der Datei (siehe zusammenfuehren.ts) */
  basis: Project | null;
  dirty: boolean;
  past: Project[];
  future: Project[];

  /** basis: Stand der Datei, aus der das Projekt stammt (null bei IFC-Import bzw. neuem Projekt) */
  load: (p: Project, datei?: string | null, basis?: Project | null) => void;
  update: (fn: (p: Project) => Project) => void;
  undo: () => void;
  redo: () => void;
  /** nach dem Speichern: Dateiname und das gespeicherte (ggf. mit der Datei zusammengeführte) Projekt */
  markSaved: (datei: string, gespeichert: Project) => void;
}

export const useKosten = create<KostenState>()((set, get) => ({
  project: createProject('Neues Projekt'),
  datei: null,
  basis: null,
  dirty: false,
  past: [],
  future: [],

  load: (p, datei = null, basis = null) => {
    log.info(`Projekt geladen: ${p.name}`, { geschosse: p.storeys.length, positionen: p.kosten?.positionen.length ?? 0 });
    set({ project: p, datei, basis, dirty: false, past: [], future: [] });
  },
  update: (fn) => {
    const { project, past } = get();
    const next = fn(project);
    if (next === project) return;
    set({ project: next, past: [...past, project].slice(-HISTORY), future: [], dirty: true });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], past: [...past, project], future: future.slice(1), dirty: true });
  },
  markSaved: (datei, gespeichert) => {
    // Änderungen anderer Apps aus der Datei übernommen: neuer Ausgangspunkt, alte Schritte passen nicht mehr
    if (gespeichert !== get().project) set({ project: gespeichert, past: [], future: [] });
    set({ dirty: false, datei, basis: gespeichert });
  },
}));

/* ---------- Änderungen am Projekt ---------- */

const leer = (): Kosten => ({ positionen: [] });

export function setKosten(p: Project, patch: Partial<Kosten>): Project {
  const next: Kosten = { ...(p.kosten ?? leer()), ...patch };
  for (const k of Object.keys(next) as (keyof Kosten)[]) if (next[k] === undefined) delete next[k];
  return { ...p, kosten: next };
}

export function mapPosition(p: Project, id: string, fn: (x: KostenPosition) => KostenPosition): Project {
  return setKosten(p, { positionen: (p.kosten?.positionen ?? []).map((x) => (x.id === id ? fn(x) : x)) });
}

/** Positionen anhängen; nach Kostengruppe einsortiert (stabil) */
export function addPositionen(p: Project, neu: KostenPosition[]): Project {
  const alle = [...(p.kosten?.positionen ?? []), ...neu];
  return setKosten(p, { positionen: alle.map((x, i) => ({ x, i })).sort((a, b) => a.x.kg.localeCompare(b.x.kg) || a.i - b.i).map(({ x }) => x) });
}

export function removePosition(p: Project, id: string): Project {
  return setKosten(p, { positionen: (p.kosten?.positionen ?? []).filter((x) => x.id !== id) });
}

/* ---------- Zwischenspeicher (IndexedDB) ---------- */

const DB = 'kostenermittlung';
const STORE = 'autosave';
const KEY = 'projekt';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

if (typeof indexedDB !== 'undefined') {
  void db()
    .then(
      (d) =>
        new Promise<unknown>((resolve, reject) => {
          const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
    )
    .then((raw) => {
      const st = useKosten.getState();
      if (!raw || st.dirty || st.past.length) return;
      const r = raw as { project: unknown; datei: string | null; basis?: unknown };
      st.load(parseProjectData(r.project), r.datei, r.basis ? parseProjectData(r.basis) : null);
    })
    .catch(() => {
      // kein Zwischenstand
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  useKosten.subscribe((s, prev) => {
    if (s.project === prev.project && s.basis === prev.basis) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { project, datei, basis } = useKosten.getState();
      void db()
        .then((d) => d.transaction(STORE, 'readwrite').objectStore(STORE).put({ project, datei, basis }, KEY))
        .catch(() => undefined);
    }, 600);
  });
}
