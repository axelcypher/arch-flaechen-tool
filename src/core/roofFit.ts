import type { Gaube } from './gaube';
import { gaubenMasse, gaubenVolumen } from './gaube';
import type { Point } from './geometry';
import { bounds, pointInPolygon, polygonArea } from './geometry';
import type { Dach } from './roof';
import { autoFirstrichtung, DACH_TYPEN, roofFrame, roofHeightFn, roofStats } from './roof';
import type { DachModell } from './roofMesh';

/**
 * Dachform und Gauben aus einem Gebäudemodell (IFC) ableiten.
 *
 * Die Dachhaut über dem Umriss wird auf einem Raster erfasst; jede Zelle kennt die oberste Dachebene.
 * Die großen Ebenen ergeben die Hauptdachflächen → Firstrichtung, Dachform (Pult, Sattel, Walm,
 * Krüppelwalm, Flach), Neigungen und Traufhöhe. Was deutlich über diese Hauptdachflächen hinausragt,
 * sind Gauben: Breite und Lage aus den Gaubenwänden (sonst aus dem Gaubendach), Art und Neigung aus
 * den Ebenen des Gaubendachs. Übernommen wird das Ergebnis nur, wenn Dachform + Gauben den Rauminhalt
 * des Modells auf wenige Prozent treffen – sonst bleibt es beim Dach aus dem Modell.
 */

export interface DachErkennung {
  dach: Dach;
  /** relative Abweichung des Rauminhalts gegenüber dem Modell */
  abweichung: number;
  /** z. B. „Walmdach 45°, Traufe 0,00 m, 1 Schleppgaube“ */
  text: string;
}

export interface DachErkennungFehler {
  dach: null;
  grund: string;
}

/** relative Abweichung, bis zu der die erkannte Dachform übernommen wird */
export const ERKENNUNG_TOLERANZ = 0.03;

interface Plane {
  a: number;
  b: number;
  c: number;
}

interface Cluster extends Plane {
  cells: number;
  zref: number;
}

const deg = (r: number) => (r * 180) / Math.PI;
const rnd = (v: number, step: number) => Math.round(v / step) * step + 0;

/**
 * @param waende Dreiecke von Wänden/Fenstern (je 9 Werte, absolute Höhe) zum Vermessen der Gauben
 */
export function dachAusModell(m: DachModell, pts: Point[], floorZ: number, waende: ArrayLike<number>[] = []): DachErkennung | DachErkennungFehler {
  const area = polygonArea(pts);
  if (area < 1) return { dach: null, grund: 'Umriss zu klein' };
  const b = bounds(pts);
  const res = Math.max(0.05, Math.max(b.maxX - b.minX, b.maxY - b.minY) / 600);
  const w = Math.max(1, Math.ceil((b.maxX - b.minX) / res));
  const h = Math.max(1, Math.ceil((b.maxY - b.minY) / res));

  // Ebene je Dreieck, oberstes Dreieck je Zelle
  const t = m.triangles;
  const nTri = Math.floor(t.length / 9);
  const planes: (Plane | null)[] = new Array(nTri).fill(null);
  const cellZ = new Float64Array(w * h).fill(NaN);
  const cellTri = new Int32Array(w * h).fill(-1);
  for (let k = 0; k < nTri; k++) {
    const i = k * 9;
    const [x1, y1, z1, x2, y2, z2, x3, y3, z3] = [t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 4], t[i + 5], t[i + 6], t[i + 7], t[i + 8]];
    const det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    if (Math.abs(det) < 1e-9) continue;
    const a = ((z2 - z1) * (y3 - y1) - (z3 - z1) * (y2 - y1)) / det;
    const bb = ((z3 - z1) * (x2 - x1) - (z2 - z1) * (x3 - x1)) / det;
    planes[k] = { a, b: bb, c: z1 - a * x1 - bb * y1 };
    const X = (x: number) => (x - b.minX) / res - 0.5;
    const Y = (y: number) => (y - b.minY) / res - 0.5;
    const ax = X(x1);
    const ay = Y(y1);
    const bx = X(x2);
    const by = Y(y2);
    const cx = X(x3);
    const cy = Y(y3);
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    const px0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const px1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const py0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const py1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const zz = l1 * z1 + l2 * z2 + l3 * z3;
        const q = py * w + px;
        if (!(cellZ[q] >= zz)) {
          cellZ[q] = zz;
          cellTri[q] = k;
        }
      }
    }
  }

  // Zellen im Umriss
  const inside: number[] = [];
  const cellPt = (q: number): Point => ({ x: b.minX + ((q % w) + 0.5) * res, y: b.minY + (Math.floor(q / w) + 0.5) * res });
  let covered = 0;
  for (let q = 0; q < w * h; q++) {
    if (!pointInPolygon(cellPt(q), pts)) continue;
    inside.push(q);
    if (cellTri[q] >= 0) covered++;
  }
  if (!inside.length || covered / inside.length < 0.95) return { dach: null, grund: 'Dachhaut deckt den Umriss nicht vollständig ab' };
  const cellArea = area / inside.length;
  // Rauminhalt des Modells auf demselben Raster (wie meshRoofStats ohne Begrenzung)
  const vModell = inside.reduce((s, q) => s + Math.max(cellZ[q] - floorZ, 0), 0) * cellArea;

  // Ebenen zusammenfassen
  const xc = (b.minX + b.maxX) / 2;
  const yc = (b.minY + b.maxY) / 2;
  const clusters: Cluster[] = [];
  const triCluster = new Map<number, number>();
  const counts = new Map<number, number>();
  for (const q of inside) if (cellTri[q] >= 0) counts.set(cellTri[q], (counts.get(cellTri[q]) ?? 0) + 1);
  for (const [k, n] of [...counts.entries()].sort((x, y) => y[1] - x[1])) {
    const p = planes[k]!;
    const zref = p.a * xc + p.b * yc + p.c;
    const j = clusters.findIndex((cl) => Math.abs(cl.a - p.a) < 0.01 && Math.abs(cl.b - p.b) < 0.01 && Math.abs(cl.zref - zref) < 0.03);
    if (j >= 0) {
      clusters[j].cells += n;
      triCluster.set(k, j);
    } else {
      triCluster.set(k, clusters.length);
      clusters.push({ ...p, zref, cells: n });
    }
  }
  const cellCluster = (q: number) => (cellTri[q] >= 0 ? (triCluster.get(cellTri[q]) ?? -1) : -1);

  // Firstrichtung aus der größten geneigten Fläche (auf Wandrichtung einrasten)
  const flatTol = Math.tan((2 * Math.PI) / 180);
  const main = clusters.find((cl) => Math.hypot(cl.a, cl.b) > flatTol);
  const flatCells = clusters.filter((cl) => Math.hypot(cl.a, cl.b) <= flatTol).reduce((s, cl) => s + cl.cells, 0);
  if (!main || flatCells > 0.9 * covered) {
    // Flachdach: Traufhöhe = mittlere Höhe
    const hm = vModell / area;
    if (hm <= 0) return { dach: null, grund: 'keine Höhe über dem Fußboden' };
    const dach: Dach = { typ: 'flach', traufhoehe: rnd(hm, 0.001), neigung: 0 };
    const v = area * dach.traufhoehe;
    return { dach, abweichung: Math.abs(v - vModell) / vModell, text: `Flachdach, Höhe ${fmtM(dach.traufhoehe)}` };
  }
  let angle = ((deg(Math.atan2(-main.b, -main.a)) + 90) % 180 + 180) % 180;
  const wand = autoFirstrichtung(pts);
  for (const cand of [wand, (wand + 90) % 180]) {
    const diff = Math.abs(((angle - cand + 90) % 180 + 180) % 180 - 90);
    if (diff < 3) angle = cand;
  }
  const fr = roofFrame({ typ: 'flach', traufhoehe: 0, neigung: 0, firstrichtung: angle }, pts);
  const cs = Math.cos((angle * Math.PI) / 180);
  const sn = Math.sin((angle * Math.PI) / 180);
  const grad = (p: Plane) => ({ gu: p.a * cs + p.b * sn, gv: -p.a * sn + p.b * cs });
  const at = (p: Plane, u: number, v: number) => p.a * (u * cs - v * sn) + p.b * (u * sn + v * cs) + p.c - floorZ;
  const uMid = (fr.u0 + fr.u1) / 2;
  const vMid = (fr.v0 + fr.v1) / 2;

  // Flächen nach Richtung; Hauptdachfläche ist die, die an der Traufe am tiefsten liegt
  // (eine große Gaube kann mehr Fläche haben als der Rest der Dachfläche, liegt aber höher)
  type Richtung = 'v0' | 'v1' | 'u0' | 'u1';
  const faces: Record<Richtung, Cluster | undefined> = { v0: undefined, v1: undefined, u0: undefined, u1: undefined };
  const traufe = (cl: Cluster, r: Richtung) => (r === 'v0' ? at(cl, uMid, fr.v0) : r === 'v1' ? at(cl, uMid, fr.v1) : r === 'u0' ? at(cl, fr.u0, vMid) : at(cl, fr.u1, vMid));
  for (const cl of clusters) {
    const { gu, gv } = grad(cl);
    const s = Math.hypot(gu, gv);
    if (s <= flatTol || cl.cells < 0.02 * covered) continue;
    let r: Richtung | null = null;
    if (Math.abs(gu) < 0.1 * s) r = gv > 0 ? 'v0' : 'v1';
    else if (Math.abs(gv) < 0.1 * s) r = gu > 0 ? 'u0' : 'u1';
    if (!r) continue;
    const cur = faces[r];
    if (!cur || traufe(cl, r) < traufe(cur, r) - 0.05 || (Math.abs(traufe(cl, r) - traufe(cur, r)) <= 0.05 && cl.cells > cur.cells)) faces[r] = cl;
  }
  const share = (cl: Cluster | undefined) => (cl ? cl.cells / covered : 0);
  const slopeDeg = (cl: Cluster) => {
    const { gu, gv } = grad(cl);
    return deg(Math.atan(Math.hypot(gu, gv)));
  };

  // Kandidaten für die Hauptdachform
  const kandidaten: Dach[] = [];
  const v0 = share(faces.v0) > 0.05 ? faces.v0 : undefined;
  const v1 = share(faces.v1) > 0.05 ? faces.v1 : undefined;
  if (v0 && v1) {
    const n0 = slopeDeg(v0);
    const n1 = slopeDeg(v1);
    const t0 = at(v0, uMid, fr.v0);
    const t1 = at(v1, uMid, fr.v1);
    if (Math.abs(n0 - n1) < 1.5 && Math.abs(t0 - t1) < 0.05) {
      const neigung = rnd((n0 + n1) / 2, 0.01);
      const traufhoehe = rnd((t0 + t1) / 2, 0.001);
      const hip = [faces.u0, faces.u1].filter((x): x is Cluster => share(x) > 0.01);
      if (hip.length) {
        const neigungWalm = rnd(hip.reduce((s, x) => s + slopeDeg(x), 0) / hip.length, 0.01);
        const hipTrauf = hip.reduce((s, x) => s + (x === faces.u0 ? at(x, fr.u0, vMid) : at(x, fr.u1, vMid)), 0) / hip.length;
        const firstH = ((fr.v1 - fr.v0) / 2) * Math.tan((neigung * Math.PI) / 180);
        if (hipTrauf - traufhoehe > 0.1) kandidaten.push({ typ: 'kruppelwalm', traufhoehe, neigung, neigungWalm, krueppelHoehe: rnd(firstH - (hipTrauf - traufhoehe), 0.001), firstrichtung: angle });
        else kandidaten.push({ typ: 'walm', traufhoehe, neigung, neigungWalm, firstrichtung: angle });
      }
      kandidaten.push({ typ: 'sattel', traufhoehe, neigung, firstrichtung: angle });
    }
  } else if (v0 || v1) {
    const f = (v0 ?? v1)!;
    const traufhoehe = rnd(v0 ? at(f, uMid, fr.v0) : at(f, uMid, fr.v1), 0.001);
    kandidaten.push({ typ: 'pult', traufhoehe, neigung: rnd(slopeDeg(f), 0.01), firstrichtung: angle, ...(v1 ? { umkehren: true } : {}) });
  }
  if (!kandidaten.length) return { dach: null, grund: 'keine Standard-Dachform erkennbar (Dachflächen unterschiedlich geneigt oder versetzt)' };

  let best: DachErkennung | null = null;
  let letzterGrund = '';
  for (const k of kandidaten) {
    if (k.traufhoehe < -0.05) {
      letzterGrund = 'Traufe liegt unter dem Fußboden des Geschosses';
      continue;
    }
    const r = mitGauben(k);
    if (r.dach === null) {
      letzterGrund = r.grund;
      continue;
    }
    if (!best || r.abweichung < best.abweichung) best = r;
  }
  if (!best) return { dach: null, grund: letzterGrund || 'Dachform nicht bestimmbar' };
  if (best.abweichung > ERKENNUNG_TOLERANZ) return { dach: null, grund: `erkannte Form weicht um ${(best.abweichung * 100).toFixed(1).replace('.', ',')} % vom Modell ab` };
  return best;

  /** Gauben über einer Hauptdachform suchen und das Ergebnis gegen das Modell prüfen */
  function mitGauben(d: Dach): DachErkennung | DachErkennungFehler {
    const hp = roofHeightFn(d, pts);
    const res2 = new Float64Array(w * h).fill(NaN);
    for (const q of inside) if (cellTri[q] >= 0) res2[q] = cellZ[q] - floorZ - hp(cellPt(q));
    const seen = new Uint8Array(w * h);
    const gauben: Gaube[] = [];
    const ta = Math.tan((d.neigung * Math.PI) / 180);
    const mitteV = (fr.v0 + fr.v1) / 2;
    for (const q0 of inside) {
      if (seen[q0] || !(res2[q0] > 0.08)) continue;
      // zusammenhängender Bereich über der Dachfläche
      const comp: number[] = [];
      const stack = [q0];
      seen[q0] = 1;
      while (stack.length) {
        const q = stack.pop()!;
        comp.push(q);
        const x = q % w;
        const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w];
        for (const j of nb) {
          if (j >= 0 && j < w * h && !seen[j] && res2[j] > 0.08) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
      if (comp.length * cellArea < 0.4) continue;
      const uv = comp.map((q) => {
        const p = cellPt(q);
        return { u: p.x * cs + p.y * sn, v: -p.x * sn + p.y * cs, q };
      });
      const meanV = uv.reduce((s, x) => s + x.v, 0) / uv.length;
      const seite: 0 | 1 = d.typ === 'pult' ? (d.umkehren ? 1 : 0) : meanV < mitteV ? 0 : 1;
      const sOf = (v: number) => (seite === 0 ? v - fr.v0 : fr.v1 - v);
      let umin = Math.min(...uv.map((x) => x.u)) - res / 2;
      let umax = Math.max(...uv.map((x) => x.u)) + res / 2;
      let smin = Math.max(0, Math.min(...uv.map((x) => sOf(x.v))) - res / 2);
      const smax = Math.max(...uv.map((x) => sOf(x.v))) + res / 2;
      // Gaubenwände: Außenkanten statt Dachüberstand
      const wv = wandPunkte(waende, cs, sn, floorZ, hp, umin - 0.8, umax + 0.8, smin - 0.8, smax + 0.8, sOf);
      let ausWaenden = false;
      if (wv.length >= 3 && Math.max(...wv.map((p) => p.u)) - Math.min(...wv.map((p) => p.u)) > 0.3) {
        umin = Math.max(umin, Math.min(...wv.map((p) => p.u)));
        umax = Math.min(umax, Math.max(...wv.map((p) => p.u)));
        smin = Math.max(smin, Math.max(0, Math.min(...wv.map((p) => p.s))));
        ausWaenden = true;
      }
      // Ebenen des Gaubendachs
      const byCl = new Map<number, number>();
      for (const x of uv) {
        const c = cellCluster(x.q);
        if (c >= 0) byCl.set(c, (byCl.get(c) ?? 0) + 1);
      }
      const top = [...byCl.entries()].sort((a, bb) => bb[1] - a[1]);
      const B = umax - umin;
      const uM = (umin + umax) / 2;
      const vAt = (s: number) => (seite === 0 ? fr.v0 + s : fr.v1 - s);
      const dirS = seite === 0 ? 1 : -1;
      const hDach = (s: number) => d.traufhoehe + s * ta;
      const g0 = grad(clusters[top[0][0]]);
      const ds0 = g0.gv * dirS;
      const tan3 = Math.tan((3 * Math.PI) / 180);
      let g: Gaube | null = null;
      if (top[0][1] / uv.length > 0.8 && Math.abs(g0.gu) < tan3) {
        // Schlepp- oder Flachdachgaube
        const tb = Math.max(0, ds0);
        const hf = at(clusters[top[0][0]], uM, vAt(smin)) - hDach(smin);
        if (ta - tb > 1e-3 && hf > 0.05) {
          const beta = deg(Math.atan(tb));
          const flach = beta < 0.5;
          g = { typ: flach ? 'flach' : 'schlepp', seite, abstand: rnd(umin - fr.u0, 0.001), breite: rnd(B, 0.001), vorne: rnd(smin, 0.001), tiefe: rnd(hf / (ta - (flach ? 0 : tb)), 0.001) };
          if (!flach) g.neigung = rnd(beta, 0.01);
        }
      } else if (top.length >= 2 && (top[0][1] + top[1][1]) / uv.length > 0.8) {
        // Satteldachgaube: zwei Flächen mit Gefälle quer zur Gaube
        const p1 = clusters[top[0][0]];
        const p2 = clusters[top[1][0]];
        const g1 = grad(p1);
        const g2 = grad(p2);
        if (Math.abs(g1.gv) < tan3 && Math.abs(g2.gv) < tan3 && g1.gu * g2.gu < 0) {
          const gamma = deg(Math.atan((Math.abs(g1.gu) + Math.abs(g2.gu)) / 2));
          const links = g1.gu > 0 ? p1 : p2;
          const hw = at(links, umin, vAt(smin)) - hDach(smin);
          if (hw > -0.05) g = { typ: 'sattel', seite, abstand: rnd(umin - fr.u0, 0.001), breite: rnd(B, 0.001), vorne: rnd(smin, 0.001), wandhoehe: rnd(Math.max(0, hw), 0.001), dachneigung: rnd(gamma, 0.01) };
        }
      }
      if (!g) return { dach: null, grund: 'Gaube mit nicht unterstützter Form (z. B. Walm- oder Fledermausgaube)' };
      if (!ausWaenden) g.name = 'Maße aus dem Gaubendach';
      if (gaubenMasse(g, d).volumen > 0.05) gauben.push(g);
    }
    const dach: Dach = gauben.length ? { ...d, gauben } : d;
    const v = Math.abs(roofStats(dach, pts).volumen) + gaubenVolumen(dach);
    const label = DACH_TYPEN.find((x) => x.id === dach.typ)?.label ?? 'Dach';
    const gText = gauben.length ? `, ${gauben.length} ${gauben.length === 1 ? 'Gaube' : 'Gauben'}` : '';
    return { dach, abweichung: Math.abs(v - vModell) / vModell, text: `${label} ${fmtDeg(dach.neigung)}, Traufe ${fmtM(dach.traufhoehe)}${gText}` };
  }
}

/** Punkte von Wänden/Fenstern, die über der Hauptdachfläche liegen, im Bereich einer Gaube – in (u, s) */
function wandPunkte(
  waende: ArrayLike<number>[],
  cs: number,
  sn: number,
  floorZ: number,
  hp: (p: Point) => number,
  u0: number,
  u1: number,
  s0: number,
  s1: number,
  sOf: (v: number) => number,
): { u: number; s: number }[] {
  const out: { u: number; s: number }[] = [];
  for (const t of waende) {
    for (let i = 0; i + 2 < t.length; i += 3) {
      const x = t[i];
      const y = t[i + 1];
      const u = x * cs + y * sn;
      if (u < u0 || u > u1) continue;
      const s = sOf(-x * sn + y * cs);
      if (s < s0 || s > s1) continue;
      if (t[i + 2] - floorZ > hp({ x, y }) + 0.05) out.push({ u, s });
    }
  }
  return out;
}

const fmtM = (v: number) => `${v.toFixed(2).replace('.', ',')} m`;
const fmtDeg = (v: number) => `${(Math.round(v * 10) / 10).toString().replace('.', ',')}°`;
