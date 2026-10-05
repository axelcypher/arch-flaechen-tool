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
  /**
   * Aufenthaltsraum im Sinne der BauNVO vor 1990 (Geschossfläche in Nicht-Vollgeschossen, GRZ-Nachweis);
   * „treppe“ = zugehöriger Treppenraum. Ohne Angabe nach Nutzung und Raumname.
   */
  aufenthalt?: 'ja' | 'nein' | 'treppe';
}

/** Versiegelungsgrad einer Fläche im Lageplan */
export type Versiegelung = 'voll' | 'teil' | 'gruen';

/** Nutzung einer Fläche im Lageplan – maßgebend für die Anrechnung auf die Grundfläche */
export type LageplanNutzung = 'zufahrt' | 'stellplatz' | 'garage' | 'terrasse' | 'weg' | 'nebenanlage' | 'unterirdisch' | 'garten' | 'sonstige';

/** Fläche im Lageplan (Freifläche, Belag, Garage …) für GRZ und Flächenbilanz */
export interface LageplanFlaeche {
  id: string;
  name: string;
  points: Point[];
  nutzung: LageplanNutzung;
  versiegelung: Versiegelung;
  /** Fläche eines Nachbargrundstücks: nur Darstellung, zählt nirgends mit */
  nachbar?: boolean;
  /** mittlere Höhe der Oberfläche über ±0,00 in m (aus dem Modell) – für die Geländeoberfläche */
  hoehe?: number;
}

/**
 * Lageplan des Grundstücks. Gepflegt vom GRZ/GFZ-Nachweis; der Flächenrechner übernimmt ihn beim
 * IFC-Import (Geschoss „Lageplan“) und bewahrt ihn beim Speichern.
 */
export interface Lageplan {
  flaechen: LageplanFlaeche[];
}

export type Shape = OutlineShape | RoomShape;
export type ShapeKind = Shape['kind'];

interface BackgroundBase {
  name: string;
  /** Originaldatei (PDF, DXF) in Project.dateien – wird im Projektarchiv mitgespeichert */
  quelle?: string;
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
  /** Herkunft: DXF-Datei oder Geschossschnitt aus einem IFC-Modell */
  source?: 'dxf' | 'ifc';
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
  /** Dach aus Modell: Rauminhalt höchstens bis zur Geschosshöhe (nicht bis unter die Dachhaut erweitern) */
  geschosshoeheBegrenzt?: boolean;
  /** Geschossart für Auswertung und Vorlagen; ohne Angabe automatisch (siehe istDachgeschoss) */
  dachgeschoss?: boolean;
  /** Vollgeschoss für GFZ und Zahl der Vollgeschosse (GRZ/GFZ-Nachweis); ohne Angabe nach der Bauordnung geprüft */
  vollgeschoss?: boolean;
  shapes: Shape[];
  background?: Background;
}

export interface ProjectSettings {
  /** Rasterweite für den Fang in m */
  gridStep: number;
  /** Standardfaktor für Balkone/Terrassen nach WoFlV (0,25 … 0,5) */
  freisitzFaktor: number;
}

export interface Anschrift {
  /** Straße und Hausnummer */
  strasse: string;
  plz: string;
  ort: string;
}

export type KontaktArt = 'email' | 'telefon';

export interface Kontakt {
  art: KontaktArt;
  wert: string;
}

export interface Grundstueck {
  gemarkung: string;
  flur: string;
  flurstueck: string;
  /** Grundstücksfläche in m² */
  flaeche?: number;
}

export interface Bauherr {
  name: string;
  adresse: Anschrift;
  /** beliebig viele E-Mail-Adressen und Telefonnummern */
  kontakte: Kontakt[];
}

export interface ProjectMeta {
  /** Projektcode / Projektnummer */
  projektcode: string;
  /** Adresse des Bauvorhabens */
  adresse: Anschrift;
  grundstueck: Grundstueck;
  bauherr: Bauherr;
  bearbeiter: string;
}

export const leereAnschrift = (): Anschrift => ({ strasse: '', plz: '', ort: '' });

export function leereMeta(): ProjectMeta {
  return {
    projektcode: '',
    adresse: leereAnschrift(),
    grundstueck: { gemarkung: '', flur: '', flurstueck: '' },
    bauherr: { name: '', adresse: leereAnschrift(), kontakte: [] },
    bearbeiter: '',
  };
}

/** „PLZ Ort“ */
export function plzOrt(a: Anschrift): string {
  return [a.plz, a.ort].map((x) => x.trim()).filter(Boolean).join(' ');
}

/** Anschrift in einer Zeile: „Straße Nr., PLZ Ort“ */
export function anschriftEinzeilig(a: Anschrift): string {
  return [a.strasse.trim(), plzOrt(a)].filter(Boolean).join(', ');
}

/** Freitext „Straße Nr., PLZ Ort“ (frühere Versionen) in eine Anschrift zerlegen */
export function anschriftAusText(text: string): Anschrift {
  const t = text.trim();
  const m = /^(.*?)[,\n]\s*(\d{4,5})\s+(.+)$/s.exec(t);
  if (m) return { strasse: m[1].trim(), plz: m[2], ort: m[3].trim() };
  const nurOrt = /^(\d{4,5})\s+(.+)$/.exec(t);
  if (nurOrt) return { strasse: '', plz: nurOrt[1], ort: nurOrt[2].trim() };
  return { strasse: t, plz: '', ort: '' };
}

/** Gemarkung, Flur, Flurstück in einer Zeile */
export function flurText(g: Grundstueck): string {
  return [g.gemarkung && `Gemarkung ${g.gemarkung}`, g.flur && `Flur ${g.flur}`, g.flurstueck && `Flurstück ${g.flurstueck}`].filter(Boolean).join(', ');
}

/** Art einer mitgespeicherten Originaldatei */
export type DateiArt = 'ifc' | 'dxf' | 'pdf' | 'vorlage' | 'vorlage-grz' | 'vorlage-kosten';

/** Excel-Vorlagen: „vorlage“ des Flächenrechners, „vorlage-grz“ des GRZ-Nachweises, „vorlage-kosten“ der Kostenermittlung */
export const istVorlage = (art: DateiArt) => art === 'vorlage' || art === 'vorlage-grz' || art === 'vorlage-kosten';

/** Originaldatei eines Imports bzw. die Excel-Vorlage des Projekts – im Archiv unter quellen/ abgelegt */
export interface ProjektDatei {
  id: string;
  name: string;
  art: DateiArt;
  /** Datum der Übernahme (TT.MM.JJJJ) */
  datum: string;
  daten: Uint8Array;
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
  /** Originaldateien der Importe (IFC, DXF, PDF) und die Excel-Vorlage */
  dateien?: ProjektDatei[];
  /** Lageplan des Grundstücks (GRZ/GFZ-Nachweis) */
  lageplan?: Lageplan;
  /** Festsetzungen des Bebauungsplans (GRZ/GFZ-Nachweis) */
  massNutzung?: MassNutzung;
  /** Kostenermittlung nach DIN 276 */
  kosten?: Kosten;
}

/* ---------- Kostenermittlung (DIN 276) ---------- */

/**
 * Bezugsgröße einer Kostenposition: Mengen nach DIN 277 bzw. daraus abgeleitete Bauteilmengen,
 * eine eigene Menge, ein Pauschalbetrag oder ein Prozentsatz anderer Kostengruppen.
 */
export type KostenBezug =
  | 'bgf'
  | 'bri'
  | 'nuf'
  | 'nrf'
  | 'tf'
  | 'vf'
  | 'wofl'
  | 'grf'
  | 'bgi'
  | 'awf'
  | 'iwf'
  | 'def'
  | 'daf'
  | 'auf'
  | 'fbg'
  | 'we'
  | 'menge'
  | 'pauschal'
  | 'prozent';

export const KOSTEN_BEZUEGE: KostenBezug[] = ['bgf', 'bri', 'nuf', 'nrf', 'tf', 'vf', 'wofl', 'grf', 'bgi', 'awf', 'iwf', 'def', 'daf', 'auf', 'fbg', 'we', 'menge', 'pauschal', 'prozent'];

export interface KostenPosition {
  id: string;
  /** Kostengruppe, z. B. „300“, „330“ oder „331“ */
  kg: string;
  bezeichnung: string;
  bezug: KostenBezug;
  /** nur Bezug „menge“: Menge und Einheit */
  menge?: number;
  einheit?: string;
  /** nur Bezug „prozent“: Kostengruppen, deren Summe die Grundlage bildet (z. B. ["300", "400"]) */
  basis?: string[];
  /** Kennwert je Einheit (bei „prozent“ in %, bei „pauschal“ der Betrag) – Bandbreite von / Mittel / bis */
  von?: number;
  mittel?: number;
  bis?: number;
  /** ausgeschaltet: wird angezeigt, aber nicht gerechnet */
  aus?: boolean;
  /** Herkunft des Kennwerts */
  quelle?: string;
  bemerkung?: string;
}

/** Stufen der Kostenermittlung nach DIN 276 */
export type KostenStufe = 'rahmen' | 'schaetzung' | 'berechnung' | 'voranschlag' | 'anschlag' | 'feststellung';

export const KOSTEN_STUFEN: { id: KostenStufe; label: string; lph: string }[] = [
  { id: 'rahmen', label: 'Kostenrahmen', lph: 'LPh 1' },
  { id: 'schaetzung', label: 'Kostenschätzung', lph: 'LPh 2' },
  { id: 'berechnung', label: 'Kostenberechnung', lph: 'LPh 3' },
  { id: 'voranschlag', label: 'Kostenvoranschlag', lph: 'LPh 5/6' },
  { id: 'anschlag', label: 'Kostenanschlag', lph: 'LPh 7' },
  { id: 'feststellung', label: 'Kostenfeststellung', lph: 'LPh 8' },
];

/** Bandbreite von / Mittel / bis */
export type Spanne = [number, number, number];

/** festgehaltener Kostenstand – für Historie und Vorher/Nachher */
export interface KostenStand {
  id: string;
  /** ISO-Datum JJJJ-MM-TT */
  datum: string;
  stufe: KostenStufe;
  bemerkung: string;
  /** Mengen zum Zeitpunkt des Stands */
  mengen: Record<string, number>;
  /** Kosten je Kostengruppe (1. und 2. Ebene), netto */
  summen: Record<string, Spanne>;
  gesamtNetto: Spanne;
  gesamtBrutto: Spanne;
}

export interface Kosten {
  stufe?: KostenStufe;
  /** Preisstand der Ermittlung (ISO-Datum) */
  datum?: string;
  positionen: KostenPosition[];
  /** von Hand festgelegte Mengen (überschreiben die abgeleiteten) */
  mengen?: Partial<Record<KostenBezug, number>>;
  /**
   * Auswahl im Mengennachweis: Teile einer Menge (Umriss, Raum, Wand …), die abweichend vom Standard mitzählen
   * (true) oder nicht (false). Schlüssel ist die Kennung des Teils, z. B. „iwf-<GlobalId der Wand>“.
   */
  teile?: Record<string, boolean>;
  /** Baupreisindex zum Stand der Kennwerte und aktuell – Faktor aktuell/Basis */
  indexBasis?: number;
  indexAktuell?: number;
  /** Regionalfaktor (1 = Bundesdurchschnitt) */
  regionalfaktor?: number;
  /** Umsatzsteuer in % (Standard 19) */
  mwst?: number;
  /** Kennwerte enthalten die Umsatzsteuer */
  kennwerteBrutto?: boolean;
  /** Herkunft der Kennwerte */
  katalog?: { name: string; quelle?: string; stand?: string };
  staende?: KostenStand[];
}

/** BauNVO-Fassungen mit unterschiedlicher Berechnung von Grund- und Geschossfläche */
export type BauNVOFassung = '1962' | '1968' | '1990';
/** Vollgeschossbegriff der Bauordnung NRW (statisch nach dem Datum des Bebauungsplans) */
export type BauOFassung = 'nw1962' | 'nw1985' | 'nrw2019';
/** Einstufung einer Flächennutzung, die die BauNVO-Fassung nicht eindeutig regelt */
export type Einstufung = 'ja' | 'nein';

export interface MassNutzung {
  /** Inkrafttreten / Satzungsbeschluss des Bebauungsplans (JJJJ-MM-TT); leer = aktuelles Recht (§ 34/35 BauGB) */
  planDatum?: string;
  /** abweichend vom Plandatum */
  baunvo?: BauNVOFassung;
  bauo?: BauOFassung;
  grz?: number;
  gfz?: number;
  vollgeschosseMax?: number;
  /** abweichende Obergrenze für die GRZ II (§ 19 Abs. 4 Satz 3) */
  grzIIMax?: number;
  /** festgelegte Geländeoberfläche (m über ±0,00); sonst aus dem Lageplan */
  gelaende?: number;
  /** Dicke des Dachaufbaus senkrecht gemessen: lichte Höhe = Dachhaut − Aufbau */
  dachaufbau?: number;
  /** Einfamilienhaus (BauO NW 1962/1970: lichte Höhe für Aufenthaltsräume 2,30 statt 2,50 m) */
  einfamilienhaus?: boolean;
  /** Umfassungswände um Aufenthaltsräume (BauNVO vor 1990) in m */
  wandzuschlag?: number;
  /** Festlegung für Nutzungen, die die Fassung offenlässt („prüfen“) */
  einstufung?: Partial<Record<LageplanNutzung, Einstufung>>;
}

export function createLageplanFlaeche(points: Point[], name = 'Fläche'): LageplanFlaeche {
  return { id: newId('lp'), name, points, nutzung: 'sonstige', versiegelung: 'voll' };
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
    meta: leereMeta(),
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

/**
 * Fügt eine Originaldatei hinzu; eine inhaltsgleiche Datei (z. B. dasselbe PDF für mehrere Geschosse)
 * wird wiederverwendet. Liefert das Projekt und die ID der Datei.
 */
export function addDatei(p: Project, name: string, art: DateiArt, daten: Uint8Array): { project: Project; id: string } {
  const same = p.dateien?.find((d) => d.art === art && d.name === name && gleicheBytes(d.daten, daten));
  if (same) return { project: p, id: same.id };
  const d: ProjektDatei = { id: newId('df'), name, art, datum: new Date().toLocaleDateString('de-DE'), daten };
  // es gibt nur eine Excel-Vorlage je Projekt und App
  const rest = (p.dateien ?? []).filter((x) => !istVorlage(art) || x.art !== art);
  return { project: { ...p, dateien: [...rest, d] }, id: d.id };
}

function gleicheBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Nur noch benötigte Originaldateien: PDF/DXF, auf die ein Plan verweist, alle IFC-Modelle und die Vorlagen */
export function benutzteDateien(p: Project): ProjektDatei[] {
  const refs = new Set(p.storeys.map((s) => s.background?.quelle).filter(Boolean));
  return (p.dateien ?? []).filter((d) => d.art === 'ifc' || istVorlage(d.art) || refs.has(d.id));
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

/**
 * Dachgeschoss? Ohne ausdrückliche Angabe gilt ein Geschoss als Dachgeschoss, sobald einer seiner
 * BGF-Umrisse eine geneigte Dachform trägt. Ein Dach aus dem IFC-Modell zählt nicht: Es steht auch
 * über Teilen unterer Geschosse (Vordach, Anbau), die sonst fälschlich als Dachgeschoss gälten.
 */
export function istDachgeschoss(s: Storey): boolean {
  if (s.dachgeschoss !== undefined) return s.dachgeschoss;
  return s.shapes.some((sh) => sh.kind === 'outline' && !sh.subtract && sh.dach !== undefined && sh.dach.typ !== 'flach' && sh.dach.typ !== 'modell');
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
