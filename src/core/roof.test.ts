import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonArea, rectPoints } from './geometry';
import type { Dach, DachTyp } from './roof';
import { DACH_TYPEN, defaultDach, roofHeightFn, roofStats } from './roof';

const rect = rectPoints({ x: 0, y: 0 }, { x: 10, y: 8 }); // First entlang x (längste Kante)
const d = (typ: DachTyp, extra: Partial<Dach> = {}): Dach => ({ ...defaultDach(typ, 3), ...extra });

/** numerische Kontrolle: Mittelpunktregel auf feinem Raster */
function numeric(dach: Dach, pts: { x: number; y: number }[], n = 400) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const dx = (Math.max(...xs) - x0) / n;
  const dy = (Math.max(...ys) - y0) / n;
  const h = roofHeightFn(dach, pts);
  let v = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const p = { x: x0 + (i + 0.5) * dx, y: y0 + (j + 0.5) * dy };
      if (pointInPolygon(p, pts)) v += h(p) * dx * dy;
    }
  return v;
}

describe('Dachformen', () => {
  it('Flachdach entspricht Fläche × Traufhöhe', () => {
    expect(roofStats(d('flach'), rect).volumen).toBeCloseTo(240, 6);
  });

  it('Satteldach 45°: Dreiecksprisma', () => {
    const s = roofStats(d('sattel', { neigung: 45 }), rect);
    expect(s.volumen).toBeCloseTo(240 + ((8 * 4) / 2) * 10, 6);
    expect(s.firsthoehe).toBeCloseTo(7, 6);
  });

  it('Pultdach 30°', () => {
    const t = Math.tan(Math.PI / 6);
    expect(roofStats(d('pult', { neigung: 30 }), rect).volumen).toBeCloseTo(240 + ((8 * 8 * t) / 2) * 10, 6);
    expect(roofStats(d('pult', { neigung: 30, umkehren: true }), rect).firsthoehe).toBeCloseTo(3 + 8 * t, 6);
  });

  it('Walmdach 45° mit gleichen Neigungen: V = h·B·(3L − B)/6', () => {
    const s = roofStats(d('walm', { neigung: 45, neigungWalm: 45 }), rect);
    expect(s.dachvolumen).toBeCloseTo((4 * 8 * (30 - 8)) / 6, 6);
  });

  it('Zeltdach über Quadrat ist eine Pyramide', () => {
    const sq = rectPoints({ x: 0, y: 0 }, { x: 8, y: 8 });
    expect(roofStats(d('zelt', { neigung: 45 }), sq).dachvolumen).toBeCloseTo((64 * 4) / 3, 6);
  });

  it('Tonnendach entspricht dem Kreisabschnitt (bis auf Sehnenfehler)', () => {
    const f = 1.5;
    const R = 16 / (2 * f) + f / 2;
    const seg = R * R * Math.acos((R - f) / R) - (R - f) * Math.sqrt(2 * R * f - f * f);
    const v = roofStats(d('tonne', { stich: f }), rect).dachvolumen;
    expect(Math.abs(v - seg * 10) / (seg * 10)).toBeLessThan(0.002);
  });

  it('Sheddach: n Keile', () => {
    expect(roofStats(d('shed', { shedAnzahl: 2, shedHoehe: 1 }), rect).dachvolumen).toBeCloseTo((10 * 8 * 1) / 2, 6);
  });

  it('Firstrichtung ist frei wählbar', () => {
    const quer = roofStats(d('sattel', { neigung: 45, firstrichtung: 90 }), rect);
    expect(quer.dachvolumen).toBeCloseTo(((10 * 5) / 2) * 8, 6);
  });

  const lForm = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 9 },
    { x: 0, y: 9 },
  ];
  for (const t of DACH_TYPEN) {
    it(`${t.label}: exaktes Volumen stimmt mit numerischer Integration überein (L-Form)`, () => {
      const dach = d(t.id);
      const exact = roofStats(dach, lForm).volumen;
      const num = numeric(dach, lForm);
      expect(Math.abs(exact - num) / exact).toBeLessThan(0.003);
      expect(exact).toBeGreaterThanOrEqual(polygonArea(lForm) * 3 - 1e-6);
    });
  }
});
