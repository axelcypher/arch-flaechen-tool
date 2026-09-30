import { describe, expect, it } from 'vitest';
import { computeProject } from '@core/calc';
import { buildExportContext, repeatCollection, resolveText, shiftFormulaForInsert, shiftRelativeRows } from './exportData';
import { rectPoints } from '@core/geometry';
import { createOutline, createProject, createRoom } from '@core/model';

function ctx() {
  const p = createProject('Haus A');
  p.storeys[0].shapes.push(createOutline(rectPoints({ x: 0, y: 0 }, { x: 10, y: 8 })));
  const r = createRoom(rectPoints({ x: 0, y: 0 }, { x: 4, y: 5 }), '0.01', 'Wohnen');
  r.wofl = { kategorie: 'voll', wohnung: 'WE 1' };
  p.storeys[0].shapes.push(r);
  return buildExportContext(p, computeProject(p), new Date(2026, 8, 28));
}

describe('Excel-Vorlagen', () => {
  it('ersetzt Einzelwerte typgerecht', () => {
    const c = ctx();
    expect(resolveText('{{summe.bgf}}', c)).toBe(80);
    expect(resolveText(' {{ projekt.name }} ', c)).toBe('Haus A');
    expect(resolveText('Projekt: {{projekt.name}}, BGF {{summe.bgf}} m²', c)).toBe('Projekt: Haus A, BGF 80 m²');
    expect(resolveText('{{geschoss:EG.nrf}}', c)).toBe(20);
    expect(resolveText('{{wohnung:WE 1.wofl}}', c)).toBe(20);
    expect(resolveText('{{gibtsnicht}}', c)).toBe('{{gibtsnicht}}');
    expect(resolveText('{{datum}}', c)).toBe('28.9.2026');
  });

  it('erkennt Wiederholungszeilen und setzt Zeilenwerte ein', () => {
    const c = ctx();
    expect(repeatCollection(['Summe', '{{raum.name}}'])).toBe('raum');
    expect(repeatCollection(['{{summe.bgf}}'])).toBeNull();
    const row = c.collections.raum[0];
    expect(resolveText('{{raum.flaeche}}', c, { collection: 'raum', row })).toBe(20);
    expect(resolveText('{{raum.nummer}} {{raum.name}}', c, { collection: 'raum', row })).toBe('0.01 Wohnen');
  });

  it('passt Formeln beim Einfügen von Zeilen an', () => {
    expect(shiftFormulaForInsert('SUM(C5:C5)', 5, 3)).toBe('SUM(C5:C8)');
    expect(shiftFormulaForInsert('SUM(C4:C5)+D6*$B$7', 5, 2)).toBe('SUM(C4:C7)+D8*$B$9');
    expect(shiftFormulaForInsert('C3+LOG10(A2)', 5, 2)).toBe('C3+LOG10(A2)');
    expect(shiftFormulaForInsert('"A9"&A9&Tabelle2!A9', 5, 1)).toBe('"A9"&A10&Tabelle2!A9');
    expect(shiftRelativeRows('C5*D$5+SUM($E$1:E5)', 2)).toBe('C7*D$5+SUM($E$1:E7)');
  });
});
