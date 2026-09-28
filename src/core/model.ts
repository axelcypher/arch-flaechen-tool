import type { Point } from './geometry';

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
}

export interface RoomShape extends ShapeBase {
  kind: 'room';
  nummer: string;
  nutzung: Nutzungsgruppe;
  wofl: WoflAngaben;
}

export type Shape = OutlineShape | RoomShape;
export type ShapeKind = Shape['kind'];

export interface BackgroundImage {
  dataUrl: string;
  name: string;
  widthPx: number;
  heightPx: number;
  /** Weltkoordinate der linken oberen Bildecke */
  x: number;
  y: number;
  metersPerPixel: number;
  opacity: number;
  visible: boolean;
}

export interface Storey {
  id: string;
  name: string;
  /** Brutto-Geschosshöhe (OK Fußboden bis OK Fußboden darüber bzw. OK Dach) für BRI */
  hoehe: number;
  shapes: Shape[];
  background?: BackgroundImage;
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
