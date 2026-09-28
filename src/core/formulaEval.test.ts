import { describe, expect, it } from 'vitest';
import { evaluateFormula, evaluateSheet } from './formulaEval';

const grid: Record<string, number | string | null> = { C2: 3, C3: 18, C4: null, D4: 21, D7: 6, B1: 'x' };
const get = (a: string) => grid[a] ?? null;

describe('Formelrechner', () => {
  it('rechnet übliche Formeln', () => {
    expect(evaluateFormula('SUM(C2:C4)', get)).toBe(21);
    expect(evaluateFormula('-ROUND(D4*0.03,2)', get)).toBe(-0.63);
    expect(evaluateFormula('D4+D7*2-(1+1)^2', get)).toBe(29);
    expect(evaluateFormula('IF(D4>20,"groß","klein")', get)).toBe('groß');
    expect(evaluateFormula('MAX(C2:C3,40)/4', get)).toBe(10);
    expect(evaluateFormula('ROUNDUP(1.231,2)+ROUNDDOWN(1.239,2)', get)).toBeCloseTo(2.47, 12);
    expect(evaluateFormula('50%*D4', get)).toBe(10.5);
    expect(() => evaluateFormula('VLOOKUP(1,A1:B2,2)', get)).toThrow();
    expect(() => evaluateFormula('Tabelle2!A1', get)).toThrow();
  });

  it('wertet ein Blatt mit Abhängigkeiten aus und lässt Unbekanntes offen', () => {
    const cells = new Map<string, number | string | null | { formula: string }>([
      ['A1', 10],
      ['A2', { formula: 'A1*2' }],
      ['A3', { formula: 'SUM(A1:A2)' }],
      ['A4', { formula: 'A5+1' }],
      ['A5', { formula: 'A4+1' }], // Zirkelbezug
      ['A6', { formula: 'NOW()' }],
    ]);
    const r = evaluateSheet(cells);
    expect(r.get('A2')).toBe(20);
    expect(r.get('A3')).toBe(30);
    expect(r.has('A4')).toBe(false);
    expect(r.has('A6')).toBe(false);
  });
});
