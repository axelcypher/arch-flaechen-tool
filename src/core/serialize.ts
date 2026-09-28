import type { Background, Nutzungsgruppe, Project, RasterBackground, Shape, Storey, VectorBackground, WoflKategorie } from './model';
import { createProject, newId } from './model';
import { NUTZUNGSGRUPPEN, WOFL_KATEGORIEN } from './norms';

export const FILE_EXTENSION = 'flaeche.json';

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

export class ProjectFormatError extends Error {}

/**
 * Liest eine Projektdatei ein, ergänzt fehlende Felder mit Standardwerten
 * und prüft die Grundstruktur. Späteren Formatversionen dient das als Migrationspunkt.
 */
export function parseProject(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProjectFormatError('Die Datei ist kein gültiges JSON.');
  }
  if (!isObj(raw) || raw.format !== 'arch-flaechen-tool') {
    throw new ProjectFormatError('Die Datei ist keine Projektdatei des Flächenrechners.');
  }
  if (raw.version !== 1) {
    throw new ProjectFormatError(`Nicht unterstützte Dateiversion: ${String(raw.version)}`);
  }
  const base = createProject();
  const storeysRaw = Array.isArray(raw.storeys) ? raw.storeys : [];
  const project: Project = {
    format: 'arch-flaechen-tool',
    version: 1,
    name: str(raw.name, base.name),
    meta: { ...base.meta, ...(isObj(raw.meta) ? raw.meta : {}) } as Project['meta'],
    settings: { ...base.settings, ...(isObj(raw.settings) ? raw.settings : {}) } as Project['settings'],
    storeys: storeysRaw.filter(isObj).map(normalizeStorey),
  };
  if (project.storeys.length === 0) project.storeys = base.storeys;
  return project;
}

function normalizeStorey(s: Record<string, unknown>): Storey {
  const shapes = (Array.isArray(s.shapes) ? s.shapes : []).filter(isObj).map(normalizeShape).filter((x): x is Shape => x !== null);
  const storey: Storey = {
    id: str(s.id, newId('st')),
    name: str(s.name, 'Geschoss'),
    hoehe: num(s.hoehe, 3),
    shapes,
  };
  const bg = normalizeBackground(s.background);
  if (bg) storey.background = bg;
  return storey;
}

function normalizeShape(s: Record<string, unknown>): Shape | null {
  const points = (Array.isArray(s.points) ? s.points : [])
    .filter(isObj)
    .map((p) => ({ x: num(p.x, NaN), y: num(p.y, NaN) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < 3) return null;
  const common = {
    id: str(s.id, newId('sh')),
    name: str(s.name, ''),
    points,
    subtract: s.subtract === true,
    umschliessung: s.umschliessung === 'S' ? ('S' as const) : ('R' as const),
    bemerkung: typeof s.bemerkung === 'string' ? s.bemerkung : undefined,
  };
  if (s.kind === 'outline') {
    return { ...common, kind: 'outline', hoehe: typeof s.hoehe === 'number' ? s.hoehe : undefined };
  }
  if (s.kind === 'room') {
    const w = isObj(s.wofl) ? s.wofl : {};
    return {
      ...common,
      kind: 'room',
      nummer: str(s.nummer, ''),
      nutzung: oneOf<Nutzungsgruppe>(s.nutzung, NUTZUNGSGRUPPEN.map((n) => n.id), 'NUF1'),
      wofl: {
        kategorie: oneOf<WoflKategorie>(w.kategorie, WOFL_KATEGORIEN.map((k) => k.id), 'keine'),
        faktor: typeof w.faktor === 'number' ? w.faktor : undefined,
        wohnung: str(w.wohnung, ''),
      },
    };
  }
  return null;
}

function normalizeBackground(b: unknown): Background | undefined {
  if (!isObj(b)) return undefined;
  const base = { name: str(b.name, 'Plan'), x: num(b.x, 0), y: num(b.y, 0), opacity: num(b.opacity, 0.6), visible: b.visible !== false };
  // Version 0.1: Rasterbilder ohne "type"
  if ((b.type === 'raster' || b.type === undefined) && typeof b.dataUrl === 'string') {
    const r: RasterBackground = {
      ...base,
      type: 'raster',
      dataUrl: b.dataUrl,
      widthPx: num(b.widthPx, 1),
      heightPx: num(b.heightPx, 1),
      metersPerPixel: num(b.metersPerPixel, 0.01),
    };
    if (isObj(b.pdf)) r.pdf = { page: num(b.pdf.page, 1), metersPerPixelAt1: num(b.pdf.metersPerPixelAt1, 0) };
    return r;
  }
  if (b.type === 'vector' && Array.isArray(b.polylines) && Array.isArray(b.layers)) {
    return {
      ...base,
      type: 'vector',
      scale: num(b.scale, 1),
      layers: b.layers.filter(isObj).map((l) => ({ name: str(l.name, '0'), color: str(l.color, '#333333'), visible: l.visible !== false })),
      polylines: b.polylines as VectorBackground['polylines'],
      texts: Array.isArray(b.texts) ? (b.texts as VectorBackground['texts']) : [],
    };
  }
  return undefined;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], d: T): T {
  return allowed.includes(v as T) ? (v as T) : d;
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown, d: string): string {
  return typeof v === 'string' ? v : d;
}
function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
