import { describe, expect, it } from 'vitest';
import type { IfcExtract, IfcMeshPart } from '@core/ifcData';
import { createOutline, createProject, createRoom } from '@core/model';
import { mengenNachweis } from './nachweis';
import { vermessen, waendeAusIfc } from './waende';

/** Quader als Dreiecke (x, y, z) */
function box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): number[] {
  const p = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const f = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  return f.flatMap(([a, b, c, d]) => [...p[a], ...p[b], ...p[c], ...p[a], ...p[c], ...p[d]]);
}

const wand = (id: number, tris: number[], isExternal?: boolean): IfcMeshPart => ({
  expressId: id,
  globalId: `w${id}`,
  ...(isExternal !== undefined ? { isExternal } : {}),
  type: 'IFCWALL',
  name: `Wand ${id}`,
  predefinedType: '',
  storey: 0,
  tris: Float32Array.from(tris),
  color: [0.7, 0.7, 0.7, 1],
});

/** Haus 10 × 8 m, Außenwände 30 cm; Innenwand bei x = 5 mit raumhoher Öffnung (y 3 … 4); Aufkantung 20 cm */
function modell(isExternal?: boolean): IfcExtract {
  const h = 2.8;
  return {
    schema: 'IFC4',
    projectName: 'Test',
    storeys: [{ name: 'EG', elevation: 0, expressId: 1 }],
    spaces: [],
    offset: { x: 0, y: 0 },
    elements: [
      wand(1, box(0, 0, 10, 0.3, 0, h), isExternal),
      wand(2, box(0, 7.7, 10, 8, 0, h), isExternal),
      wand(3, box(0, 0.3, 0.3, 7.7, 0, h), isExternal),
      wand(4, box(9.7, 0.3, 10, 7.7, 0, h), isExternal),
      wand(5, [...box(4.95, 0.3, 5.07, 3, 0, h), ...box(4.95, 4, 5.07, 7.7, 0, h)], isExternal),
      wand(6, box(1, 2, 3, 2.12, 0, 0.2), isExternal),
    ],
  };
}

function projekt() {
  const p = createProject('Test');
  const eg = p.storeys[0];
  eg.name = 'EG';
  eg.elevation = 0;
  eg.hoehe = 3;
  const r = (x0: number, x1: number) => [
    { x: x0, y: 0.3 },
    { x: x1, y: 0.3 },
    { x: x1, y: 7.7 },
    { x: x0, y: 7.7 },
  ];
  eg.shapes = [
    createOutline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ]),
    // drei Räume, zwei davon ohne Wand dazwischen – die Raumumfänge allein ergäben eine Wand zu viel
    createRoom(r(0.3, 4.95), '1', 'Wohnen'),
    createRoom(r(5.07, 7), '2', 'Essen'),
    createRoom(r(7, 9.7), '3', 'Küche'),
  ];
  return p;
}

describe('Innenwände aus dem IFC-Modell', () => {
  it('vermisst eine Wand: Länge, Dicke, Ansichtsfläche mit übermessener raumhoher Öffnung', () => {
    const w = vermessen(Float32Array.from([...box(4.95, 0.3, 5.07, 3, 0, 2.8), ...box(4.95, 4, 5.07, 7.7, 0, 2.8)]))!;
    expect(w.laenge).toBeCloseTo(7.4, 3);
    expect(w.dicke).toBeCloseTo(0.12, 3);
    expect(w.flaeche).toBeCloseTo(7.4 * 2.8, 2);
    // Tür mit Sturz: bis zum Wandfuß übermessen
    const tuer = vermessen(Float32Array.from([...box(0, 0, 2, 0.12, 0, 2.8), ...box(2, 0, 3, 0.12, 2.1, 2.8), ...box(3, 0, 5, 0.12, 0, 2.8)]))!;
    expect(tuer.flaeche).toBeCloseTo(5 * 2.8, 2);
    // Giebel: schräge Oberkante in wahrer Größe
    const giebel = vermessen(Float32Array.from([0, 0, 0, 6, 0, 0, 3, 0, 3, 0, 0.1, 0, 6, 0.1, 0, 3, 0.1, 3]))!;
    expect(giebel.flaeche).toBeCloseTo(9, 1);
  });

  it('zählt nur die Innenwand; Außenwände (Lage am BGF-Umriss) und Aufkantungen sind abgewählt', () => {
    const n = mengenNachweis(projekt(), undefined, waendeAusIfc(modell()));
    const iwf = n.mengen.iwf;
    expect(iwf.teile).toHaveLength(6);
    expect(iwf.teile.filter((t) => t.zaehlt).map((t) => t.bezeichnung)).toEqual(['Wand 5']);
    expect(iwf.summe).toBeCloseTo(7.4 * 2.8, 2);
    expect(iwf.teile.filter((t) => t.bezeichnung.endsWith('Außenwand'))).toHaveLength(4);
    expect(iwf.teile.find((t) => t.id === 'iwf-w6')?.bezeichnung).toBe('Wand 6 – niedrige Wand');
  });

  it('IsExternal gilt nur, wenn das Modell beide Werte enthält', () => {
    // alle als außen markiert (nicht gepflegt): Lage entscheidet
    expect(mengenNachweis(projekt(), undefined, waendeAusIfc(modell(true))).mengen.iwf.teile.filter((t) => t.zaehlt)).toHaveLength(1);
    // gepflegt: Wand 5 als Außenwand markiert → zählt nicht
    const x = modell(false);
    for (const e of x.elements.slice(0, 5)) e.isExternal = true;
    expect(mengenNachweis(projekt(), undefined, waendeAusIfc(x)).mengen.iwf.summe).toBe(0);
  });

  it('eigene Auswahl geht vor dem Standard', () => {
    const p = projekt();
    p.kosten = { positionen: [], teile: { 'iwf-w5': false, 'iwf-w1': true } };
    const iwf = mengenNachweis(p, undefined, waendeAusIfc(modell())).mengen.iwf;
    expect(iwf.teile.filter((t) => t.zaehlt).map((t) => t.id)).toEqual(['iwf-w1']);
    expect(iwf.summe).toBeCloseTo(10 * 2.8, 2);
  });

  it('ohne IFC-Modell: Näherung aus den Räumen mit Hinweis', () => {
    const iwf = mengenNachweis(projekt()).mengen.iwf;
    expect(iwf.teile).toHaveLength(1);
    expect(iwf.hinweis).toContain('Ohne IFC-Modell');
  });
});
