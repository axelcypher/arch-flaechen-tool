import { describe, expect, it } from 'vitest';
import { outlineVolume } from './calc';
import { rectPoints } from './geometry';
import type { OutlineShape } from './model';
import { createOutline, createProject } from './model';
import { briRechenweg, outlineTeile } from './rechenweg';
import type { Dach, DachTyp } from './roof';
import { DACH_TYPEN, defaultDach } from './roof';

function setup(pts: { x: number; y: number }[], dach?: Dach) {
  const p = createProject();
  const st = p.storeys[0];
  const o: OutlineShape = { ...createOutline(pts), dach };
  st.shapes.push(o);
  return { p, st, o };
}

const rect = rectPoints({ x: 0, y: 0 }, { x: 12, y: 9 });
const lForm = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 5 },
  { x: 5, y: 5 },
  { x: 5, y: 9 },
  { x: 0, y: 9 },
];

const sum = (t: ReturnType<typeof outlineTeile>) => t.reduce((a, x) => a + x.anzahl * x.flaeche * x.hoehe * x.faktor, 0);

describe('BRI-Rechenweg', () => {
  it('Quader ohne Dach mit Länge × Breite', () => {
    const { p, st, o } = setup(rect);
    const t = outlineTeile(o, st, p);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ laenge: 12, breite: 9, hoehe: 3, faktor: 1 });
  });

  for (const typ of DACH_TYPEN.map((d) => d.id) as DachTyp[]) {
    it(`${typ}: Teilkörper ergeben exakt den BRI (Rechteck)`, () => {
      const { p, st, o } = setup(rect, defaultDach(typ, 3));
      const t = outlineTeile(o, st, p);
      expect(Math.abs(sum(t) - outlineVolume(o, st, p))).toBeLessThan(1e-9);
      // außer beim Mansardwalm gibt es für Rechtecke eine geschlossene Formel
      if (typ !== 'mansardwalm') expect(t.every((x) => !x.bezeichnung.includes('mittlere Höhe'))).toBe(true);
    });
    it(`${typ}: Teilkörper ergeben exakt den BRI (L-Form)`, () => {
      const { p, st, o } = setup(lForm, defaultDach(typ, 3));
      expect(Math.abs(sum(outlineTeile(o, st, p)) - outlineVolume(o, st, p))).toBeLessThan(1e-9);
    });
  }

  it('Walmdach: Mittelteil und zwei Walmenden', () => {
    const { p, st, o } = setup(rect, { ...defaultDach('walm', 2.5), neigung: 45, neigungWalm: 45 });
    const t = outlineTeile(o, st, p);
    expect(t.map((x) => [x.bezeichnung.split(': ')[1], x.anzahl, x.faktor])).toEqual([
      [undefined, 1, 1],
      ['Mittelteil (Dreiecksprisma)', 1, 0.5],
      ['Walmende', 2, 1 / 3],
    ]);
    // Walm 45°: h = 4,5; a = 4,5; Mittelteil 3,0 lang
    expect(t[1]).toMatchObject({ laenge: 3, breite: 9 });
    expect(t[1].hoehe).toBeCloseTo(4.5, 9);
  });

  it('liefert Formeltexte und Vorzeichen für Abzugsflächen', () => {
    const { p, st } = setup(rect, defaultDach('sattel', 3));
    const hof: OutlineShape = { ...createOutline(rectPoints({ x: 4, y: 3 }, { x: 6, y: 5 }), 'Innenhof'), subtract: true };
    st.shapes.push(hof);
    const r = briRechenweg(p);
    expect(r[0].formel).toBe('12,00 × 9,00 × 3,000');
    expect(r[1].formel).toMatch(/^12,00 × 9,00 × 3,151 × ½$/);
    const abzug = r.find((x) => x.umriss.includes('Innenhof'))!;
    expect(abzug.anzahl).toBe(-1);
    expect(abzug.volumen).toBeCloseTo(-12, 9);
    expect(abzug.formel.startsWith('− ')).toBe(true);
  });
});
