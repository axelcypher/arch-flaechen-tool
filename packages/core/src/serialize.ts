import type {
  Anschrift,
  Background,
  DateiArt,
  Grundstueck,
  KontaktArt,
  LageplanFlaeche,
  LageplanNutzung,
  MassNutzung,
  Nutzungsgruppe,
  Project,
  ProjectMeta,
  ProjektDatei,
  RasterBackground,
  Shape,
  Storey,
  VectorBackground,
  Versiegelung,
  WoflKategorie,
} from './model';
import { anschriftAusText, createProject, newId } from './model';
import { NUTZUNGSGRUPPEN, WOFL_KATEGORIEN } from './norms';
import type { Gaube, GaubenTyp } from './gaube';
import type { Dach, DachTyp } from './roof';
import { DACH_TYPEN } from './roof';

/** Reine JSON-Fassung (ohne mitgespeicherte Originaldateien – dafür das Projektarchiv, siehe archive.ts) */
export function serializeProject(p: Project): string {
  const { dateien: _, ...rest } = p;
  return JSON.stringify(rest, null, 2);
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
  return parseProjectData(raw);
}

/** Wie parseProject, aber für bereits gelesene Daten (Archiv, Autosave mit Originaldateien als Uint8Array) */
export function parseProjectData(raw: unknown): Project {
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
    meta: normalizeMeta(raw.meta),
    settings: { ...base.settings, ...(isObj(raw.settings) ? raw.settings : {}) } as Project['settings'],
    // Lageplan-Geschosse aus 0.7.0 gehören nicht zum Gebäude – ihre Flächen wandern in project.lageplan
    storeys: storeysRaw.filter(isObj).filter((s) => s.lageplan !== true).map(normalizeStorey),
  };
  if (project.storeys.length === 0) project.storeys = base.storeys;
  // Lageplan: eigener Projektteil, früher (0.7.0) Flächen in einem Lageplan-Geschoss
  const lpRoh = [
    ...(isObj(raw.lageplan) && Array.isArray(raw.lageplan.flaechen) ? raw.lageplan.flaechen : []),
    ...storeysRaw.filter(isObj).filter((s) => s.lageplan === true).flatMap((s) => (Array.isArray(s.shapes) ? s.shapes : [])),
  ];
  const flaechen = lpRoh.filter(isObj).map(normalizeFlaeche).filter((f): f is LageplanFlaeche => f !== null);
  if (flaechen.length || isObj(raw.lageplan)) project.lageplan = { flaechen };
  if (isObj(raw.massNutzung)) project.massNutzung = normalizeMassNutzung(raw.massNutzung);
  if (Array.isArray(raw.dateien)) {
    const dateien = raw.dateien.filter(isObj).map(normalizeDatei).filter((d): d is ProjektDatei => d !== null);
    if (dateien.length) project.dateien = dateien;
  }
  if (isObj(raw.dachModell) && Array.isArray(raw.dachModell.triangles)) {
    project.dachModell = { name: str(raw.dachModell.name, 'Modell'), triangles: raw.dachModell.triangles.filter((v): v is number => typeof v === 'number') };
  }
  return project;
}

function normalizeAnschrift(v: unknown): Anschrift {
  // bis 0.5: Adresse als Freitext
  if (typeof v === 'string') return anschriftAusText(v);
  const a = isObj(v) ? v : {};
  return { strasse: str(a.strasse, ''), plz: str(a.plz, ''), ort: str(a.ort, '') };
}

function normalizeMeta(v: unknown): ProjectMeta {
  const m = isObj(v) ? v : {};
  const g = isObj(m.grundstueck) ? m.grundstueck : {};
  const b = isObj(m.bauherr) ? m.bauherr : {};
  const grundstueck: Grundstueck = { gemarkung: str(g.gemarkung, ''), flur: str(g.flur, ''), flurstueck: str(g.flurstueck, '') };
  if (typeof g.flaeche === 'number' && Number.isFinite(g.flaeche)) grundstueck.flaeche = g.flaeche;
  return {
    projektcode: str(m.projektcode, ''),
    adresse: normalizeAnschrift(m.adresse),
    grundstueck,
    bauherr: {
      name: str(b.name, ''),
      adresse: normalizeAnschrift(b.adresse),
      kontakte: (Array.isArray(b.kontakte) ? b.kontakte : [])
        .filter(isObj)
        .map((k) => ({ art: oneOf<KontaktArt>(k.art, ['email', 'telefon'], 'telefon'), wert: str(k.wert, '') })),
    },
    bearbeiter: str(m.bearbeiter, ''),
  };
}

const NUTZUNGEN: LageplanNutzung[] = ['zufahrt', 'stellplatz', 'garage', 'terrasse', 'weg', 'nebenanlage', 'unterirdisch', 'garten', 'sonstige'];

function normalizeFlaeche(f: Record<string, unknown>): LageplanFlaeche | null {
  const points = (Array.isArray(f.points) ? f.points : [])
    .filter(isObj)
    .map((p) => ({ x: num(p.x, NaN), y: num(p.y, NaN) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < 3) return null;
  return {
    id: str(f.id, newId('lp')),
    name: str(f.name, ''),
    points,
    nutzung: oneOf<LageplanNutzung>(f.nutzung, NUTZUNGEN, 'sonstige'),
    versiegelung: oneOf<Versiegelung>(f.versiegelung, ['voll', 'teil', 'gruen'], 'voll'),
    ...(f.nachbar === true ? { nachbar: true } : {}),
    ...(typeof f.hoehe === 'number' && Number.isFinite(f.hoehe) ? { hoehe: f.hoehe } : {}),
  };
}

function normalizeMassNutzung(m: Record<string, unknown>): MassNutzung {
  const out: MassNutzung = {};
  if (typeof m.planDatum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.planDatum)) out.planDatum = m.planDatum;
  if (m.baunvo === '1962' || m.baunvo === '1968' || m.baunvo === '1990') out.baunvo = m.baunvo;
  if (m.bauo === 'nw1962' || m.bauo === 'nw1985' || m.bauo === 'nrw2019') out.bauo = m.bauo;
  for (const k of ['grz', 'gfz', 'vollgeschosseMax', 'grzIIMax', 'gelaende', 'dachaufbau', 'wandzuschlag'] as const) {
    if (typeof m[k] === 'number' && Number.isFinite(m[k])) out[k] = m[k] as number;
  }
  if (m.einfamilienhaus === true) out.einfamilienhaus = true;
  if (isObj(m.einstufung)) {
    const e: MassNutzung['einstufung'] = {};
    for (const n of NUTZUNGEN) if (m.einstufung[n] === 'ja' || m.einstufung[n] === 'nein') e[n] = m.einstufung[n] as 'ja' | 'nein';
    out.einstufung = e;
  }
  return out;
}

const DATEI_ARTEN: DateiArt[] = ['ifc', 'dxf', 'pdf', 'vorlage'];

function normalizeDatei(d: Record<string, unknown>): ProjektDatei | null {
  if (!(d.daten instanceof Uint8Array) || !DATEI_ARTEN.includes(d.art as DateiArt)) return null;
  return { id: str(d.id, newId('df')), name: str(d.name, 'Datei'), art: d.art as DateiArt, datum: str(d.datum, ''), daten: d.daten };
}

function normalizeStorey(s: Record<string, unknown>): Storey {
  const shapes = (Array.isArray(s.shapes) ? s.shapes : []).filter(isObj).map(normalizeShape).filter((x): x is Shape => x !== null);
  const storey: Storey = {
    id: str(s.id, newId('st')),
    name: str(s.name, 'Geschoss'),
    hoehe: num(s.hoehe, 3),
    elevation: typeof s.elevation === 'number' && Number.isFinite(s.elevation) ? s.elevation : undefined,
    shapes,
  };
  if (typeof s.dachgeschoss === 'boolean') storey.dachgeschoss = s.dachgeschoss;
  if (s.geschosshoeheBegrenzt === true) storey.geschosshoeheBegrenzt = true;
  if (typeof s.vollgeschoss === 'boolean') storey.vollgeschoss = s.vollgeschoss;
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
    return { ...common, kind: 'outline', hoehe: typeof s.hoehe === 'number' ? s.hoehe : undefined, dach: normalizeDach(s.dach) };
  }
  if (s.kind === 'room') {
    const w = isObj(s.wofl) ? s.wofl : {};
    return {
      ...common,
      kind: 'room',
      nummer: str(s.nummer, ''),
      putzabzug: typeof s.putzabzug === 'number' && s.putzabzug > 0 && s.putzabzug < 100 ? s.putzabzug : undefined,
      ...(s.aufenthalt === 'ja' || s.aufenthalt === 'nein' || s.aufenthalt === 'treppe' ? { aufenthalt: s.aufenthalt } : {}),
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

const DACH_IDS: DachTyp[] = [...DACH_TYPEN.map((t) => t.id), 'modell'];
const DACH_NUM_KEYS = ['neigungWalm', 'firstrichtung', 'krueppelHoehe', 'neigungUnten', 'hoeheUnten', 'stich', 'shedAnzahl', 'shedHoehe', 'maxHoehe'] as const;

function normalizeDach(d: unknown): Dach | undefined {
  if (!isObj(d) || !DACH_IDS.includes(d.typ as DachTyp)) return undefined;
  const out: Dach = { typ: d.typ as DachTyp, traufhoehe: num(d.traufhoehe, 3), neigung: num(d.neigung, 0) };
  for (const k of DACH_NUM_KEYS) if (typeof d[k] === 'number' && Number.isFinite(d[k])) out[k] = d[k] as number;
  if (d.umkehren === true) out.umkehren = true;
  if (Array.isArray(d.gauben)) {
    const gauben = d.gauben.filter(isObj).map(normalizeGaube);
    if (gauben.length) out.gauben = gauben;
  }
  return out;
}

const GAUBEN_NUM_KEYS = ['tiefe', 'neigung', 'wandhoehe', 'dachneigung'] as const;

function normalizeGaube(g: Record<string, unknown>): Gaube {
  const out: Gaube = {
    typ: oneOf<GaubenTyp>(g.typ, ['schlepp', 'flach', 'sattel'], 'schlepp'),
    seite: g.seite === 1 || g.seite === 2 || g.seite === 3 ? g.seite : 0,
    abstand: num(g.abstand, 0),
    breite: num(g.breite, 1),
    vorne: num(g.vorne, 0),
  };
  for (const k of GAUBEN_NUM_KEYS) if (typeof g[k] === 'number' && Number.isFinite(g[k])) out[k] = g[k] as number;
  if (typeof g.name === 'string' && g.name) out.name = g.name;
  return out;
}

function normalizeBackground(b: unknown): Background | undefined {
  if (!isObj(b)) return undefined;
  const base = {
    name: str(b.name, 'Plan'),
    x: num(b.x, 0),
    y: num(b.y, 0),
    opacity: num(b.opacity, 0.6),
    visible: b.visible !== false,
    ...(typeof b.quelle === 'string' ? { quelle: b.quelle } : {}),
  };
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
      source: b.source === 'ifc' ? 'ifc' : undefined,
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
