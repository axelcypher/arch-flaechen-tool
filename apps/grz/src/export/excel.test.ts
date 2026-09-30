import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readProjectFile, writeArchive } from '@core/archive';
import { addDatei } from '@core/model';
import { massNachweis } from '../massNutzung';
import { projekt } from '../testdaten';
import { buildSampleTemplate, exportDefault, exportWithTemplate } from './excel';
import { buildGrzContext } from './exportData';

async function lesen(data: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  return wb;
}

/** alle Zellinhalte eines Blatts als Text (Formeln als „=…“) */
function texte(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.eachRow((row) =>
    row.eachCell((c) => {
      const v = c.value as unknown;
      if (v && typeof v === 'object' && 'formula' in (v as object)) out.push(`=${(v as { formula: string }).formula}`);
      else if (v !== null && v !== undefined) out.push(String(v));
    }),
  );
  return out;
}

function zeileMit(ws: ExcelJS.Worksheet, text: string): number {
  let r = -1;
  ws.eachRow((row, n) => row.eachCell((c) => r < 0 && c.value === text && (r = n)));
  return r;
}

describe('GRZ-Excel', () => {
  it('Kontext: Kennzahlen, Geschosse, Lageplan und Filter', () => {
    const p = projekt();
    const ctx = buildGrzContext(p, new Date(2026, 8, 30));
    const n = massNachweis(p);
    expect(ctx.scalars['baunvo.fassung']).toBe('BauNVO 1962');
    expect(ctx.scalars['bplan.datum']).toBe('14.3.1967');
    expect(ctx.scalars.grz).toBeCloseTo(n.grz.wert, 4);
    expect(ctx.scalars['grz.ii']).toBe('');
    expect(ctx.scalars['aufenthalt.titel']).toContain('Aufenthaltsräume');
    expect(ctx.collections.geschoss.map((g) => g.name)).toEqual(['EG', 'OG', 'DG']);
    expect(ctx.collections.geschoss.filter((g) => g.vollgeschoss === 'ja')).toHaveLength(n.vollgeschosse.anzahl);
    expect(ctx.collections.lageplan.map((l) => l.name)).toEqual(['Zufahrt', 'Terrasse']);
    // Zimmer im DG (kein Vollgeschoss) zählt vor 1990 zur Geschossfläche
    expect(ctx.collections.raum.filter((r) => ctx.filters!.gf(r)).map((r) => r.name)).toEqual(['Zimmer I']);
  });

  it('Standardlayout: alle Platzhalter ersetzt, Zeilen je Geschoss, Summen über die erzeugten Zeilen', async () => {
    const p = projekt();
    const wb = await lesen(await exportDefault(p, new Date(2026, 8, 30)));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['GRZ GFZ']);
    const ws = wb.getWorksheet('GRZ GFZ')!;
    const t = texte(ws);
    expect(t.filter((x) => x.includes('{{'))).toEqual([]);
    expect(ws.headerFooter.oddFooter).toContain('GRZ-Test');
    expect(t).toContain('BauNVO 1962');
    const n = massNachweis(p);
    // Kennzahlen als Zahlen
    const grzZeile = zeileMit(ws, 'GRZ');
    expect(ws.getCell(grzZeile, 4).value).toBeCloseTo(n.grz.wert, 4);
    expect(ws.getCell(grzZeile, 5).value).toBe(0.4);
    // Geschossfläche: drei Geschosszeilen und SUMME darüber
    const gfKopf = zeileMit(ws, 'Ermittlung');
    expect([1, 2, 3].map((i) => ws.getCell(gfKopf + i, 1).value)).toEqual(['EG', 'OG', 'DG']);
    const sum = ws.getCell(gfKopf + 4, 3).value as { formula: string; result: number };
    expect(sum.formula).toBe(`SUM(C${gfKopf + 1}:C${gfKopf + 3})`);
    expect(sum.result).toBeCloseTo(n.gf, 1);
    // Lageplan: nur eigene Flächen
    const lp = zeileMit(ws, 'Anrechnung');
    expect(ws.getCell(lp + 1, 1).value).toBe('Zufahrt');
    expect(ws.getCell(lp + 2, 1).value).toBe('Terrasse');
  });

  it('Muster-Vorlage mit Hilfeblatt; eigene Vorlage mit Block, Filter und Nachschlagen per Name', async () => {
    const muster = await lesen(await buildSampleTemplate());
    expect(muster.worksheets.map((w) => w.name)).toEqual(['GRZ GFZ', 'Platzhalter']);
    expect(texte(muster.getWorksheet('GRZ GFZ')!)).toContain('{{grz}}');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Eigen');
    ws.getCell('A1').value = 'GFZ {{gfz}} bei {{vollgeschosse.roemisch}} Vollgeschossen, EG {{geschoss:EG.gf}} m²';
    ws.getCell('A2').value = '{{#geschoss[!vollgeschoss]}}{{geschoss.name}}';
    ws.getCell('B3').value = '{{raum[aufenthalt].name}}';
    ws.getCell('A4').value = '{{/geschoss}}';
    ws.getCell('A5').value = '{{lageplan[teil].name}}';
    const out = await lesen(await exportWithTemplate(new Uint8Array(await wb.xlsx.writeBuffer()), projekt()));
    const e = out.getWorksheet('Eigen')!;
    expect(String(e.getCell('A1').value)).toMatch(/^GFZ 0,\d+ bei II Vollgeschossen, EG 135 m²$/);
    expect(e.getCell('A2').value).toBe('DG');
    expect(e.getCell('B3').value).toBe('Zimmer I');
    expect(e.getCell('A4').value).toBe('Zufahrt');
  });

  it('Vorlage des GRZ-Nachweises liegt getrennt von der des Flächenrechners im Archiv', () => {
    let p = projekt();
    p = addDatei(p, 'Flächen.xlsx', 'vorlage', new Uint8Array([80, 75, 1])).project;
    p = addDatei(p, 'GRZ.xlsx', 'vorlage-grz', new Uint8Array([80, 75, 2])).project;
    p = addDatei(p, 'GRZ neu.xlsx', 'vorlage-grz', new Uint8Array([80, 75, 3])).project;
    const back = readProjectFile(writeArchive(p, { app: 'Test' }));
    expect(back.dateien?.map((d) => `${d.art}:${d.name}`).sort()).toEqual(['vorlage-grz:GRZ neu.xlsx', 'vorlage:Flächen.xlsx']);
  });
});
