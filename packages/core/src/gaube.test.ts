import { describe, expect, it } from 'vitest';
import { outlineVolume } from './calc';
import type { Gaube } from './gaube';
import { gaubenFaces, gaubenGrundriss, gaubenMasse } from './gaube';
import type { Point } from './geometry';
import { rectPoints } from './geometry';
import { createOutline, createProject } from './model';
import { briKoerper } from './rechenweg';
import type { Dach, Point3 } from './roof';
import { clippedPieces, roofFrame, roofHeightFn, roofStats } from './roof';
import type { DachModell } from './roofMesh';
import { dachAusModell } from './roofFit';

const rect = rectPoints({ x: 0, y: 0 }, { x: 12, y: 10.75 });
const walm: Dach = { typ: 'walm', traufhoehe: 0, neigung: 45, neigungWalm: 45, firstrichtung: 0 };
const schlepp: Gaube = { typ: 'schlepp', seite: 0, abstand: 3.9, breite: 4.2, vorne: 0.5, tiefe: 4.115, neigung: 25 };
const sattelGaube: Gaube = { typ: 'sattel', seite: 1, abstand: 5, breite: 2.4, vorne: 0.6, wandhoehe: 1.1, dachneigung: 40 };

/** Volumen über der Dachfläche numerisch: Mittelpunktregel über dem Grundriss der Gaube */
function numerisch(d: Dach, pts: Point[], mitGaube: Dach): number {
  const base = roofHeightFn(d, pts);
  const top = hoehenfeld(mitGaube, pts);
  // nur über dem Grundriss der Gauben, fein gerastert
  const g = gaubenGrundriss(mitGaube, roofFrame(d, pts)).flat();
  const [x0, x1, y0, y1] = [Math.min(...g.map((q) => q.x)), Math.max(...g.map((q) => q.x)), Math.min(...g.map((q) => q.y)), Math.max(...g.map((q) => q.y))];
  const n = 600;
  let s = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const p = { x: x0 + ((i + 0.5) / n) * (x1 - x0), y: y0 + ((j + 0.5) / n) * (y1 - y0) };
      s += top(p) - base(p);
    }
  return (s * (x1 - x0) * (y1 - y0)) / (n * n);
}

/** Höhe der obersten Fläche (Dach + Gauben) – aus den 3D-Flächen, so wird auch die Geometrie geprüft */
function hoehenfeld(d: Dach, pts: Point[]) {
  const base = roofHeightFn(d, pts);
  const tops = gaubenFaces(d, roofFrame(d, pts)).tops;
  return (p: Point) => {
    let z = base(p);
    for (const t of tops) {
      const zz = zInPoly(t, p);
      if (zz !== null) z = Math.max(z, zz);
    }
    return z;
  };
}

function zInPoly(poly: Point3[], p: Point): number | null {
  // Fächer-Dreiecke
  for (let k = 1; k + 1 < poly.length; k++) {
    const [a, b, c] = [poly[0], poly[k], poly[k + 1]];
    const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / den;
    const l2 = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / den;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * a.z + l2 * b.z + l3 * c.z;
  }
  return null;
}

describe('Gauben', () => {
  it('Schleppgaube wie in der Büro-Vorlage: 4,2 × 4,115² × (tan 45° − tan 25°) / 2 = 18,98 m³', () => {
    expect(gaubenMasse(schlepp, walm).volumen).toBeCloseTo(18.98, 2);
  });

  it('Formeln stimmen mit der 3D-Geometrie überein', () => {
    // Satteldach: keine Walmflächen im Bereich der Gauben
    const sattel: Dach = { ...walm, typ: 'sattel' };
    for (const g of [schlepp, { ...schlepp, typ: 'flach' as const }, sattelGaube]) {
      const d = { ...sattel, gauben: [g] };
      const v = gaubenMasse(g, sattel).volumen;
      expect(Math.abs(numerisch(sattel, rect, d) - v) / v).toBeLessThan(0.002);
    }
  });

  it('zählt zum BRI und erscheint als eigener Körper mit Formel', () => {
    const p = createProject();
    const o = { ...createOutline(rect), dach: { ...walm, gauben: [schlepp] } };
    p.storeys[0].shapes.push(o);
    expect(outlineVolume(o, p.storeys[0], p)).toBeCloseTo(roofStats(walm, rect).volumen + 18.98, 1);
    const k = briKoerper(p);
    expect(k.map((x) => x.bezeichnung)).toEqual(['Walmdach', 'Schleppgaube']);
    expect(k[1]).toMatchObject({
      art: 'gaube',
      formel: 'B × T² × (tan α − tan β) / 2',
      rechnung: '4,2 × 4,115² × (tan 45° − tan 25°) / 2',
      parameter: 'Hauptdach α: 45°; Gaubendach β: 25°; T: 4,115 m; B: 4,20 m',
    });
    expect(k.reduce((s, x) => s + x.volumen, 0)).toBeCloseTo(outlineVolume(o, p.storeys[0], p), 6);
  });
});

/* ---------- Erkennung aus einem Modell ---------- */

/** Dachhaut wie aus einem IFC-Export: Dachflächen mit Überstand, Gaubendächer mit Überstand, Gaubenwände */
function modell(d: Dach, pts: Point[], ueberstand = 0.5): { m: DachModell; waende: number[][] } {
  const t = Math.tan((d.neigung * Math.PI) / 180);
  const fr = roofFrame(d, pts);
  // größeres Rechteck mit gleichen Dachebenen (Traufe um Überstand × Neigung tiefer)
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const big = rectPoints({ x: Math.min(...xs) - ueberstand, y: Math.min(...ys) - ueberstand }, { x: Math.max(...xs) + ueberstand, y: Math.max(...ys) + ueberstand });
  const bigD: Dach = { ...d, traufhoehe: d.traufhoehe - ueberstand * t, gauben: undefined };
  const tris: number[] = [];
  const fan = (poly: Point3[]) => {
    for (let k = 1; k + 1 < poly.length; k++) for (const q of [poly[0], poly[k], poly[k + 1]]) tris.push(q.x, q.y, q.z);
  };
  for (const pc of clippedPieces(bigD, big)) fan(pc.poly.map((q) => ({ ...q, z: pc.f[0] * q.x + pc.f[1] * q.y + pc.f[2] })));
  // Gaubendächer mit 0,3 m Überstand seitlich (entlang der Traufe der Gaube = Richtung der ersten Kante)
  const gf = gaubenFaces(d, fr);
  for (const top of gf.tops) {
    const cx = top.reduce((s, q) => s + q.x, 0) / top.length;
    const cy = top.reduce((s, q) => s + q.y, 0) / top.length;
    const len = Math.hypot(top[1].x - top[0].x, top[1].y - top[0].y);
    const [dx, dy] = [(top[1].x - top[0].x) / len, (top[1].y - top[0].y) / len];
    // Höhe in der Ebene der Dachfläche weiterführen
    const [p0, p1, p2] = top;
    const det = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
    const A = ((p1.z - p0.z) * (p2.y - p0.y) - (p2.z - p0.z) * (p1.y - p0.y)) / det;
    const Bb = ((p2.z - p0.z) * (p1.x - p0.x) - (p1.z - p0.z) * (p2.x - p0.x)) / det;
    fan(top.map((q) => {
      const k = Math.sign((q.x - cx) * dx + (q.y - cy) * dy) * 0.3;
      const x = q.x + k * dx;
      const y = q.y + k * dy;
      return { x, y, z: q.z + A * (x - q.x) + Bb * (y - q.y) };
    }));
  }
  return { m: { name: 'Test', triangles: tris }, waende: gf.sides.map((s) => s.flatMap((q) => [q.x, q.y, q.z])) };
}

describe('Dachform und Gauben aus dem Modell', () => {
  it('Walmdach mit Schleppgaube', () => {
    const d: Dach = { ...walm, traufhoehe: 0.4, gauben: [schlepp] };
    const { m, waende } = modell(d, rect);
    const e = dachAusModell(m, rect, 0, waende);
    if (!e.dach) throw new Error(e.grund);
    expect(e.dach).toMatchObject({ typ: 'walm', neigung: 45, neigungWalm: 45 });
    expect(e.dach.traufhoehe).toBeCloseTo(0.4, 3);
    expect(e.dach.gauben).toHaveLength(1);
    const g = e.dach.gauben![0];
    expect(g).toMatchObject({ typ: 'schlepp', seite: 0, neigung: 25 });
    expect(g.breite).toBeCloseTo(4.2, 1);
    expect(g.abstand).toBeCloseTo(3.9, 1);
    expect(g.vorne).toBeCloseTo(0.5, 1);
    expect(g.tiefe).toBeCloseTo(4.115, 1);
    expect(e.abweichung).toBeLessThan(0.01);
  });

  it('Satteldach mit Satteldachgaube und Flachdachgaube, Firstrichtung quer', () => {
    const pts = rectPoints({ x: 0, y: 0 }, { x: 9, y: 14 });
    const d: Dach = { typ: 'sattel', traufhoehe: 1, neigung: 40, firstrichtung: 90, gauben: [sattelGaube, { typ: 'flach', seite: 0, abstand: 6, breite: 3, vorne: 0, tiefe: 1.8 }] };
    const { m, waende } = modell(d, pts);
    const e = dachAusModell(m, pts, 0, waende);
    if (!e.dach) throw new Error(e.grund);
    expect(e.dach).toMatchObject({ typ: 'sattel', neigung: 40, firstrichtung: 90 });
    const typen = e.dach.gauben!.map((g) => g.typ).sort();
    expect(typen).toEqual(['flach', 'sattel']);
    const sg = e.dach.gauben!.find((g) => g.typ === 'sattel')!;
    expect(sg.dachneigung).toBeCloseTo(40, 1);
    expect(sg.wandhoehe).toBeCloseTo(1.1, 1);
    expect(sg.breite).toBeCloseTo(2.4, 1);
    expect(e.abweichung).toBeLessThan(0.015);
  });

  it('Gauben auf den Walmseiten (wie HSA: große Schleppgaube auf der Stirnseite)', () => {
    // First entlang der 12-m-Seite, Gauben auf beiden Walmflächen
    const d: Dach = {
      ...walm,
      traufhoehe: 0.25,
      gauben: [
        { typ: 'schlepp', seite: 3, abstand: 3.3, breite: 4.12, vorne: 0, tiefe: 3.85, neigung: 25 },
        { typ: 'schlepp', seite: 2, abstand: 5, breite: 1.0, vorne: 0, tiefe: 0.8, neigung: 15 },
      ],
    };
    const { m, waende } = modell(d, rect);
    const e = dachAusModell(m, rect, 0, waende);
    if (!e.dach) throw new Error(e.grund);
    expect(e.dach).toMatchObject({ typ: 'walm', neigung: 45, neigungWalm: 45 });
    const g = [...e.dach.gauben!].sort((a, b) => b.breite - a.breite);
    expect(g.map((x) => [x.typ, x.seite])).toEqual([
      ['schlepp', 3],
      ['schlepp', 2],
    ]);
    expect(g[0].breite).toBeCloseTo(4.12, 1);
    expect(g[0].tiefe).toBeCloseTo(3.85, 1);
    expect(g[0].neigung).toBeCloseTo(25, 1);
    expect(e.abweichung).toBeLessThan(0.01);
  });

  it('ohne Gauben: reines Satteldach', () => {
    const d: Dach = { typ: 'sattel', traufhoehe: 0, neigung: 30, firstrichtung: 0 };
    const { m } = modell(d, rect);
    const e = dachAusModell(m, rect, 0);
    if (!e.dach) throw new Error(e.grund);
    expect(e.dach).toMatchObject({ typ: 'sattel', neigung: 30 });
    expect(e.dach.gauben).toBeUndefined();
  });

  it('unregelmäßige Dachhaut bleibt Modell', () => {
    // zwei unterschiedlich geneigte Pultflächen, versetzt
    const tris = [0, 0, 3, 12, 0, 3, 12, 5, 5, 0, 0, 3, 12, 5, 5, 0, 5, 5, 0, 5, 6, 12, 5, 6, 12, 10.75, 3, 0, 5, 6, 12, 10.75, 3, 0, 10.75, 3];
    const e = dachAusModell({ name: 'x', triangles: tris }, rect, 0);
    expect(e.dach).toBeNull();
  });
});
