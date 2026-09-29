import fs from 'fs';
import path from 'path';
import * as W from 'web-ifc';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeProject } from '../core/calc';
import { polygonArea } from '../core/geometry';
import type { IfcExtract } from '../core/ifcData';
import { buildFromIfc, heightClasses } from '../core/ifcImport';
import { createProject } from '../core/model';
import { extractIfc } from './ifcExtract';

const FIXTURE = path.resolve(__dirname, '../core/__fixtures__/testhaus.ifc');

async function extract(file: string): Promise<IfcExtract> {
  const api = new W.IfcAPI();
  await api.Init();
  return extractIfc(api, W as never, new Uint8Array(fs.readFileSync(file)));
}

describe('IFC-Import (Testhaus, Millimeter)', () => {
  let x: IfcExtract;
  beforeAll(async () => {
    x = await extract(FIXTURE);
  });

  it('liest Geschosse mit Höhenkoten in Metern', () => {
    expect(x.storeys.map((s) => [s.name, s.elevation])).toEqual([
      ['EG', 0],
      ['OG', 3],
    ]);
    expect(x.spaces).toHaveLength(1);
    expect(x.spaces[0]).toMatchObject({ name: '1', longName: 'Wohnen', storey: 0 });
    expect(x.spaces[0].netFloorArea).toBeCloseTo(67.4732, 4);
  });

  it('erzeugt Räume, BGF-Umrisse und BRI bis zur Dachhaut', () => {
    const r = buildFromIfc(x, { rooms: true, outlines: true, roof: true, wohnflaeche: true });
    const p = createProject();
    p.storeys = r.storeys;
    p.dachModell = r.dachModell;
    const [eg, og] = r.storeys;
    expect(eg.hoehe).toBe(3);
    expect(og.elevation).toBe(3);
    const bgf = eg.shapes.find((s) => s.kind === 'outline')!;
    expect(polygonArea(bgf.points)).toBeCloseTo(80, 6);
    expect(bgf.points).toHaveLength(4);
    const room = eg.shapes.find((s) => s.kind === 'room')!;
    expect(room.kind === 'room' && room.putzabzug).toBe(3);
    const res = computeProject(p);
    expect(res.storeys[0].nrf.total).toBeCloseTo(67.47, 2);
    expect(res.total.wofl).toBeCloseTo(67.47, 2);
    expect(res.total.bgf.total).toBeCloseTo(160, 6);
    // EG 80 × 3,0 + OG 80 × (6,30 − 3,00)
    expect(res.storeys[0].bri.total).toBeCloseTo(240, 3);
    expect(res.storeys[1].bri.total).toBeCloseTo(264, 1);
  });

  it('erkennt die Dachform (hier Flachdach) bei gleichem BRI', () => {
    const r = buildFromIfc(x, { rooms: false, outlines: true, roof: true, wohnflaeche: false, dachform: true });
    const p = createProject();
    p.storeys = r.storeys;
    p.dachModell = r.dachModell;
    const og = r.storeys[1].shapes.find((s) => s.kind === 'outline')!;
    expect(og.kind === 'outline' && og.dach).toMatchObject({ typ: 'flach' });
    expect(og.kind === 'outline' && og.dach?.traufhoehe).toBeCloseTo(3.3, 2);
    expect(computeProject(p).storeys[1].bri.total).toBeCloseTo(264, 1);
    expect(r.report.some((z) => z.includes('Flachdach'))).toBe(true);
  });
});

describe('Raumhöhen nach WoFlV', () => {
  it('teilt einen Raum unter einer Dachschräge exakt in Höhenklassen', () => {
    // Raum 4 m tief, Decke steigt von 0 m (y = 0) auf 4 m (y = 4) → je 25 % < 1 m und 1–2 m, 50 % ≥ 2 m
    const tri = (a: number[], b: number[], c: number[]) => [...a, ...b, ...c];
    const t = Float32Array.from([
      ...tri([0, 0, 0], [5, 0, 0], [5, 4, 0]), // Boden
      ...tri([0, 0, 0], [5, 4, 0], [0, 4, 0]),
      ...tri([0, 0, 0], [5, 0, 0], [5, 4, 4]), // Schräge
      ...tri([0, 0, 0], [5, 4, 4], [0, 4, 4]),
    ]);
    const hc = heightClasses(t)!;
    expect(hc.a2).toBeCloseTo(0.5, 9);
    expect(hc.a12).toBeCloseTo(0.25, 9);
    expect(hc.a01).toBeCloseTo(0.25, 9);
  });
});

// Optional: echter Archicad-Export (nicht im Repository), z. B. AC20-FZK-Haus.ifc
const REAL = process.env.IFC_SAMPLE;
describe.runIf(!!REAL && fs.existsSync(REAL ?? ''))('IFC-Import (Archicad-Beispiel)', () => {
  it('übernimmt Zonen mit Putzabzug und Dach', async () => {
    const r = buildFromIfc(await extract(REAL!), { rooms: true, outlines: true, roof: true, wohnflaeche: true });
    const p = createProject();
    p.storeys = r.storeys;
    p.dachModell = r.dachModell;
    const res = computeProject(p);
    expect(res.total.bgf.total).toBeGreaterThan(0);
    expect(res.total.bri.total).toBeGreaterThan(res.total.bgf.total * 2);
    // Dachform erkannt (FZK-Haus: Satteldach 30°), BRI praktisch unverändert
    const r2 = buildFromIfc(await extract(REAL!), { rooms: true, outlines: true, roof: true, wohnflaeche: true, dachform: true });
    const p2 = createProject();
    p2.storeys = r2.storeys;
    p2.dachModell = r2.dachModell;
    expect(Math.abs(computeProject(p2).total.bri.total - res.total.bri.total) / res.total.bri.total).toBeLessThan(0.03);
  });
});
