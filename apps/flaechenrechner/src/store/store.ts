import { create } from 'zustand';
import type { Point } from '@core/geometry';
import type { Project, Shape, ShapeKind, Storey } from '@core/model';
import { createProject, createStorey, newId } from '@core/model';
import { parseProject, parseProjectData } from '@core/serialize';
import { logger } from '@core/platform/log';

const log = logger('autosave');

export type Tool = 'select' | 'polygon' | 'rect' | 'detect' | 'measure' | 'calibrate';

/** Importiertes IFC-Modell zur Anzeige in der 3D-Ansicht (nur für die Sitzung, nicht im Projekt gespeichert) */
export type { IfcReference } from '@core/platform/ifc';
import type { IfcReference } from '@core/platform/ifc';

export interface DetectSettings {
  /** größte zu schließende Öffnung in m (Türbreite) */
  gap: number;
  /** Bögen/Kreise aus DXF ignorieren (Türaufschläge) */
  skipArcs: boolean;
  /** Helligkeitsschwelle 0–255 für Rasterpläne */
  threshold: number;
  /** dünne Linien in Rasterplänen (Türaufschläge, Möbel) ignorieren, sofern der Raum geschlossen bleibt */
  ignoreThin: boolean;
}

export interface ViewOptions {
  showOutlines: boolean;
  showRooms: boolean;
  showBackground: boolean;
  showGhost: boolean;
  showDimensions: boolean;
  snapGrid: boolean;
  snapVertices: boolean;
}

const HISTORY_LIMIT = 200;
const AUTOSAVE_KEY = 'arch-flaechen-tool:autosave';

interface EditorState {
  project: Project;
  /** Projekt beim letzten Öffnen/Speichern – Grundlage fürs Zusammenführen mit der Datei (siehe zusammenfuehren.ts) */
  basis: Project | null;
  past: Project[];
  future: Project[];
  /** true, wenn seit dem letzten Speichern geändert */
  dirty: boolean;
  activeStoreyId: string;
  selectedShapeId: string | null;
  tool: Tool;
  drawKind: ShapeKind;
  view: ViewOptions;
  /** Zähler, um der Zeichenfläche "Zoom auf alles" zu signalisieren */
  fitRequest: number;
  reportOpen: boolean;
  excelOpen: boolean;
  detect: DetectSettings;
  mainView: '2d' | '3d';
  ifcModel: IfcReference | null;

  /** Änderung mit Undo-Schritt */
  update: (fn: (p: Project) => Project) => void;
  /** Änderung ohne Undo-Schritt (z. B. während Ziehen – vorher checkpoint() aufrufen) */
  updateSilent: (fn: (p: Project) => Project) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;

  /** basis: Stand der Datei, aus der das Projekt stammt (null bei neuem Projekt) */
  loadProject: (p: Project, basis?: Project | null) => void;
  newProject: () => void;
  /** nach dem Speichern: das gespeicherte (ggf. mit der Datei zusammengeführte) Projekt */
  markSaved: (gespeichert: Project) => void;

  setActiveStorey: (id: string) => void;
  select: (id: string | null) => void;
  setTool: (t: Tool) => void;
  setDrawKind: (k: ShapeKind) => void;
  setView: (v: Partial<ViewOptions>) => void;
  requestFit: () => void;
  setReportOpen: (open: boolean) => void;
  setExcelOpen: (open: boolean) => void;
  setMainView: (v: '2d' | '3d') => void;
  setIfcModel: (m: IfcReference | null) => void;
  setDetect: (d: Partial<DetectSettings>) => void;
}

export const useEditor = create<EditorState>((set, get) => {
  const initial = loadAutosave() ?? createProject();
  return {
    project: initial,
    basis: null,
    past: [],
    future: [],
    dirty: false,
    activeStoreyId: initial.storeys[0].id,
    selectedShapeId: null,
    tool: 'select',
    drawKind: 'outline',
    view: {
      showOutlines: true,
      showRooms: true,
      showBackground: true,
      showGhost: false,
      showDimensions: true,
      snapGrid: true,
      snapVertices: true,
    },
    fitRequest: 1,
    reportOpen: false,
    excelOpen: false,
    detect: loadDetectSettings(),
    mainView: '2d',
    ifcModel: null,

    update: (fn) => {
      const { project, past } = get();
      const next = fn(project);
      if (next === project) return;
      set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [], dirty: true });
      fixSelection(set, get);
    },
    updateSilent: (fn) => {
      const next = fn(get().project);
      set({ project: next, dirty: true });
    },
    checkpoint: () => {
      const { project, past } = get();
      set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
    },
    undo: () => {
      const { past, project, future } = get();
      if (!past.length) return;
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true });
      fixSelection(set, get);
    },
    redo: () => {
      const { past, project, future } = get();
      if (!future.length) return;
      set({ project: future[0], past: [...past, project], future: future.slice(1), dirty: true });
      fixSelection(set, get);
    },

    loadProject: (p, basis = null) => {
      set({
        project: p,
        basis,
        past: [],
        future: [],
        dirty: false,
        activeStoreyId: p.storeys[0].id,
        selectedShapeId: null,
        tool: 'select',
        fitRequest: get().fitRequest + 1,
        ifcModel: null,
      });
    },
    newProject: () => get().loadProject(createProject()),
    markSaved: (gespeichert) => {
      // Änderungen anderer Apps aus der Datei übernommen: neuer Ausgangspunkt, alte Schritte passen nicht mehr
      if (gespeichert !== get().project) set({ project: gespeichert, past: [], future: [] });
      set({ basis: gespeichert, dirty: false });
      fixSelection(set, get);
    },

    setActiveStorey: (id) => set({ activeStoreyId: id, selectedShapeId: null }),
    select: (id) => set({ selectedShapeId: id }),
    setTool: (t) => set({ tool: t }),
    setDrawKind: (k) => set({ drawKind: k }),
    setView: (v) => set({ view: { ...get().view, ...v } }),
    requestFit: () => set({ fitRequest: get().fitRequest + 1 }),
    setReportOpen: (open) => set({ reportOpen: open }),
    setExcelOpen: (open) => set({ excelOpen: open }),
    setMainView: (v) => set({ mainView: v }),
    setIfcModel: (m) => set({ ifcModel: m }),
    setDetect: (d) => {
      const detect = { ...get().detect, ...d };
      set({ detect });
      try {
        localStorage.setItem(DETECT_KEY, JSON.stringify(detect));
      } catch {
        // ignorieren
      }
    },
  };
});

function fixSelection(set: (s: Partial<EditorState>) => void, get: () => EditorState) {
  const { project, activeStoreyId, selectedShapeId } = get();
  const storey = project.storeys.find((s) => s.id === activeStoreyId) ?? project.storeys[0];
  const patch: Partial<EditorState> = {};
  if (storey.id !== activeStoreyId) patch.activeStoreyId = storey.id;
  if (selectedShapeId && !storey.shapes.some((s) => s.id === selectedShapeId)) patch.selectedShapeId = null;
  if (Object.keys(patch).length) set(patch);
}

/* ---------- Selektoren ---------- */

export function useActiveStorey(): Storey {
  return useEditor((s) => s.project.storeys.find((st) => st.id === s.activeStoreyId) ?? s.project.storeys[0]);
}

export function useSelectedShape(): Shape | null {
  return useEditor((s) => {
    const st = s.project.storeys.find((x) => x.id === s.activeStoreyId);
    return st?.shapes.find((sh) => sh.id === s.selectedShapeId) ?? null;
  });
}

/* ---------- Reine Projekt-Transformationen ---------- */

export function mapStorey(p: Project, storeyId: string, fn: (s: Storey) => Storey): Project {
  return { ...p, storeys: p.storeys.map((s) => (s.id === storeyId ? fn(s) : s)) };
}

export function mapShape(p: Project, storeyId: string, shapeId: string, fn: (s: Shape) => Shape): Project {
  return mapStorey(p, storeyId, (st) => ({ ...st, shapes: st.shapes.map((sh) => (sh.id === shapeId ? fn(sh) : sh)) }));
}

export function setShapePoints(p: Project, storeyId: string, shapeId: string, points: Point[]): Project {
  return mapShape(p, storeyId, shapeId, (s) => ({ ...s, points }));
}

export function addStorey(p: Project, name: string): { project: Project; id: string } {
  const last = p.storeys[p.storeys.length - 1];
  const st = createStorey(name, last?.hoehe ?? 3);
  return { project: { ...p, storeys: [...p.storeys, st] }, id: st.id };
}

/** Kopiert ein Geschoss inkl. aller Flächen (neue IDs), z. B. für Regelgeschosse. */
export function duplicateStorey(p: Project, storeyId: string): { project: Project; id: string } {
  const idx = p.storeys.findIndex((s) => s.id === storeyId);
  if (idx < 0) return { project: p, id: storeyId };
  const src = p.storeys[idx];
  const copy: Storey = {
    ...structuredClone(src),
    id: newId('st'),
    name: `${src.name} (Kopie)`,
  };
  copy.shapes = copy.shapes.map((s) => ({ ...s, id: newId('sh') }));
  const storeys = [...p.storeys];
  storeys.splice(idx + 1, 0, copy);
  return { project: { ...p, storeys }, id: copy.id };
}

export function removeStorey(p: Project, storeyId: string): Project {
  if (p.storeys.length <= 1) return p;
  return { ...p, storeys: p.storeys.filter((s) => s.id !== storeyId) };
}

export function moveStorey(p: Project, storeyId: string, delta: -1 | 1): Project {
  const i = p.storeys.findIndex((s) => s.id === storeyId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= p.storeys.length) return p;
  const storeys = [...p.storeys];
  [storeys[i], storeys[j]] = [storeys[j], storeys[i]];
  return { ...p, storeys };
}

/** Nächste freie Raumnummer im Geschoss, z. B. "0.03". */
export function nextRoomNumber(p: Project, storey: Storey): string {
  const idx = p.storeys.findIndex((s) => s.id === storey.id);
  const rooms = storey.shapes.filter((s) => s.kind === 'room').length;
  return `${Math.max(0, idx)}.${String(rooms + 1).padStart(2, '0')}`;
}

/* ---------- Einstellungen & Autosave ---------- */

const DETECT_KEY = 'arch-flaechen-tool:detect';

function loadDetectSettings(): DetectSettings {
  const d: DetectSettings = { gap: 1.1, skipArcs: true, threshold: 200, ignoreThin: true };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(DETECT_KEY) ?? '{}') };
  } catch {
    return d;
  }
}

/** Mitgespeichertes IFC-Modell im Hintergrund wieder für die 3D-Ansicht aufbereiten */
export async function restoreIfcModel(p: Project) {
  const ifc = p.dateien?.filter((d) => d.art === 'ifc').pop();
  if (!ifc) return;
  try {
    const { loadIfc, ifcReference } = await import('@core/platform/ifc');
    const x = await loadIfc(ifc.daten.slice());
    if (useEditor.getState().project === p) useEditor.getState().setIfcModel(ifcReference(x, ifc.name));
  } catch {
    // nur Anzeige – das Projekt selbst ist vollständig geladen
  }
}

/*
 * Autosave in IndexedDB (deutlich mehr Platz als localStorage – wichtig bei Planbildern).
 * Beim Start wird der letzte Stand asynchron geladen, solange noch nichts bearbeitet wurde.
 */

const DB_NAME = 'arch-flaechen-tool';
const STORE = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function loadAutosave(): Project | null {
  // Altbestand aus localStorage (Version 0.1) – wird beim nächsten Speichern nach IndexedDB übernommen
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? parseProject(raw) : null;
  } catch {
    return null;
  }
}

if (typeof indexedDB !== 'undefined') {
  idbGet(AUTOSAVE_KEY)
    .then((raw) => {
      const st = useEditor.getState();
      if (!raw || st.past.length || st.dirty) return;
      // bis 0.2 als JSON-Text, bis 0.10 als Projekt, seither mit Basis fürs Zusammenführen
      const mitBasis = typeof raw === 'object' && raw !== null && 'project' in raw ? (raw as { project: unknown; basis: unknown }) : null;
      const p = typeof raw === 'string' ? parseProject(raw) : parseProjectData(mitBasis ? mitBasis.project : raw);
      st.loadProject(p, mitBasis?.basis ? parseProjectData(mitBasis.basis) : null);
      void restoreIfcModel(p);
      log.info('Zwischenstand wiederhergestellt', { name: p.name, geschosse: p.storeys.length });
    })
    .catch((e) => {
      // kein Autosave vorhanden oder nicht lesbar
      log.warn('Zwischenstand konnte nicht gelesen werden', e);
    });
}

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  if (s.project === prev.project && s.basis === prev.basis) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const { project, basis } = useEditor.getState();
    idbSet(AUTOSAVE_KEY, { project, basis })
      .then(() => {
        try {
          localStorage.removeItem(AUTOSAVE_KEY);
        } catch {
          // ignorieren
        }
      })
      .catch((e) => {
        // Autosave ist nur ein Komfortmerkmal
        log.warn('Zwischenspeichern fehlgeschlagen', e);
      });
  }, 600);
});
