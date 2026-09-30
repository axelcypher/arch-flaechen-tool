import { describe, expect, it } from 'vitest';
import { outlineVolume } from './calc';
import type { Point } from './geometry';
import { createOutline, createProject, createStorey } from './model';
import { modellSolidFaces } from './modellSolid';
import { woflArt } from './norms';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Satteldach über 0…10 × −0,5…8,5, Traufe z = 5, First z = 8 bei y = 4 */
function gable(): number[] {
  const t: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => t.push(...a, ...b, ...c, ...a, ...c, ...d);
  quad([0, -0.5, 5], [10, -0.5, 5], [10, 4, 8], [0, 4, 8]);
  quad([0, 4, 8], [10, 4, 8], [10, 8.5, 5], [0, 8.5, 5]);
  return t;
}

function haus() {
  const p = createProject();
  const eg = createStorey('EG', 3);
  const og = createStorey('OG', 3);
  // EG-Umriss minimal größer als der des OG (Wände je Geschoss etwas anders erkannt)
  eg.shapes.push({ ...createOutline(rect(-0.008, 0, 10.006, 8)), dach: { typ: 'modell', traufhoehe: 3, neigung: 0 } });
  og.shapes.push({ ...createOutline(rect(0, 0, 10, 8)), dach: { typ: 'modell', traufhoehe: 3, neigung: 0 } });
  p.storeys = [eg, og];
  p.dachModell = { name: 'Dach', triangles: gable() };
  return { p, eg, og };
}

const allPts = (f: ReturnType<typeof modellSolidFaces>) => [...f.tops.flat(), ...f.sides.flat()];

describe('Körper mit Dach aus dem Modell (3D)', () => {
  it('unteres Geschoss endet überall auf der Geschosshöhe – keine Zacken am Rand', () => {
    const { p, eg } = haus();
    const f = modellSolidFaces(p, eg, eg.shapes[0] as never, 0);
    const zs = allPts(f).map((q) => q.z);
    expect(Math.max(...zs)).toBeCloseTo(3, 9);
    // Dachfläche deckt den Umriss exakt ab
    const a = f.tops.reduce((s, poly) => {
      let v = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) v += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
      return s + Math.abs(v / 2);
    }, 0);
    expect(a).toBeCloseTo(10.014 * 8, 6);
    // keine Rasterpunkte außerhalb des Umrisses
    for (const q of allPts(f)) {
      expect(q.x).toBeGreaterThanOrEqual(-0.008 - 1e-9);
      expect(q.x).toBeLessThanOrEqual(10.006 + 1e-9);
    }
    expect(outlineVolume(eg.shapes[0] as never, eg, p)).toBeCloseTo(10.014 * 8 * 3, 6);
  });

  it('Geschoss auf Geschosshöhe begrenzt', () => {
    const { p, og } = haus();
    og.hoehe = 1;
    expect(outlineVolume(og.shapes[0] as never, og, p)).toBeGreaterThan(160); // bis unter die Dachhaut
    og.geschosshoeheBegrenzt = true;
    expect(outlineVolume(og.shapes[0] as never, og, p)).toBeCloseTo(80, 3);
  });

  it('oberstes Geschoss folgt der Dachhaut', () => {
    const { p, og } = haus();
    const f = modellSolidFaces(p, og, og.shapes[0] as never, 3);
    const zs = allPts(f).map((q) => q.z);
    expect(Math.max(...zs)).toBeGreaterThan(4.8);
    expect(Math.max(...zs)).toBeLessThanOrEqual(5 + 1e-6);
    expect(Math.min(...f.tops.flat().map((q) => q.z))).toBeGreaterThan(2);
  });
});

describe('Wohnfläche nach Raumname', () => {
  it('Zubehör-, Technik- und Treppenräume zählen nicht', () => {
    expect(woflArt('Wohnen', 'Erdgeschoss', 'NUF1')).toBe('wohnen');
    expect(woflArt('Flur', 'Erdgeschoss', 'VF')).toBe('wohnen');
    expect(woflArt('TR', 'Erdgeschoss', 'VF')).toBe('keine');
    expect(woflArt('Treppenhaus', 'Obergeschoss', 'VF')).toBe('keine');
    expect(woflArt('Heizung', 'Erdgeschoss', 'TF')).toBe('keine');
    expect(woflArt('Hobby', 'Kellergeschoss', 'NUF1')).toBe('keine');
    expect(woflArt('Abstellraum', 'UG', 'NUF4')).toBe('keine');
    expect(woflArt('Spitzboden', 'Dachgeschoss', 'NUF4')).toBe('keine');
    expect(woflArt('Balkon', 'Obergeschoss', 'NUF1')).toBe('freisitz');
  });
});
