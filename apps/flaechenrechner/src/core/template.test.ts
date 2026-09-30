import { describe, expect, it } from 'vitest';
import { computeProject } from '@core/calc';
import { buildExportContext } from './exportData';
import { rectPoints } from '@core/geometry';
import { createOutline, createProject, createRoom, createStorey } from '@core/model';
import type { CellValue, TemplateRow } from './template';
import { expandTemplate } from './template';

function project() {
  const p = createProject('EFH Sander');
  const kg = p.storeys[0];
  kg.name = 'KG';
  const eg = createStorey('EG', 2.8);
  const og = createStorey('OG', 2.8);
  p.storeys.push(eg, og);
  const room = (st: typeof kg, name: string, w: number, h: number, wofl: boolean) => {
    const r = createRoom(rectPoints({ x: 0, y: 0 }, { x: w, y: h }), '', name);
    if (wofl) r.wofl = { kategorie: 'voll', wohnung: 'WE 1' };
    st.shapes.push(r);
  };
  room(kg, 'Keller', 5, 4, false); // 20
  room(eg, 'Flur', 2, 1.5, true); // 3
  room(eg, 'Küche', 4, 4.5, true); // 18
  room(eg, 'Abstellraum', 1, 2, false); // 2
  room(og, 'Bad', 2, 3, true); // 6
  for (const st of p.storeys) st.shapes.push(createOutline(rectPoints({ x: 0, y: 0 }, { x: 10, y: 8 })));
  return p;
}

const rowsOf = (spec: (CellValue | undefined)[][]): TemplateRow[] =>
  spec.map((cells, i) => ({ r: i + 1, cells: new Map(cells.map((v, c) => [c + 1, v] as [number, CellValue | undefined]).filter(([, v]) => v !== undefined && v !== '') as [number, CellValue][]) }));

const F = (formula: string) => ({ formula });

describe('Vorlagen-Engine', () => {
  const p = project();
  const ctx = buildExportContext(p, computeProject(p), new Date(2026, 8, 28));

  it('Filter an einem Platzhalter gilt für die ganze Zeile', () => {
    const tpl = rowsOf([['{{raum.nummer}}', '{{raum.name}}', '{{raum[wofl].wofl}}']]);
    const names = expandTemplate(tpl, ctx).map((r) => r.cells.get(2));
    expect(names).toEqual(['Flur', 'Küche', 'Bad']);
  });

  it('Projektcode als Platzhalter', () => {
    const q = project();
    q.meta.projektcode = '2417';
    const c = buildExportContext(q, computeProject(q));
    const out = expandTemplate(rowsOf([['{{projekt.code}} – {{projekt.name}}', '{{projekt.projektcode}}']]), c);
    expect(out[0].cells.get(1)).toBe('2417 – EFH Sander');
  });

  it('Geschossblöcke mit Räumen, Zwischensummen, Filtern und Gesamtsummen', () => {
    const tpl = rowsOf([
      ['Wohnflächen (Hauptnutzfläche)', '', 'WoFl', 'WoFl Summe'], // 1
      ['{{#geschoss}}'], // 2 (Steuerzeile)
      ['{{geschoss.name|einmal}}', '{{raum[wofl].name}}', '{{raum[wofl].wofl_roh}}'], // 3
      ['', '', '', F('SUM(C3:C3)')], // 4
      [], // 5 Leerzeile im Block
      ['{{/geschoss}}'], // 6 (Steuerzeile)
      ['Brutto-Wohnflächen gesamt', '', '', F('SUM(D4:D4)')], // 7
      ['Abzug 3% Ausbau, Putz etc.', '', '', F('-D7*0.03')], // 8
      ['Netto-Wohnflächen gesamt', '', '', F('D7+D8')], // 9
      [], // 10
      ['Neben-Nutzflächen'], // 11
      ['{{#geschoss}}{{geschoss.name|einmal}}', '{{raum[nebenflaeche].name}}', '{{raum[nebenflaeche].flaeche}}'], // 12 Start in Inhaltszeile
      ['{{/geschoss}}'], // 13
      ['Brutto-Nebenflächen gesamt', '', '', F('SUM(C12:C12)')], // 14
    ]);
    const out = expandTemplate(tpl, ctx);
    const grid = out.map((r) => [1, 2, 3, 4].map((c) => {
      const v = r.cells.get(c);
      return v && typeof v === 'object' && 'formula' in v ? `=${v.formula}` : (v ?? '');
    }));
    expect(grid).toEqual([
      ['Wohnflächen (Hauptnutzfläche)', '', 'WoFl', 'WoFl Summe'], // 1
      ['EG', 'Flur', 3, ''], // 2
      ['', 'Küche', 18, ''], // 3
      ['', '', '', '=SUM(C2:C3)'], // 4
      ['', '', '', ''], // 5
      ['OG', 'Bad', 6, ''], // 6
      ['', '', '', '=SUM(C6:C6)'], // 7
      ['', '', '', ''], // 8  (KG ohne Wohnfläche entfällt)
      ['Brutto-Wohnflächen gesamt', '', '', '=SUM(D4,D7)'], // 9
      ['Abzug 3% Ausbau, Putz etc.', '', '', '=-D9*0.03'], // 10
      ['Netto-Wohnflächen gesamt', '', '', '=D9+D10'], // 11
      ['', '', '', ''], // 12
      ['Neben-Nutzflächen', '', '', ''], // 13
      ['KG', 'Keller', 20, ''], // 14
      ['EG', 'Abstellraum', 2, ''], // 15
      ['Brutto-Nebenflächen gesamt', '', '', '=SUM(C14:C15)'], // 16
    ]);
    // Formatierung: jede Zeile kennt ihre Vorlagenzeile
    expect(out.map((r) => r.src)).toEqual([1, 3, 3, 4, 5, 3, 4, 5, 7, 8, 9, 10, 11, 12, 12, 14]);
  });

  it('BRI-Rechenweg je Geschoss mit Excel-Formel pro Zeile', () => {
    const tpl = rowsOf([
      ['{{#geschoss}}{{geschoss.name}}'],
      ['', '{{bri.bezeichnung}}', '{{bri.anzahl}}', '{{bri.laenge}}', '{{bri.breite}}', '{{bri.hoehe}}', '{{bri.faktor}}', F('C2*D2*E2*F2*G2')],
      ['', 'Summe', '', '', '', '', '', F('SUM(H2:H2)'), '{{geschoss.bri}}'],
      ['{{/geschoss}}'],
    ]);
    const out = expandTemplate(tpl, ctx);
    expect(out).toHaveLength(9);
    expect(out[0].cells.get(1)).toBe('KG');
    expect(out[1].cells.get(2)).toBe('Quader');
    expect(out[1].cells.get(4)).toBe(10);
    expect(out[1].cells.get(6)).toBe(3);
    expect(out[1].cells.get(8)).toEqual({ formula: 'C2*D2*E2*F2*G2' });
    expect(out[2].cells.get(8)).toEqual({ formula: 'SUM(H2:H2)' });
    expect(out[2].cells.get(9)).toBe(240);
    expect(out[4].cells.get(8)).toEqual({ formula: 'C5*D5*E5*F5*G5' });
    expect(out[8].cells.get(9)).toBe(224);
  });

  it('bleibt kompatibel: Wiederholungszeilen ohne Block, leere Sammlungen', () => {
    const tpl = rowsOf([
      ['{{wohnung.name}}', '{{wohnung.wofl}}'],
      ['{{raum[geschoss=OG].name}}'],
      ['{{raum[tf].name}}'],
      ['Ende', F('SUM(B1:B1)')],
    ]);
    const out = expandTemplate(tpl, ctx);
    expect(out.map((r) => r.cells.get(1) ?? null)).toEqual(['WE 1', 'Bad', null, 'Ende']);
    expect(out[3].cells.get(2)).toEqual({ formula: 'SUM(B1:B1)' });
  });
});
