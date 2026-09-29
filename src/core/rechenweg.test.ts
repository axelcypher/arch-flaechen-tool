import { describe, expect, it } from 'vitest';
import { outlineVolume } from './calc';
import { rectPoints } from './geometry';
import type { OutlineShape } from './model';
import { createOutline, createProject, istDachgeschoss } from './model';
import { briKoerper, briRechenweg, outlineTeile } from './rechenweg';
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

/** Rechnung als Text („10,75 × 5,375 × (3 × 12 − 10,75) / 6“) nachrechnen */
const nachrechnen = (s: string) => Function(`return ${s.replace(/×/g, '*').replace(/−/g, '-').replace(/,/g, '.')}`)() as number;

describe('BRI-Körper mit geschlossenen Formeln', () => {
  for (const typ of DACH_TYPEN.map((d) => d.id) as DachTyp[]) {
    for (const [name, pts] of [
      ['Rechteck', rect],
      ['L-Form', lForm],
    ] as const) {
      it(`${typ} (${name}): Summe der Körper = BRI, Rechnung nachprüfbar`, () => {
        const { p, st, o } = setup(pts, defaultDach(typ, 1.2));
        const k = briKoerper(p);
        expect(k.reduce((a, x) => a + x.volumen, 0)).toBeCloseTo(outlineVolume(o, st, p), 6);
        for (const x of k) expect(nachrechnen(x.rechnung)).toBeCloseTo(x.volumen, 1);
      });
    }
  }

  it('Walmdach mit gleicher Neigung wie in der Büro-Vorlage', () => {
    const { p } = setup(rectPoints({ x: 0, y: 0 }, { x: 12, y: 10.75 }), { ...defaultDach('walm', 0), neigung: 45 });
    const [dach] = briKoerper(p);
    expect(dach).toMatchObject({ art: 'dach', bezeichnung: 'Walmdach', formel: 'B × H × (3 × L − B) / 6', parameter: 'H: 5,375 m; B: 10,75 m; L: 12,00 m' });
    expect(dach.rechnung).toBe('10,75 × 5,375 × (3 × 12 − 10,75) / 6');
    expect(dach.volumen).toBeCloseTo((10.75 * 5.375 * (3 * 12 - 10.75)) / 6, 9);
  });

  it('Normalgeschoss: Quader Höhe × Fläche, Abzugsflächen negativ', () => {
    const { p, st } = setup(rect);
    st.shapes.push({ ...createOutline(rectPoints({ x: 0, y: 0 }, { x: 2, y: 2 })), subtract: true });
    const k = briKoerper(p);
    expect(k.map((x) => [x.art, x.formel, x.flaeche, x.hoehe, x.volumen])).toEqual([
      ['grundkoerper', 'L × B × H', 108, 3, 324],
      ['grundkoerper', 'L × B × H', -4, 3, -12],
    ]);
    expect(k[1].rechnung).toBe('− 2 × 2 × 3');
  });

  it('Dachgeschoss: automatisch bei geneigtem Dach, manuell übersteuerbar', () => {
    const { st } = setup(rect, defaultDach('sattel', 1));
    expect(istDachgeschoss(st)).toBe(true);
    expect(istDachgeschoss({ ...st, dachgeschoss: false })).toBe(false);
    const flach = setup(rect, defaultDach('flach', 3)).st;
    expect(istDachgeschoss(flach)).toBe(false);
    expect(istDachgeschoss({ ...flach, dachgeschoss: true })).toBe(true);
  });
});
