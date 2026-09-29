import type { Point } from './geometry';
import type { Dach, Point3, RoofFrame } from './roof';

/**
 * Dachgauben auf einer Dachfläche eines geneigten Dachs.
 *
 * Lage im Dachsystem (u entlang First, v quer): Die Gaube steht auf der Dachfläche, die von der Traufe
 * bei v0 (seite 0) bzw. v1 (seite 1) ansteigt, beim Walm-/Zeltdach auch auf einer Walmfläche, die von
 * u0 (seite 2) bzw. u1 (seite 3) ansteigt. s ist der waagerechte Abstand von dieser Traufe, a die Lage
 * entlang der Traufe.
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
export type GaubenSeite = 0 | 1 | 2 | 3;

export interface Gaube {
  typ: GaubenTyp;
  /** Dachfläche: 0/1 = Traufseiten (von v0 bzw. v1 aus), 2/3 = Walmseiten (von u0 bzw. u1 aus) */
  seite: GaubenSeite;
  /** Abstand der Gaubenwange vom Rand des Dachs entlang der Traufe (Traufseite: ab u0, Walmseite: ab v0) [m] */
  abstand: number;
  /** Breite B (entlang der Traufe) [m] */
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

/** Hat das Dach Walmflächen, auf denen Gauben stehen können? */
export function hatWalmseiten(d: Dach | undefined): boolean {
  return !!d && ['walm', 'zelt', 'mansardwalm'].includes(d.typ);
}

/** Neigung α der Hauptdachfläche, auf der die Gaube steht (Mansarddach: untere, steile Fläche; Walmseite: Walmneigung) */
export function hauptneigung(d: Dach, seite: GaubenSeite = 0): number {
  if (d.typ === 'mansard' || d.typ === 'mansardwalm') return clampDeg(d.neigungUnten ?? 70);
  if (seite >= 2 && d.typ === 'walm') return clampDeg(d.neigungWalm ?? d.neigung);
  return clampDeg(d.neigung);
}

/**
 * Lage einer Gaube im Grundriss: (a, s) → Punkt, mit a entlang der Traufe (absolut im Dachsystem) und
 * s als waagerechtem Abstand von der Traufe. a0 ist der Rand des Dachs, ab dem „abstand“ zählt.
 */
export function gaubenLage(g: Gaube, fr: RoofFrame): { a0: number; P: (a: number, s: number) => Point } {
  const c = Math.cos(rad(fr.angle));
  const sn = Math.sin(rad(fr.angle));
  const xy = (u: number, v: number) => ({ x: u * c - v * sn, y: u * sn + v * c });
  switch (g.seite) {
    case 1:
      return { a0: fr.u0, P: (a, s) => xy(a, fr.v1 - s) };
    case 2:
      return { a0: fr.v0, P: (a, s) => xy(fr.u0 + s, a) };
    case 3:
      return { a0: fr.v0, P: (a, s) => xy(fr.u1 - s, a) };
    default:
      return { a0: fr.u0, P: (a, s) => xy(a, fr.v0 + s) };
  }
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
  const alpha = hauptneigung(d, g.seite);
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
  for (const g of d.gauben) {
    const m = gaubenMasse(g, d);
    if (m.volumen <= 1e-9) continue;
    const ta = Math.tan(rad(m.alpha));
    const lage = gaubenLage(g, fr);
    // (a, s, Höhe über der Traufe der Dachfläche) → Grundriss
    const P = (a: number, s: number, z: number): Point3 => ({ ...lage.P(a, s), z: d.traufhoehe + z });
    const ua = lage.a0 + g.abstand;
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
  return d.gauben.map((g) => {
    const m = gaubenMasse(g, d);
    const { a0, P } = gaubenLage(g, fr);
    const ua = a0 + g.abstand;
    const ub = ua + g.breite;
    return [P(ua, g.vorne), P(ub, g.vorne), P(ub, g.vorne + m.tiefe), P(ua, g.vorne + m.tiefe)];
  });
}
