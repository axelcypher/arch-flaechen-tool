import { describe, expect, it } from 'vitest';
import { vectorSegmentGrid } from './background';
import { cleanMtext, importDxf } from './dxf';
import { parseProject, serializeProject } from './serialize';
import { createProject } from './model';

const g = (...pairs: (string | number)[]) => pairs.map(String).join('\n');

function dxf(): string {
  return [
    g(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC'),
    g(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 0, 'LAYER', 2, 'WAND', 62, 7, 70, 0, 0, 'LAYER', 2, 'MOEBEL', 62, -3, 70, 0, 0, 'ENDTAB', 0, 'ENDSEC'),
    g(0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 8, '0', 2, 'TISCH', 70, 0, 10, 0, 20, 0, 30, 0, 3, 'TISCH', 0, 'LINE', 8, '0', 10, 0, 20, 0, 30, 0, 11, 1000, 21, 0, 31, 0, 0, 'ENDBLK', 0, 'ENDSEC'),
    g(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LINE', 8, 'WAND', 10, 0, 20, 0, 30, 0, 11, 4000, 21, 0, 31, 0,
      0, 'ARC', 8, 'WAND', 10, 0, 20, 0, 30, 0, 40, 1000, 50, 0, 51, 90,
      0, 'TEXT', 8, 'WAND', 10, 100, 20, 200, 30, 0, 40, 250, 1, 'Küche',
      0, 'INSERT', 8, 'MOEBEL', 2, 'TISCH', 10, 2000, 20, 1000, 30, 0, 50, 90,
      0, 'ENDSEC', 0, 'EOF',
    ),
  ].join('\n');
}

describe('DXF-Import', () => {
  it('liest Linien, Bögen, Texte und Blöcke mit Einheit mm', () => {
    const r = importDxf(dxf(), 'test.dxf');
    const bg = r.background;
    expect(r.unitDetected).toBe(true);
    expect(bg.scale).toBe(0.001);
    expect(bg.layers.map((l) => l.name)).toEqual(['WAND', 'MOEBEL']);
    // ausgeschalteter Layer (negative Farbe) ist unsichtbar
    expect(bg.layers[1].visible).toBe(false);
    const line = bg.polylines[0];
    expect(line.pts).toEqual([0, 0, 4000, 0]);
    expect(bg.polylines[1].arc).toBe(true);
    // Block um 90° gedreht an (2000, 1000): Linie (0,0)-(1000,0) → (2000,1000)-(2000,2000), y gespiegelt
    const tisch = bg.polylines[2];
    expect(tisch.layer).toBe(1);
    expect(tisch.pts[0]).toBeCloseTo(2000);
    expect(tisch.pts[1]).toBeCloseTo(-1000);
    expect(tisch.pts[2]).toBeCloseTo(2000);
    expect(tisch.pts[3]).toBeCloseTo(-2000);
    expect(bg.texts[0]).toMatchObject({ text: 'Küche', h: 250, x: 100, y: -200 });
  });

  it('liefert Segmente in Metern und lässt Bögen optional weg', () => {
    const bg = importDxf(dxf(), 'test.dxf').background;
    bg.layers[1].visible = true;
    const all = vectorSegmentGrid(bg);
    const noArcs = vectorSegmentGrid(bg, { skipArcs: true });
    expect(noArcs.count).toBe(2);
    expect(all.count).toBeGreaterThan(10);
    expect(noArcs.seg(0)).toEqual([0, 0, 4, 0]);
  });

  it('übersteht Speichern und Laden', () => {
    const p = createProject();
    p.storeys[0].background = importDxf(dxf(), 'test.dxf').background;
    const back = parseProject(serializeProject(p));
    expect(back.storeys[0].background).toEqual(JSON.parse(JSON.stringify(p.storeys[0].background)));
  });

  it('bereinigt MTEXT-Formatierungen', () => {
    expect(cleanMtext('{\\fArial|b1;Wohnen}\\P24,5 m%%d')).toBe('Wohnen 24,5 m°');
  });
});
