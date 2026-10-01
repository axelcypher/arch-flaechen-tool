import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readProjectFile, writeArchive } from '@core/archive';
import { addDatei } from '@core/model';
import { berechne, standAus } from '../kosten';
import { setKosten } from '../store';
import { projekt, projektMitKosten } from '../testdaten';
import { buildSampleTemplate, exportDefault, exportWithTemplate } from './excel';
import { buildKostenContext } from './exportData';

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

const formel = (c: ExcelJS.Cell) => c.value as { formula: string; result: number };

describe('Kosten-Excel', () => {
  it('Kontext: Einzelwerte, Kostengruppen, Positionen, Mengen und Filter', () => {
    const p = setKosten(projektMitKosten(), { katalog: { name: 'Büro', quelle: 'eigene Projekte', stand: '1/2026' } });
    const ctx = buildKostenContext(p, new Date(2026, 9, 1));
    expect(ctx.scalars.stufe).toBe('Kostenschätzung');
    expect(ctx.scalars['stufe.lph']).toBe('LPh 2');
    expect(ctx.scalars.preisstand).toBe('1.7.2026');
    expect(ctx.scalars.katalog).toBe('Büro (eigene Projekte), Stand 1/2026');
    expect(ctx.scalars['gesamt.netto']).toBe(1642500);
    expect(ctx.scalars['gesamt.brutto.von']).toBe(Math.round(1425420 * 1.19));
    expect(ctx.scalars.kg300).toBe(972000);
    expect(ctx.scalars['kg540.bis']).toBe(30000);
    expect(ctx.scalars['mengen.bgf']).toBe(540);
    expect(ctx.scalars['kennwert.bgf']).toBe(2856);
    // keine Wohnfläche im Projekt: Kennwert bleibt leer statt als Platzhalter stehen
    expect(ctx.scalars['kennwert.wofl']).toBe('');
    expect(ctx.collections.kg.map((r) => r.kg)).toEqual(['300', '400', '500', '700']);
    expect(ctx.collections.kg2.map((r) => r.kg)).toEqual(['530', '540']);
    expect(ctx.collections.position.map((r) => r.bezug)).toEqual(['m² BGF', 'm² BGF', 'm² AUF', 'psch', '% von KG 300 + 400']);
    expect(ctx.collections.position[4]).toMatchObject({ menge: 1296000, einheit: '€', kennwert: 20, kosten: 259200 });
    expect(ctx.byName!.kg.get('700')!.mittel).toBe(259200);
  });

  it('Standardlayout: alle Platzhalter ersetzt, Zeilen je Kostengruppe und Position, Summenformeln', async () => {
    const p = projektMitKosten();
    const wb = await lesen(await exportDefault(p, new Date(2026, 9, 1)));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Kosten']);
    const ws = wb.getWorksheet('Kosten')!;
    const t = texte(ws);
    expect(t.filter((x) => x.includes('{{'))).toEqual([]);
    expect(ws.headerFooter.oddFooter).toContain('Kosten-Test · Kostenschätzung');
    expect(t).toContain('Kostenschätzung (LPh 2)');

    // Kostenübersicht: vier Kostengruppen, Summe, Umsatzsteuer, brutto
    const kopf = zeileMit(ws, 'Kostengruppe');
    expect([1, 2, 3, 4].map((i) => ws.getCell(kopf + i, 1).value)).toEqual(['300', '400', '500', '700']);
    expect(ws.getCell(kopf + 1, 7).value).toBe(972000);
    const netto = formel(ws.getCell(kopf + 5, 7));
    expect(netto.formula).toBe(`SUM(G${kopf + 1}:G${kopf + 4})`);
    expect(netto.result).toBe(1642500);
    expect(formel(ws.getCell(kopf + 5, 6)).result).toBe(1425420);
    expect(ws.getCell(kopf + 6, 3).value).toBe(19);
    expect(formel(ws.getCell(kopf + 6, 7)).result).toBeCloseTo(1642500 * 0.19, 2);
    expect(formel(ws.getCell(kopf + 7, 7)).result).toBeCloseTo(1642500 * 1.19, 2);

    // Kennwerte Bauwerk
    expect(ws.getCell(zeileMit(ws, 'je m² BGF'), 7).value).toBe(2856);
    expect(ws.getCell(zeileMit(ws, 'je m² Wohnfläche'), 7).value).toBeNull();

    // Positionen: fünf Zeilen, Summe wie die Kostenübersicht
    const pos = zeileMit(ws, 'Bezeichnung');
    expect([1, 2, 3, 4, 5].map((i) => ws.getCell(pos + i, 2).value)).toEqual(p.kosten!.positionen.map((x) => x.bezeichnung));
    expect(ws.getCell(pos + 1, 3).value).toBe(540);
    expect(ws.getCell(pos + 1, 4).value).toBe('m² BGF');
    expect(ws.getCell(pos + 1, 5).value).toBe(1800);
    const sum = formel(ws.getCell(pos + 6, 7));
    expect(sum.formula).toBe(`SUM(G${pos + 1}:G${pos + 5})`);
    expect(sum.result).toBe(1642500);

    // Mengen
    const mengen = zeileMit(ws, 'Ermittlung');
    expect(ws.getCell(mengen + 1, 1).value).toBe('BGF');
    expect(ws.getCell(mengen + 1, 3).value).toBe(540);
  });

  it('ausgeschaltete Positionen und Kostenstände', async () => {
    let p = projektMitKosten();
    p = setKosten(p, { staende: [standAus(berechne(p), 'rahmen', 'erste Annahme', '2026-05-02')] });
    p = setKosten(p, { positionen: p.kosten!.positionen.map((x) => (x.kg === '540' ? { ...x, aus: true } : x)) });
    const ws = (await lesen(await exportDefault(p))).getWorksheet('Kosten')!;
    expect(texte(ws)).not.toContain('Carport');
    const st = zeileMit(ws, 'Bemerkung');
    expect([2, 3, 4, 7].map((c) => ws.getCell(st + 1, c).value)).toEqual(['Kostenrahmen', '2.5.2026', 'erste Annahme', Math.round(1642500 * 1.19)]);
  });

  it('Projekt ohne Positionen: Export ohne stehengebliebene Platzhalter', async () => {
    const ws = (await lesen(await exportDefault(projekt()))).getWorksheet('Kosten')!;
    const t = texte(ws);
    expect(t.filter((x) => x.includes('{{'))).toEqual([]);
    expect(t.join(' ')).toContain('Noch keine Positionen');
  });

  it('Muster-Vorlage mit Hilfeblatt; eigene Vorlage mit Block je Kostengruppe, Filter und Nachschlagen', async () => {
    const muster = await lesen(await buildSampleTemplate());
    expect(muster.worksheets.map((w) => w.name)).toEqual(['Kosten', 'Platzhalter']);
    expect(texte(muster.getWorksheet('Kosten')!)).toContain('{{kg.mittel}}');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Eigen');
    ws.getCell('A1').value = '{{stufe}}: {{gesamt.brutto}} € brutto, Bauwerk {{kg:300.mittel}} + {{kg400}} €';
    ws.getCell('A2').value = '{{#kg}}{{kg.kg}} {{kg.name}}';
    ws.getCell('B3').value = '{{position[aktiv].bezeichnung}}';
    ws.getCell('C3').value = '{{position[aktiv].kosten}}';
    ws.getCell('A4').value = '{{/kg}}';
    ws.getCell('A5').value = '{{position[kg=540].bezeichnung}}';
    const out = await lesen(await exportWithTemplate(new Uint8Array(await wb.xlsx.writeBuffer()), projektMitKosten()));
    const e = out.getWorksheet('Eigen')!;
    expect(e.getCell('A1').value).toBe('Kostenschätzung: 1.954.575 € brutto, Bauwerk 972.000 + 324.000 €');
    const spalteA = texte(e).filter((x) => /^\d{3} /.test(x));
    expect(spalteA).toEqual(['300 Bauwerk – Baukonstruktionen', '400 Bauwerk – Technische Anlagen', '500 Außenanlagen und Freiflächen', '700 Baunebenkosten']);
    // Positionen stehen im Block ihrer Kostengruppe: unter KG 500 die befestigten Flächen und der Carport
    const r500 = zeileMit(e, '500 Außenanlagen und Freiflächen');
    expect([e.getCell(r500 + 1, 2).value, e.getCell(r500 + 2, 2).value]).toEqual(['Befestigte Flächen', 'Carport']);
    expect(e.getCell(r500 + 2, 3).value).toBe(30000);
    expect(texte(e)[texte(e).length - 1]).toBe('Carport');
  });

  it('Vorlage der Kostenermittlung liegt getrennt von denen der anderen Apps im Archiv', () => {
    let p = projektMitKosten();
    p = addDatei(p, 'Flächen.xlsx', 'vorlage', new Uint8Array([80, 75, 1])).project;
    p = addDatei(p, 'GRZ.xlsx', 'vorlage-grz', new Uint8Array([80, 75, 2])).project;
    p = addDatei(p, 'Kosten.xlsx', 'vorlage-kosten', new Uint8Array([80, 75, 3])).project;
    p = addDatei(p, 'Kosten neu.xlsx', 'vorlage-kosten', new Uint8Array([80, 75, 4])).project;
    const back = readProjectFile(writeArchive(p, { app: 'Test' }));
    expect(back.dateien?.map((d) => `${d.art}:${d.name}`).sort()).toEqual(['vorlage-grz:GRZ.xlsx', 'vorlage-kosten:Kosten neu.xlsx', 'vorlage:Flächen.xlsx']);
  });
});
