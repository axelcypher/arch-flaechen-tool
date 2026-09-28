import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { computeProject } from '../core/calc';
import { rectPoints } from '../core/geometry';
import { createOutline, createProject, createRoom, createStorey } from '../core/model';
import { buildSampleTemplate, exportDefault, exportWithTemplate } from './excel';

function project() {
  const p = createProject('Testhaus');
  const eg = p.storeys[0];
  eg.shapes.push(createOutline(rectPoints({ x: 0, y: 0 }, { x: 10, y: 10 })));
  for (let i = 0; i < 3; i++) {
    const r = createRoom(rectPoints({ x: i * 3, y: 0 }, { x: i * 3 + 2, y: 5 }), `0.0${i + 1}`, `Raum ${i + 1}`);
    r.wofl = { kategorie: 'voll', wohnung: 'WE 1' };
    eg.shapes.push(r);
  }
  const og = createStorey('OG', 2.75);
  og.shapes.push(createOutline(rectPoints({ x: 0, y: 0 }, { x: 10, y: 8 })));
  p.storeys.push(og);
  return p;
}

async function load(buf: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  return wb;
}

describe('Excel-Export', () => {
  it('füllt die Mustervorlage inkl. Wiederholungszeilen und Formeln', async () => {
    const p = project();
    const out = await exportWithTemplate(await buildSampleTemplate(), p, computeProject(p));
    const wb = await load(out);
    const ws = wb.getWorksheet('Flächen')!;
    expect(ws.getCell('A1').value).toBe('Flächenberechnung Testhaus');
    expect(ws.getCell('A6').value).toBe('EG');
    expect(ws.getCell('B6').value).toBe(100);
    expect(ws.getCell('A7').value).toBe('OG');
    expect(ws.getCell('B7').value).toBe(80);
    expect(ws.getCell('C7').value).toBe(220);
    expect((ws.getCell('F7').value as { formula: string }).formula).toBe('IF(B7=0,"",D7/B7)');
    expect(ws.getCell('A8').value).toBe('Summe');
    expect((ws.getCell('B8').value as { formula: string }).formula).toBe('SUM(B6:B7)');
    expect(ws.getCell('B10').value).toBe(180);
    expect(ws.getCell('B11').value).toBe(100);
    // Formatierung der Vorlagenzeile wird übernommen
    expect(ws.getCell('B7').numFmt).toBe('#,##0.00');

    const rs = wb.getWorksheet('Räume')!;
    expect(rs.getCell('C2').value).toBe('Raum 1');
    expect(rs.getCell('C4').value).toBe('Raum 3');
    expect(rs.getCell('E4').value).toBe(10);
    expect((rs.getCell('E5').value as { formula: string }).formula).toBe('SUM(E2:E4)');

    const wo = wb.getWorksheet('Wohnungen')!;
    expect(wo.getCell('A2').value).toBe('WE 1');
    expect(wo.getCell('C2').value).toBe(30);
    // Nutzungsgruppen (9 Zeilen) unterhalb der Wohnungen
    expect(wo.getCell('A5').value).toBe('NUF 1');
    expect(wo.getCell('A13').value).toBe('VF 9');
  });

  it('erzeugt das Standardlayout', async () => {
    const p = project();
    const wb = await load(await exportDefault(p, computeProject(p)));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['DIN 277', 'NRF Nutzungsgruppen', 'Raumliste', 'Wohnflächen']);
    const ws = wb.getWorksheet('DIN 277')!;
    expect(ws.getCell('A6').value).toBe('EG');
    expect(ws.getCell('E6').value).toBe(100);
    expect((ws.getCell('E8').value as { formula: string }).formula).toBe('SUM(E6:E7)');
  });
});
