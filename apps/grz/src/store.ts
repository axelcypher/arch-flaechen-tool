import { create } from 'zustand';
import type { LageplanFlaeche, MassNutzung, Project } from '@core/model';
import { createProject } from '@core/model';
import { parseProjectData } from '@core/serialize';
import { logger } from '@core/platform/log';

/**
 * Zustand des GRZ-Nachweises: das Projekt im gemeinsamen Format (.oap/.akhp) – Gebäude und Geschosse
 * kommen aus dem Flächenrechner bzw. der IFC, Lageplan und Festsetzungen pflegt dieses Tool.
 */

const log = logger('projekt');
const HISTORY = 100;

export type Werkzeug = 'auswahl' | 'polygon' | 'rechteck';

interface GrzState {
  project: Project;
  /** Dateiname beim letzten Öffnen/Speichern */
  datei: string | null;
  /** Projekt beim letzten Öffnen/Speichern – Grundlage fürs Zusammenführen mit der Datei (siehe zusammenfuehren.ts) */
  basis: Project | null;
  dirty: boolean;
  past: Project[];
  future: Project[];
  /** ausgewählte Lageplan-Fläche */
  selected: string | null;
  werkzeug: Werkzeug;

  /** basis: Stand der Datei, aus der das Projekt stammt (null bei IFC-Import bzw. neuem Projekt) */
  load: (p: Project, datei?: string | null, basis?: Project | null) => void;
  update: (fn: (p: Project) => Project) => void;
  undo: () => void;
  redo: () => void;
  /** nach dem Speichern: Dateiname und das gespeicherte (ggf. mit der Datei zusammengeführte) Projekt */
  markSaved: (datei: string, gespeichert: Project) => void;
  select: (id: string | null) => void;
  setWerkzeug: (w: Werkzeug) => void;
}

export const useGrz = create<GrzState>()((set, get) => ({
  project: createProject('Neues Projekt'),
  datei: null,
  basis: null,
  dirty: false,
  past: [],
  future: [],
  selected: null,
  werkzeug: 'auswahl',

  load: (p, datei = null, basis = null) => {
    log.info(`Projekt geladen: ${p.name}`, { geschosse: p.storeys.length, lageplan: p.lageplan?.flaechen.length ?? 0 });
    set({ project: p, datei, basis, dirty: false, past: [], future: [], selected: null, werkzeug: 'auswahl' });
  },
  update: (fn) => {
    const { project, past } = get();
    const next = fn(project);
    if (next === project) return;
    set({ project: next, past: [...past, project].slice(-HISTORY), future: [], dirty: true });
    const sel = get().selected;
    if (sel && !next.lageplan?.flaechen.some((f) => f.id === sel)) set({ selected: null });
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
  select: (id) => set({ selected: id }),
  setWerkzeug: (w) => set({ werkzeug: w }),
}));

/* ---------- Änderungen am Projekt ---------- */

export function setMassNutzung(p: Project, patch: Partial<MassNutzung>): Project {
  const next: MassNutzung = { ...(p.massNutzung ?? {}), ...patch };
  for (const k of Object.keys(next) as (keyof MassNutzung)[]) if (next[k] === undefined) delete next[k];
  return { ...p, massNutzung: next };
}

export function mapFlaeche(p: Project, id: string, fn: (f: LageplanFlaeche) => LageplanFlaeche): Project {
  const flaechen = p.lageplan?.flaechen ?? [];
  return { ...p, lageplan: { ...p.lageplan, flaechen: flaechen.map((f) => (f.id === id ? fn(f) : f)) } };
}

export function addFlaeche(p: Project, f: LageplanFlaeche): Project {
  return { ...p, lageplan: { ...p.lageplan, flaechen: [...(p.lageplan?.flaechen ?? []), f] } };
}

export function removeFlaeche(p: Project, id: string): Project {
  return { ...p, lageplan: { ...p.lageplan, flaechen: (p.lageplan?.flaechen ?? []).filter((f) => f.id !== id) } };
}

/* ---------- Zwischenspeicher (IndexedDB) ---------- */

const DB = 'grz-nachweis';
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
      const st = useGrz.getState();
      if (!raw || st.dirty || st.past.length) return;
      const r = raw as { project: unknown; datei: string | null; basis?: unknown };
      st.load(parseProjectData(r.project), r.datei, r.basis ? parseProjectData(r.basis) : null);
    })
    .catch(() => {
      // kein Zwischenstand
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  useGrz.subscribe((s, prev) => {
    if (s.project === prev.project && s.basis === prev.basis) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { project, datei, basis } = useGrz.getState();
      void db()
        .then((d) => d.transaction(STORE, 'readwrite').objectStore(STORE).put({ project, datei, basis }, KEY))
        .catch(() => undefined);
    }, 600);
  });
}
