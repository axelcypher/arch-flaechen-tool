import type { Point } from './geometry';
import type { Dach } from './roof';
import type { DachModell } from './roofMesh';

/**
 * Datenmodell eines Projekts. Alle Längen in Metern.
 *
 * Grundprinzip:
 *  - Je Geschoss werden BGF-Umrisse (kind "outline") gezeichnet → BGF und BRI.
 *  - Räume (kind "room") werden je Nutzungsgruppe nach DIN 277 erfasst → NUF/TF/VF = NRF.
 *  - Räume können zusätzlich mit einer Anrechnungskategorie nach WoFlV versehen werden → Wohnfläche.
 *  - Jede Fläche kann als Abzugsfläche markiert werden (z. B. Innenhof, Schacht, Schornstein).
 */

/** Raumumschließung nach DIN 277: Regelfall (R) oder Sonderfall (S, z. B. Balkon, Loggia). */
export type Raumumschliessung = 'R' | 'S';

export type Nutzungsgruppe = 'NUF1' | 'NUF2' | 'NUF3' | 'NUF4' | 'NUF5' | 'NUF6' | 'NUF7' | 'TF' | 'VF';

/** Anrechnung nach Wohnflächenverordnung (WoFlV § 4). */
export type WoflKategorie =
  | 'keine' // nicht Teil der Wohnfläche (z. B. Keller, Heizraum, Garage – § 2 Abs. 3)
  | 'voll' // lichte Höhe ≥ 2 m: 100 %
  | 'halb' // lichte Höhe ≥ 1 m und < 2 m: 50 %
  | 'null' // lichte Höhe < 1 m: 0 %
  | 'wintergarten' // unbeheizte Wintergärten, Schwimmbäder u. ä.: 50 %
  | 'freisitz' // Balkone, Loggien, Dachgärten, Terrassen: i. d. R. 25 %, höchstens 50 %
  | 'individuell'; // frei wählbarer Faktor

export interface WoflAngaben {
  kategorie: WoflKategorie;
  /** nur bei "freisitz" (überschreibt Projektstandard) oder "individuell" */
  faktor?: number;
  /** Zuordnung zu einer Wohneinheit, z. B. "WE 01" */
  wohnung: string;
}

interface ShapeBase {
  id: string;
  name: string;
  points: Point[];
  /** Abzugsfläche: wird negativ gerechnet */
  subtract: boolean;
  umschliessung: Raumumschliessung;
  bemerkung?: string;
}

export interface OutlineShape extends ShapeBase {
  kind: 'outline';
  /** abweichende Höhe für BRI (z. B. Galerie, Luftraum); sonst Geschosshöhe */
  hoehe?: number;
  /** Dach/oberer Abschluss: BRI dieses Umrisses = Volumen vom Fußboden bis zur Dachhaut */
  dach?: Dach;
}

export interface RoomShape extends ShapeBase {
  kind: 'room';
  nummer: string;
  nutzung: Nutzungsgruppe;
  wofl: WoflAngaben;
  /** Abzug in % von der Polygonfläche, z. B. 3 % Putzabzug bei Ermittlung aus Rohbaumaßen */
  putzabzug?: number;
}

export type Shape = OutlineShape | RoomShape;
export type ShapeKind = Shape['kind'];

interface BackgroundBase {
  name: string;
  /** Weltkoordinate des lokalen Ursprungs (Raster: linke obere Bildecke) */
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
}

/** Rasterbild (PNG/JPG oder gerenderte PDF-Seite). */
export interface RasterBackground extends BackgroundBase {
  type: 'raster';
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  metersPerPixel: number;
  /** Bei PDF-Seiten: Meter pro Pixel bei Maßstab 1:1 – erlaubt die Eingabe des Planmaßstabs */
  pdf?: { page: number; metersPerPixelAt1: number };
}

export interface DxfLayer {
  name: string;
  color: string;
  visible: boolean;
}

/** Linienzug in lokalen Koordinaten (DXF-Einheiten, y nach unten), flach: [x0, y0, x1, y1, …] */
export interface DxfPolyline {
  layer: number;
  pts: number[];
  closed: boolean;
  /** aus Bogen/Kreis/Ellipse entstanden (z. B. Türaufschlag) */
  arc?: boolean;
}

export interface DxfText {
  layer: number;
  x: number;
  y: number;
  h: number;
  /** Drehung in Grad (im Uhrzeigersinn, da y nach unten) */
  rot: number;
  text: string;
}

/** Vektorplan (DXF). Weltkoordinate = (x, y) + lokal × scale */
export interface VectorBackground extends BackgroundBase {
  type: 'vector';
  /** Meter je DXF-Zeichnungseinheit (mm → 0,001) */
  scale: number;
  layers: DxfLayer[];
  polylines: DxfPolyline[];
  texts: DxfText[];
}

export type Background = RasterBackground | VectorBackground;

/** @deprecated Altname, nur für Kompatibilität */
export type BackgroundImage = RasterBackground;

export interface Storey {
  id: string;
  name: string;
  /** Brutto-Geschosshöhe (OK Fußboden bis OK Fußboden darüber bzw. OK Dach) für BRI */
  hoehe: number;
  /** Höhe OK Fußboden über ±0,00 in m; ohne Angabe Summe der Geschosshöhen darunter */
  elevation?: number;
  shapes: Shape[];
  background?: Background;
}

export interface ProjectSettings {
  /** Rasterweite für den Fang in m */
  gridStep: number;
  /** Standardfaktor für Balkone/Terrassen nach WoFlV (0,25 … 0,5) */
  freisitzFaktor: number;
}

export interface ProjectMeta {
  adresse: string;
  bearbeiter: string;
}

export interface Project {
  format: 'arch-flaechen-tool';
  version: 1;
  name: string;
  meta: ProjectMeta;
  settings: ProjectSettings;
  storeys: Storey[];
  /** Dachhaut aus einem importierten Gebäudemodell (IFC) für Dächer vom Typ "modell" */
  dachModell?: DachModell;
}

let idCounter = 0;
export function newId(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createStorey(name: string, hoehe = 3): Storey {
  return { id: newId('st'), name, hoehe, shapes: [] };
}

export function createProject(name = 'Neues Projekt'): Project {
  return {
    format: 'arch-flaechen-tool',
    version: 1,
    name,
    meta: { adresse: '', bearbeiter: '' },
    settings: { gridStep: 0.05, freisitzFaktor: 0.25 },
    storeys: [createStorey('EG', 3)],
  };
}

export function createOutline(points: Point[], name = 'BGF'): OutlineShape {
  return { id: newId('sh'), kind: 'outline', name, points, subtract: false, umschliessung: 'R' };
}

export function createRoom(points: Point[], nummer: string, name = 'Raum'): RoomShape {
  return {
    id: newId('sh'),
    kind: 'room',
    name,
    nummer,
    points,
    subtract: false,
    umschliessung: 'R',
    nutzung: 'NUF1',
    wofl: { kategorie: 'keine', wohnung: '' },
  };
}

/** Fußbodenhöhen aller Geschosse (explizit oder als Summe der Geschosshöhen, unterstes Geschoss = 0) */
export function storeyElevations(p: Project): number[] {
  const out: number[] = [];
  let z = 0;
  for (const s of p.storeys) {
    const e = s.elevation ?? z;
    out.push(e);
    z = e + s.hoehe;
  }
  return out;
}

/** Anrechenbare Grundfläche eines Raums (Polygonfläche abzüglich Putzabzug) */
export function roomArea(r: RoomShape): number {
  return polygonAreaAbs(r.points) * (1 - (r.putzabzug ?? 0) / 100);
}

function polygonAreaAbs(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Fläche einer Form wie in der Auswertung (Räume inkl. Putzabzug), ohne Vorzeichen */
export function shapeArea(s: Shape): number {
  return s.kind === 'room' ? roomArea(s) : polygonAreaAbs(s.points);
}
