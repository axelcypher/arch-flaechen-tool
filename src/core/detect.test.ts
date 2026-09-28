import { describe, expect, it } from 'vitest';
import { detectRegion } from './detect';
import { polygonArea } from './geometry';
import { SegmentGrid } from './spatial';

/** Rechteck als Liniensegmente, optional mit Lücke in der unteren Kante */
function rectSegs(x: number, y: number, w: number, h: number, door?: { from: number; to: number }): number[] {
  const s: number[] = [];
  s.push(x, y, x + w, y); // oben
  s.push(x + w, y, x + w, y + h); // rechts
  if (door) {
    s.push(x, y + h, x + door.from, y + h);
    s.push(x + door.to, y + h, x + w, y + h);
  } else s.push(x, y + h, x + w, y + h);
  s.push(x, y, x, y + h); // links
  return s;
}

describe('Raumerkennung', () => {
  it('erkennt einen geschlossenen Raum exakt', () => {
    const g = new SegmentGrid(rectSegs(0, 0, 4.12, 3.385));
    const r = detectRegion({ click: { x: 2, y: 1.5 }, grids: [g], gap: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.points).toHaveLength(4);
    expect(polygonArea(r.points)).toBeCloseTo(4.12 * 3.385, 3);
  });

  it('schließt Türöffnungen bündig mit der Wand', () => {
    // Raum 5 × 4 mit 1,01 m Öffnung, daneben Flur
    const segs = [...rectSegs(0, 0, 5, 4, { from: 1, to: 2.01 }), ...rectSegs(0, 4.24, 10, 1.5)];
    const g = new SegmentGrid(segs);
    const r = detectRegion({ click: { x: 2.5, y: 2 }, grids: [g], gap: 1.2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(polygonArea(r.points)).toBeCloseTo(20, 2);
  });

  it('erkennt L-förmige Räume', () => {
    const pts = [0, 0, 6, 0, 6, 2, 2, 2, 2, 5, 0, 5];
    const segs: number[] = [];
    for (let i = 0; i < 6; i++) segs.push(pts[i * 2], pts[i * 2 + 1], pts[((i + 1) % 6) * 2], pts[((i + 1) % 6) * 2 + 1]);
    const r = detectRegion({ click: { x: 1, y: 1 }, grids: [new SegmentGrid(segs)], gap: 0.9 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.points).toHaveLength(6);
    expect(polygonArea(r.points)).toBeCloseTo(12 + 6, 2);
  });

  it('arbeitet auf Rasterplänen mit dicken Wänden', () => {
    // Innenmaß 4,00 × 3,00 m, Wände 0,24 m, Tür 0,9 m in der rechten Wand
    const wall = (x: number, y: number) => {
      const inX = x > 0 && x < 4;
      const inY = y > 0 && y < 3;
      if (inX && inY) return false;
      if (x > 4 && x < 4.24 && y > 1 && y < 1.9) return false; // Tür
      return x > -0.24 && x < 4.24 && y > -0.24 && y < 3.24;
    };
    const r = detectRegion({
      click: { x: 2, y: 1.5 },
      grids: [],
      gap: 1,
      rasterMask: (win) => {
        const m = new Uint8Array(win.w * win.h);
        for (let py = 0; py < win.h; py++)
          for (let px = 0; px < win.w; px++) m[py * win.w + px] = wall(win.minX + (px + 0.5) * win.res, win.minY + (py + 0.5) * win.res) ? 1 : 0;
        return m;
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.points).toHaveLength(4);
    expect(polygonArea(r.points)).toBeCloseTo(12, 0);
    expect(Math.abs(polygonArea(r.points) - 12)).toBeLessThan(0.15);
  });

  it('ignoriert dünne Türaufschläge in Rasterplänen', () => {
    // Raum 4 × 3, Tür 1 m in der unteren Wand (x 1..2), Aufschlag als dünner Viertelkreis in den Raum
    const wall = (x: number, y: number) => {
      const inRoom = x > 0 && x < 4 && y > 0 && y < 3;
      if (inRoom) {
        const r = Math.hypot(x - 1, y - 3);
        return (Math.abs(r - 1) < 0.012 && x >= 1 && y <= 3) || (Math.abs(x - 1) < 0.012 && y > 2 && y < 3);
      }
      if (y >= 3 && y < 3.24 && x > 1 && x < 2) return false;
      return x > -0.24 && x < 4.24 && y > -0.24 && y < 3.24;
    };
    const mask = (win: { w: number; h: number; minX: number; minY: number; res: number }) => {
      const m = new Uint8Array(win.w * win.h);
      for (let py = 0; py < win.h; py++)
        for (let px = 0; px < win.w; px++) m[py * win.w + px] = wall(win.minX + (px + 0.5) * win.res, win.minY + (py + 0.5) * win.res) ? 1 : 0;
      return m;
    };
    const withSwing = detectRegion({ click: { x: 3, y: 1 }, grids: [], gap: 1.2, rasterMask: mask });
    const without = detectRegion({ click: { x: 3, y: 1 }, grids: [], gap: 1.2, rasterMask: mask, ignoreThinLines: 0.05 });
    expect(withSwing.ok && without.ok).toBe(true);
    if (!withSwing.ok || !without.ok) return;
    expect(polygonArea(withSwing.points)).toBeLessThan(11.4); // Aufschlag (≈ 0,79 m²) fehlt
    expect(Math.abs(polygonArea(without.points) - 12)).toBeLessThan(0.15);
  });

  it('meldet offene Bereiche', () => {
    const g = new SegmentGrid([0, 0, 5, 0, 5, 0, 5, 5]);
    const r = detectRegion({ click: { x: 2, y: 2 }, grids: [g], gap: 0, maxSize: 50 });
    expect(r.ok).toBe(false);
  });
});
