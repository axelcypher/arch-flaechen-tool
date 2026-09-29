import type { Gaube } from './gaube';
import { gaubenFaces } from './gaube';
import type { Point } from './geometry';
import { distance } from './geometry';

/**
 * Dachformen und Rauminhalt unter dem Dach.
 *
 * Ein Dach wird über einem BGF-Umriss als Höhenfunktion h(x, y) über dem Fußboden des Geschosses beschrieben:
 *   h = Traufhöhe + Dachprofil(x, y)
 * Das Dachprofil ist stückweise eben. Für fast alle Dachformen ist es das Minimum mehrerer Ebenen
 * (Satteldach = Minimum zweier Dachflächen, Walmdach = Minimum von vier …). Der Umriss wird in die
 * Bereiche der einzelnen Ebenen zerlegt (Polygon-Clipping); in jedem Bereich ist h linear, das Integral
 * also exakt Fläche × h(Schwerpunkt). Damit sind Volumen und 3D-Geometrie auch für nicht rechteckige
 * Umrisse exakt – die Dachgeometrie selbst wird dabei über das umschließende Rechteck in Firstrichtung
 * aufgespannt (bei L-Formen ggf. den Umriss teilen und jedem Teil ein eigenes Dach geben).
 */

export type DachTyp =
  | 'flach'
  | 'pult'
  | 'sattel'
  | 'walm'
  | 'kruppelwalm'
  | 'zelt'
  | 'mansard'
  | 'mansardwalm'
  | 'tonne'
  | 'shed'
  | 'modell';

export interface Dach {
  typ: DachTyp;
  /** Höhe der Traufe (Schnitt Außenwand/Dachhaut, OK Dachhaut) über dem Fußboden des Geschosses in m */
  traufhoehe: number;
  /** Dachneigung in Grad (Hauptdachflächen; beim Mansarddach die obere, flache Neigung) */
  neigung: number;
  /** Neigung der Walmflächen in Grad (Walm, Krüppelwalm, Mansardwalm); Standard = neigung */
  neigungWalm?: number;
  /** Firstrichtung im Grundriss in Grad; undefiniert = entlang der längsten Außenkante */
  firstrichtung?: number;
  /** Pultdach: hohe Seite umkehren */
  umkehren?: boolean;
  /** Krüppelwalm: senkrechte Höhe des Walms unterhalb des Firsts in m */
  krueppelHoehe?: number;
  /** Mansarddach: Neigung der unteren, steilen Dachfläche in Grad */
  neigungUnten?: number;
  /** Mansarddach: Höhe des unteren Dachteils (Traufe bis Knick) in m */
  hoeheUnten?: number;
  /** Tonnendach: Stichhöhe des Bogens in m */
  stich?: number;
  /** Sheddach: Anzahl der Sheds und Höhe je Shed in m */
  shedAnzahl?: number;
  shedHoehe?: number;
  /** Dach aus Modell (IFC): maximale Höhe über Fußboden (z. B. Geschosshöhe, wenn darüber ein Geschoss folgt) */
  maxHoehe?: number;
  /** Dachgauben auf den Traufseiten (siehe gaube.ts); ihr Rauminhalt kommt zum Dach hinzu */
  gauben?: Gaube[];
}

export const DACH_TYPEN: { id: DachTyp; label: string; hint: string }[] = [
  { id: 'flach', label: 'Flachdach', hint: 'Oberer Abschluss auf Traufhöhe (inkl. Attika/Dachaufbau)' },
  { id: 'pult', label: 'Pultdach', hint: 'Eine geneigte Dachfläche' },
  { id: 'sattel', label: 'Satteldach', hint: 'Zwei Dachflächen, Giebel an den Stirnseiten' },
  { id: 'walm', label: 'Walmdach', hint: 'Vier Dachflächen, Walme an den Stirnseiten' },
  { id: 'kruppelwalm', label: 'Krüppelwalm', hint: 'Satteldach mit kleinem Walm im Giebeldreieck' },
  { id: 'zelt', label: 'Zeltdach', hint: 'Walmdach mit gleicher Neigung aller Flächen (Pyramide über Quadrat)' },
  { id: 'mansard', label: 'Mansarddach', hint: 'Geknicktes Satteldach: steil unten, flach oben' },
  { id: 'mansardwalm', label: 'Mansardwalm', hint: 'Mansarddach mit geknickten Walmen' },
  { id: 'tonne', label: 'Tonnendach', hint: 'Kreisbogenförmiges Dach' },
  { id: 'shed', label: 'Sheddach', hint: 'Sägezahndach mit mehreren Sheds' },
];

export function defaultDach(typ: DachTyp, traufhoehe: number): Dach {
  const d: Dach = { typ, traufhoehe, neigung: 35 };
  switch (typ) {
    case 'flach':
      d.neigung = 0;
      break;
    case 'pult':
      d.neigung = 10;
      break;
    case 'walm':
      d.neigungWalm = 45;
      break;
    case 'kruppelwalm':
      d.neigung = 40;
      d.neigungWalm = 55;
      d.krueppelHoehe = 1.2;
      break;
    case 'zelt':
      d.neigung = 30;
      break;
    case 'mansard':
    case 'mansardwalm':
      d.neigung = 25;
      d.neigungUnten = 70;
      d.hoeheUnten = 2.5;
      break;
    case 'tonne':
      d.stich = 1.5;
      break;
    case 'shed':
      d.shedAnzahl = 3;
      d.shedHoehe = 1.5;
      break;
  }
  return d;
}

/* ---------- lineare Funktionen und Clipping ---------- */

/** h = a·x + b·y + c */
export type Linear = [number, number, number];

export interface RoofPiece {
  /** Höhe über Fußboden in diesem Bereich */
  f: Linear;
  /** Bereich: alle Bedingungen g(x, y) ≤ 0 */
  cons: Linear[];
}

export interface RoofFrame {
  /** Firstrichtung in Grad */
  angle: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const evalL = (l: Linear, p: Point) => l[0] * p.x + l[1] * p.y + l[2];
const sub = (a: Linear, b: Linear): Linear => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Richtung der längsten Kante in Grad (0 … 180) */
export function autoFirstrichtung(pts: Point[]): number {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = distance(a, b);
    if (len > bestLen + 1e-9) {
      bestLen = len;
      best = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    }
  }
  return ((best % 180) + 180) % 180;
}

export function roofFrame(d: Dach, pts: Point[]): RoofFrame {
  const angle = d.firstrichtung ?? autoFirstrichtung(pts);
  const c = Math.cos(rad(angle));
  const s = Math.sin(rad(angle));
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of pts) {
    const u = p.x * c + p.y * s;
    const v = -p.x * s + p.y * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  return { angle, u0, u1, v0, v1 };
}

/**
 * Zerlegt das Dach in ebene Teilstücke. Funktionen werden im (u, v)-System (u entlang First, v quer)
 * aufgestellt und dann in Grundrisskoordinaten umgerechnet.
 */
export function roofPieces(d: Dach, pts: Point[]): { frame: RoofFrame; pieces: RoofPiece[] } {
  const fr = roofFrame(d, pts);
  const c = Math.cos(rad(fr.angle));
  const s = Math.sin(rad(fr.angle));
  // (α, β, γ) in u/v → (a, b, c) in x/y
  const L = (alpha: number, beta: number, gamma: number): Linear => [alpha * c - beta * s, alpha * s + beta * c, gamma];
  const { u0, u1, v0, v1 } = fr;
  const B = v1 - v0;
  const t = Math.tan(rad(clampDeg(d.neigung)));
  const tw = Math.tan(rad(clampDeg(d.neigungWalm ?? d.neigung)));
  const h0 = d.traufhoehe;

  const minOf = (funcs: Linear[]): RoofPiece[] =>
    funcs.map((fi, i) => ({ f: fi, cons: funcs.filter((_, j) => j !== i).map((fj) => sub(fi, fj)) }));

  // Dachflächen, die von der Traufe (Rand des Rechtecks) mit Neigung m ansteigen
  const fromV0 = (m: number, off = 0): Linear => L(0, m, h0 + off - m * v0);
  const fromV1 = (m: number, off = 0): Linear => L(0, -m, h0 + off + m * v1);
  const fromU0 = (m: number, off = 0): Linear => L(m, 0, h0 + off - m * u0);
  const fromU1 = (m: number, off = 0): Linear => L(-m, 0, h0 + off + m * u1);

  let pieces: RoofPiece[];
  switch (d.typ) {
    case 'flach':
    case 'modell':
      pieces = [{ f: L(0, 0, h0), cons: [] }];
      break;
    case 'pult':
      pieces = [{ f: d.umkehren ? fromV1(t) : fromV0(t), cons: [] }];
      break;
    case 'sattel':
      pieces = minOf([fromV0(t), fromV1(t)]);
      break;
    case 'walm':
      pieces = minOf([fromV0(t), fromV1(t), fromU0(tw), fromU1(tw)]);
      break;
    case 'zelt':
      pieces = minOf([fromV0(t), fromV1(t), fromU0(t), fromU1(t)]);
      break;
    case 'kruppelwalm': {
      const firstH = (t * B) / 2;
      const hk = Math.min(Math.max(d.krueppelHoehe ?? 1, 0), firstH);
      // Giebelwand bis (First − hk), darüber kleiner Walm
      pieces = minOf([fromV0(t), fromV1(t), fromU0(tw, firstH - hk), fromU1(tw, firstH - hk)]);
      break;
    }
    case 'mansard':
    case 'mansardwalm': {
      const t1 = Math.tan(rad(clampDeg(d.neigungUnten ?? 70)));
      const hm = Math.max(0, d.hoeheUnten ?? 2.5);
      const dm = t1 > 1e-9 ? hm / t1 : 0;
      const funcs = [fromV0(t1), fromV1(t1), fromV0(t, hm - t * dm), fromV1(t, hm - t * dm)];
      if (d.typ === 'mansardwalm') funcs.push(fromU0(t1), fromU1(t1), fromU0(t, hm - t * dm), fromU1(t, hm - t * dm));
      pieces = minOf(funcs);
      break;
    }
    case 'tonne': {
      const f = Math.max(1e-6, d.stich ?? 1.5);
      const R = (B * B) / 4 / (2 * f) + f / 2;
      const vc = (v0 + v1) / 2;
      const N = 48;
      const funcs: Linear[] = [];
      for (let i = 0; i < N; i++) {
        const va = v0 + (B * i) / N;
        const vb = v0 + (B * (i + 1)) / N;
        const ha = Math.sqrt(Math.max(R * R - (va - vc) ** 2, 0)) - (R - f);
        const hb = Math.sqrt(Math.max(R * R - (vb - vc) ** 2, 0)) - (R - f);
        const m = (hb - ha) / (vb - va);
        funcs.push(L(0, m, h0 + ha - m * va));
      }
      pieces = minOf(funcs);
      break;
    }
    case 'shed': {
      const n = Math.max(1, Math.round(d.shedAnzahl ?? 3));
      const H = Math.max(0, d.shedHoehe ?? 1.5);
      const w = B / n;
      pieces = [];
      for (let k = 0; k < n; k++) {
        const a = v0 + k * w;
        const m = w > 1e-9 ? H / w : 0;
        const cons: Linear[] = [];
        if (k > 0) cons.push(L(0, -1, a)); // v ≥ a
        if (k < n - 1) cons.push(L(0, 1, -(a + w))); // v ≤ a + w
        pieces.push({ f: L(0, m, h0 - m * a), cons });
      }
      break;
    }
  }
  return { frame: fr, pieces };
}

function clampDeg(v: number) {
  return Math.min(Math.max(v, 0), 89);
}

/** Sutherland-Hodgman: Polygon auf {g ≤ 0} beschneiden (auch für nicht konvexe Polygone flächenrichtig). */
export function clipHalfPlane(pts: Point[], g: Linear): Point[] {
  const out: Point[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ga = evalL(g, a);
    const gb = evalL(g, b);
    const ina = ga <= 1e-12;
    const inb = gb <= 1e-12;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = ga / (ga - gb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

export interface ClippedPiece {
  f: Linear;
  poly: Point[];
}

export function clippedPieces(d: Dach, pts: Point[]): ClippedPiece[] {
  const { pieces } = roofPieces(d, pts);
  const out: ClippedPiece[] = [];
  for (const pc of pieces) {
    let poly = pts;
    for (const g of pc.cons) {
      poly = clipHalfPlane(poly, g);
      if (poly.length < 3) break;
    }
    if (poly.length >= 3 && Math.abs(signedArea2(poly)) > 1e-12) out.push({ f: pc.f, poly });
  }
  return out;
}

/** doppelte vorzeichenbehaftete Fläche */
function signedArea2(p: Point[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

/** ∫∫ f dA über das Polygon (vorzeichenbehaftet nach Umlaufsinn) */
function integrateLinear(poly: Point[], f: Linear): number {
  let A2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cr = p.x * q.y - q.x * p.y;
    A2 += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  const A = A2 / 2;
  // ∫x dA = cx/6, ∫y dA = cy/6
  return f[0] * (cx / 6) + f[1] * (cy / 6) + f[2] * A;
}

export interface RoofStats {
  /** Rauminhalt vom Fußboden bis zur Dachhaut in m³ */
  volumen: number;
  /** davon oberhalb der Traufe */
  dachvolumen: number;
  /** größte Höhe (First) über Fußboden */
  firsthoehe: number;
  frame: RoofFrame;
}

export function roofStats(d: Dach, pts: Point[]): RoofStats {
  const { frame } = roofPieces(d, pts);
  const parts = clippedPieces(d, pts);
  const sign = Math.sign(signedArea2(pts)) || 1;
  let vol = 0;
  let maxH = d.traufhoehe;
  for (const p of parts) {
    vol += integrateLinear(p.poly, p.f);
    for (const q of p.poly) maxH = Math.max(maxH, evalL(p.f, q));
  }
  vol *= sign;
  const area = Math.abs(signedArea2(pts)) / 2;
  // Tonnendach über Rechteck: exakter Kreisabschnitt statt Sehnennäherung
  if (d.typ === 'tonne' && isFrameRect(frame, area)) {
    const B = frame.v1 - frame.v0;
    const L = frame.u1 - frame.u0;
    vol = area * d.traufhoehe + kreisabschnitt(B, Math.max(1e-6, d.stich ?? 1.5)) * L;
  }
  return { volumen: vol, dachvolumen: vol - area * d.traufhoehe, firsthoehe: maxH, frame };
}

/** Ist der Umriss das umschließende Rechteck in Firstrichtung? (Toleranz für gerundete Modellkoordinaten) */
export function isFrameRect(fr: RoofFrame, area: number): boolean {
  const r = (fr.u1 - fr.u0) * (fr.v1 - fr.v0);
  return Math.abs(r - area) <= 1e-4 * Math.max(1, r);
}

/** Fläche eines Kreisabschnitts mit Sehne s und Stich f */
export function kreisabschnitt(s: number, f: number): number {
  const R = (s * s) / 4 / (2 * f) + f / 2;
  return R * R * Math.acos((R - f) / R) - (R - f) * Math.sqrt(Math.max(2 * R * f - f * f, 0));
}

/** Höhenfunktion h(x, y) über Fußboden; Teilstücke werden einmal vorberechnet. */
export function roofHeightFn(d: Dach, pts: Point[]): (p: Point) => number {
  const { pieces } = roofPieces(d, pts);
  return (p) => {
    let best = -Infinity;
    // Stück finden, dessen Bedingungen erfüllt sind (bei min-Dächern entspricht das dem Minimum)
    for (const pc of pieces) if (pc.cons.every((g) => evalL(g, p) <= 1e-9)) best = Math.max(best, evalL(pc.f, p));
    return best;
  };
}

export function roofHeightAt(d: Dach, pts: Point[], p: Point): number {
  return roofHeightFn(d, pts)(p);
}

/* ---------- Körpergeometrie (für 3D-Ansicht und Symbole) ---------- */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface SolidFaces {
  /** Dachflächen (eben, Umlauf wie Grundriss) */
  tops: Point3[][];
  /** senkrechte Flächen: Außenwände bis zur Dachhaut, Stufen zwischen Dachteilen */
  sides: Point3[][];
  /** Bodenfläche (z = 0) */
  bottom: Point3[];
}

/**
 * Geschlossener Körper vom Fußboden (z = 0) bis zur Dachhaut. Ohne Dach: Prisma mit Höhe h.
 */
export function solidFaces(pts: Point[], dach: Dach | undefined, h: number): SolidFaces {
  const d: Dach = dach && dach.typ !== 'modell' ? dach : { typ: 'flach', traufhoehe: h, neigung: 0 };
  const parts = clippedPieces(d, pts);
  const tops = parts.map((p) => p.poly.map((q) => ({ x: q.x, y: q.y, z: evalL(p.f, q) })));
  const sides: Point3[][] = [];
  const onSeg = (q: Point, a: Point, b: Point) => {
    const len = distance(a, b);
    if (len < 1e-12) return -1;
    const t = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (len * len);
    const cross = Math.abs((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) / len;
    return cross < 1e-7 && t > -1e-9 && t < 1 + 1e-9 ? t : -1;
  };

  // Außenwände: Profil der Dachhaut entlang jeder Kante
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const prof: { t: number; z: number }[] = [];
    for (const p of parts) {
      for (let k = 0; k < p.poly.length; k++) {
        const q = p.poly[k];
        const t = onSeg(q, a, b);
        if (t >= 0) prof.push({ t, z: evalL(p.f, q) });
      }
    }
    prof.sort((x, y) => x.t - y.t || x.z - y.z);
    if (!prof.length) continue;
    const top: Point3[] = [];
    for (const pr of prof) {
      const last = top[top.length - 1];
      const x = a.x + (b.x - a.x) * pr.t;
      const y = a.y + (b.y - a.y) * pr.t;
      if (last && Math.abs(last.x - x) < 1e-9 && Math.abs(last.y - y) < 1e-9 && Math.abs(last.z - pr.z) < 1e-9) continue;
      top.push({ x, y, z: pr.z });
    }
    sides.push([{ x: a.x, y: a.y, z: 0 }, ...top, { x: b.x, y: b.y, z: 0 }]);
  }

  // Stufen zwischen Dachteilen (Sheddach)
  const edges: { a: Point3; b: Point3 }[] = [];
  for (const tp of tops) for (let k = 0; k < tp.length; k++) edges.push({ a: tp[k], b: tp[(k + 1) % tp.length] });
  const same = (p: Point3, q: Point3) => Math.abs(p.x - q.x) < 1e-7 && Math.abs(p.y - q.y) < 1e-7;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const e = edges[i];
      const f = edges[j];
      if (!(same(e.a, f.b) && same(e.b, f.a))) continue;
      if (Math.abs(e.a.z - f.b.z) < 1e-6 && Math.abs(e.b.z - f.a.z) < 1e-6) continue;
      sides.push([e.a, e.b, f.a, f.b]);
    }
  }
  // Gauben auf den Dachflächen
  const g = gaubenFaces(d, roofFrame(d, pts));
  tops.push(...g.tops);
  sides.push(...g.sides);
  return { tops, sides, bottom: pts.map((p) => ({ x: p.x, y: p.y, z: 0 })) };
}
