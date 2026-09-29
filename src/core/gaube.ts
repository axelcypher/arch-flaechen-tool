import type { Point } from './geometry';
import type { Dach, Point3, RoofFrame } from './roof';

/**
 * Dachgauben auf einer Traufseite eines geneigten Dachs.
 *
 * Lage im Dachsystem (u entlang First, v quer): Die Gaube steht auf der Dachfläche, die von der Traufe
 * bei v0 (seite 0) bzw. v1 (seite 1) ansteigt. s ist der waagerechte Abstand von dieser Traufe.
 * Gerechnet wird nur der Rauminhalt ÜBER der Hauptdachfläche (der Teil darunter steckt schon im Dach).
 *
 *   Schleppgaube   Gaubendach mit Neigung β < α, schneidet das Hauptdach nach der Tiefe T:
 *                  V = B × T² × (tan α − tan β) / 2
 *   Flachdachgaube wie Schleppgaube mit β = 0:  V = B × T² × tan α / 2
 *   Satteldachgaube Vorderwand mit Wandhöhe h (über der Dachfläche) und Giebeldreieck (Neigung γ,
 *                  Giebelhöhe Hg = B/2 × tan γ); jede Höhenlage läuft bis zur Dachfläche zurück:
 *                  V = B × (h² + Hg × (h + Hg / 3)) / (2 × tan α)
 */

export type GaubenTyp = 'schlepp' | 'flach' | 'sattel';

export interface Gaube {
  typ: GaubenTyp;
  /** Traufseite: 0 = Dachfläche von v0 aus, 1 = von v1 aus */
  seite: 0 | 1;
  /** Abstand der Gaubenwange (Seite zu u0) vom Rand des Dachs in Firstrichtung [m] */
  abstand: number;
  /** Breite B (in Firstrichtung) [m] */
  breite: number;
  /** waagerechter Abstand der Gaubenvorderwand von der Traufe [m] */
  vorne: number;
  /** Schlepp-/Flachdachgaube: waagerechte Tiefe T von der Vorderwand bis zum Anschluss an das Hauptdach [m] */
  tiefe?: number;
  /** Schleppgaube: Neigung β des Gaubendachs [°] */
  neigung?: number;
  /** Satteldachgaube: Wandhöhe h an der Vorderwand über der Dachfläche [m] */
  wandhoehe?: number;
  /** Satteldachgaube: Neigung γ des Gaubendachs [°] */
  dachneigung?: number;
  /** Bezeichnung, z. B. aus dem IFC-Modell */
  name?: string;
}

export const GAUBEN_TYPEN: { id: GaubenTyp; label: string }[] = [
  { id: 'schlepp', label: 'Schleppgaube' },
  { id: 'flach', label: 'Flachdachgaube' },
  { id: 'sattel', label: 'Satteldachgaube' },
];

export const gaubenLabel = (t: GaubenTyp) => GAUBEN_TYPEN.find((x) => x.id === t)?.label ?? 'Gaube';

const rad = (d: number) => (d * Math.PI) / 180;
const clampDeg = (v: number) => Math.min(Math.max(v, 0), 89);

/** Dachformen, deren Traufseiten Gauben tragen können */
export function gaubenMoeglich(d: Dach | undefined): boolean {
  return !!d && ['pult', 'sattel', 'walm', 'kruppelwalm', 'zelt', 'mansard', 'mansardwalm'].includes(d.typ);
}

/** Neigung α der Hauptdachfläche, auf der die Gaube steht (Mansarddach: untere, steile Fläche) */
export function hauptneigung(d: Dach): number {
  return clampDeg(d.typ === 'mansard' || d.typ === 'mansardwalm' ? (d.neigungUnten ?? 70) : d.neigung);
}

export function defaultGaube(d: Dach, fr: RoofFrame): Gaube {
  const L = fr.u1 - fr.u0;
  const B = fr.v1 - fr.v0;
  const breite = Math.min(2.5, Math.max(0.5, L / 3));
  return { typ: 'schlepp', seite: d.typ === 'pult' && d.umkehren ? 1 : 0, abstand: Math.max(0, (L - breite) / 2), breite, vorne: Math.min(0.5, B / 8), tiefe: Math.min(2.5, B / 4), neigung: 15 };
}

export interface GaubenMasse {
  /** Hauptdachneigung α [°] */
  alpha: number;
  /** waagerechte Tiefe bis zum Anschluss an das Hauptdach */
  tiefe: number;
  /** Höhe der Vorderwand über der Dachfläche an der Traufe der Gaube (Schlepp: hf, Sattel: h) */
  hVorne: number;
  /** Satteldachgaube: Giebelhöhe über der Wand */
  giebel: number;
  volumen: number;
}

export function gaubenMasse(g: Gaube, d: Dach): GaubenMasse {
  const alpha = hauptneigung(d);
  const ta = Math.tan(rad(alpha));
  const B = Math.max(0, g.breite);
  if (g.typ === 'sattel') {
    const h = Math.max(0, g.wandhoehe ?? 1.2);
    const H = (B / 2) * Math.tan(rad(clampDeg(g.dachneigung ?? 45)));
    const tiefe = ta > 1e-9 ? (h + H) / ta : 0;
    const volumen = ta > 1e-9 ? (B * (h * h + H * (h + H / 3))) / (2 * ta) : 0;
    return { alpha, tiefe, hVorne: h, giebel: H, volumen };
  }
  const T = Math.max(0, g.tiefe ?? 2);
  const tb = g.typ === 'flach' ? 0 : Math.tan(rad(clampDeg(Math.min(g.neigung ?? 0, alpha))));
  const hf = T * Math.max(0, ta - tb);
  return { alpha, tiefe: T, hVorne: hf, giebel: 0, volumen: (B * T * hf) / 2 };
}

export function gaubenVolumen(d: Dach | undefined): number {
  if (!d?.gauben?.length || !gaubenMoeglich(d)) return 0;
  return d.gauben.reduce((a, g) => a + gaubenMasse(g, d).volumen, 0);
}

/** Körperflächen der Gauben für die 3D-Ansicht (Höhen über Fußboden); Unterseite liegt auf der Dachfläche */
export function gaubenFaces(d: Dach, fr: RoofFrame): { tops: Point3[][]; sides: Point3[][] } {
  const tops: Point3[][] = [];
  const sides: Point3[][] = [];
  if (!d.gauben?.length || !gaubenMoeglich(d)) return { tops, sides };
  const c = Math.cos(rad(fr.angle));
  const sn = Math.sin(rad(fr.angle));
  for (const g of d.gauben) {
    const m = gaubenMasse(g, d);
    if (m.volumen <= 1e-9) continue;
    const ta = Math.tan(rad(m.alpha));
    // (u, s, Höhe über der Traufe der Dachfläche) → Grundriss
    const P = (u: number, s: number, z: number): Point3 => {
      const v = g.seite === 0 ? fr.v0 + s : fr.v1 - s;
      return { x: u * c - v * sn, y: u * sn + v * c, z: d.traufhoehe + z };
    };
    const ua = fr.u0 + g.abstand;
    const ub = ua + g.breite;
    const sf = g.vorne;
    const sb = sf + m.tiefe;
    const roof = (s: number) => s * ta;
    if (g.typ === 'sattel') {
      const um = (ua + ub) / 2;
      const zw = roof(sf) + m.hVorne;
      const zf = zw + m.giebel;
      // Vorderwand (Fünfeck)
      sides.push([P(ua, sf, roof(sf)), P(ua, sf, zw), P(um, sf, zf), P(ub, sf, zw), P(ub, sf, roof(sf))]);
      // Wangen: Dreieck zwischen Traufkante der Gaube und Dachfläche
      const sw = zw / ta; // hier trifft die Gaubentraufe die Dachfläche
      sides.push([P(ua, sf, roof(sf)), P(ua, sf, zw), P(ua, sw, zw)]);
      sides.push([P(ub, sf, roof(sf)), P(ub, sf, zw), P(ub, sw, zw)]);
      // Dachflächen der Gaube: vom Giebel bis zur Kehle (First trifft Dachfläche bei sb)
      tops.push([P(ua, sf, zw), P(um, sf, zf), P(um, sb, zf), P(ua, sw, zw)]);
      tops.push([P(um, sf, zf), P(ub, sf, zw), P(ub, sw, zw), P(um, sb, zf)]);
    } else {
      const zt = roof(sf) + m.hVorne;
      sides.push([P(ua, sf, roof(sf)), P(ua, sf, zt), P(ub, sf, zt), P(ub, sf, roof(sf))]);
      sides.push([P(ua, sf, roof(sf)), P(ua, sf, zt), P(ua, sb, roof(sb))]);
      sides.push([P(ub, sf, roof(sf)), P(ub, sf, zt), P(ub, sb, roof(sb))]);
      tops.push([P(ua, sf, zt), P(ub, sf, zt), P(ub, sb, roof(sb)), P(ua, sb, roof(sb))]);
    }
  }
  return { tops, sides };
}

/** Grundriss der Gauben (für Prüfungen und Anzeige) */
export function gaubenGrundriss(d: Dach, fr: RoofFrame): Point[][] {
  if (!d.gauben?.length || !gaubenMoeglich(d)) return [];
  const c = Math.cos(rad(fr.angle));
  const sn = Math.sin(rad(fr.angle));
  return d.gauben.map((g) => {
    const m = gaubenMasse(g, d);
    const P = (u: number, s: number) => {
      const v = g.seite === 0 ? fr.v0 + s : fr.v1 - s;
      return { x: u * c - v * sn, y: u * sn + v * c };
    };
    const ua = fr.u0 + g.abstand;
    const ub = ua + g.breite;
    return [P(ua, g.vorne), P(ub, g.vorne), P(ub, g.vorne + m.tiefe), P(ua, g.vorne + m.tiefe)];
  });
}
