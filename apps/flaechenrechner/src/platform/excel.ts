import type { Workbook, Worksheet } from 'exceljs';
import type { ProjectResult } from '@core/calc';
import { buildExportContext, PLACEHOLDER_DOCS } from '../core/exportData';
import { colLetter, excel, fuelleVorlage, NUM, platzhalterBlatt, styleHeader, styleSum, titel as title, toCellValue, writeFormulaResults } from '@core/excel/fill';
import type { Project } from '@core/model';
import { NUF_IDS, nutzungInfo } from '@core/norms';

/**
 * Excel-Export (.xlsx) mit ExcelJS – entweder im Standardlayout oder auf Basis einer
 * vom Benutzer vorgegebenen Vorlage mit Platzhaltern (siehe core/exportData.ts).
 * ExcelJS wird erst beim Export geladen.
 */


/* ---------- Vorlage füllen ---------- */

export async function exportWithTemplate(template: Uint8Array, project: Project, result: ProjectResult, date = new Date()): Promise<Uint8Array> {
  return fuelleVorlage(template, buildExportContext(project, result, date));
}

/* ---------- Standardlayout ---------- */

export async function exportDefault(project: Project, result: ProjectResult): Promise<Uint8Array> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Flächenrechner';
  wb.created = new Date();
  const ctx = buildExportContext(project, result);

  // DIN 277
  {
    const ws = wb.addWorksheet('DIN 277');
    title(ws, 'Grundflächen und Rauminhalte nach DIN 277', project);
    const head = ['Geschoss', 'Höhe [m]', 'BGF R [m²]', 'BGF S [m²]', 'BGF [m²]', 'BRI R [m³]', 'BRI S [m³]', 'BRI [m³]', 'NUF [m²]', 'TF [m²]', 'VF [m²]', 'NRF [m²]', 'KGF [m²]', 'WoFl [m²]'];
    const keys = ['name', 'hoehe', 'bgf_r', 'bgf_s', 'bgf', 'bri_r', 'bri_s', 'bri', 'nuf', 'tf', 'vf', 'nrf', 'kgf', 'wofl'];
    ws.addRow([]);
    const h = ws.addRow(head).number;
    styleHeader(ws, h);
    for (const g of ctx.collections.geschoss) ws.addRow(keys.map((k) => g[k]));
    const first = h + 1;
    const last = h + ctx.collections.geschoss.length;
    const sum = ws.addRow(keys.map((_k, i) => (i === 0 ? 'Summe' : i === 1 || last < first ? null : { formula: `SUM(${colLetter(i + 1)}${first}:${colLetter(i + 1)}${last})` })));
    styleSum(ws, sum.number);
    ws.columns.forEach((c, i) => {
      c.width = i === 0 ? 18 : 12;
      if (i > 0) c.numFmt = NUM;
    });
    ws.addRow([]);
    ws.addRow(['R = Regelfall, S = Sonderfall der Raumumschließung. KGF = BGF − NRF. BRI = Σ Umrissfläche × Höhe bzw. Volumen bis zur Dachhaut.']).font = { italic: true, color: { argb: 'FF6B7280' } };
    ws.views = [{ state: 'frozen', ySplit: h }];
  }

  // Nutzungsgruppen
  {
    const ws = wb.addWorksheet('NRF Nutzungsgruppen');
    title(ws, 'Netto-Raumfläche nach Nutzungsgruppen (DIN 277)', project);
    ws.addRow([]);
    const head = ['Geschoss', ...NUF_IDS.map((id) => nutzungInfo(id).kurz), 'TF 8', 'VF 9', 'NRF'];
    const h = ws.addRow(head).number;
    styleHeader(ws, h);
    for (const s of result.storeys) {
      const vals = [...NUF_IDS.map((id) => s.nutzung[id]), s.nutzung.TF, s.nutzung.VF, s.nrf.total].map((v) => Math.round(v * 100) / 100);
      ws.addRow([s.name, ...vals]);
    }
    const first = h + 1;
    const last = h + result.storeys.length;
    const sum = ws.addRow(head.map((_, i) => (i === 0 ? 'Summe' : { formula: `SUM(${colLetter(i + 1)}${first}:${colLetter(i + 1)}${last})` })));
    styleSum(ws, sum.number);
    ws.columns.forEach((c, i) => {
      c.width = i === 0 ? 18 : 11;
      if (i > 0) c.numFmt = NUM;
    });
  }

  // Raumliste
  {
    const ws = wb.addWorksheet('Raumliste');
    title(ws, 'Raumliste', project);
    ws.addRow([]);
    const cols: [string, string, number][] = [
      ['Geschoss', 'geschoss', 12],
      ['Nr.', 'nummer', 9],
      ['Raum', 'name', 24],
      ['Nutzung', 'nutzung', 9],
      ['R/S', 'umschliessung', 6],
      ['Fläche [m²]', 'flaeche', 12],
      ['WoFlV-Anrechnung', 'wofl_kategorie', 34],
      ['Faktor', 'wofl_faktor', 8],
      ['WoFl [m²]', 'wofl', 12],
      ['Wohnung', 'wohnung', 12],
      ['Abzug', 'abzug', 8],
      ['Bemerkung', 'bemerkung', 30],
    ];
    const h = ws.addRow(cols.map((c) => c[0])).number;
    styleHeader(ws, h);
    for (const r of ctx.collections.raum) ws.addRow(cols.map((c) => toCellValue(r[c[1]])));
    const n = ctx.collections.raum.length;
    if (n) {
      const sum = ws.addRow(cols.map((c, i) => (i === 0 ? 'Summe' : c[1] === 'flaeche' || c[1] === 'wofl' ? { formula: `SUM(${colLetter(i + 1)}${h + 1}:${colLetter(i + 1)}${h + n})` } : null)));
      styleSum(ws, sum.number);
      ws.autoFilter = { from: { row: h, column: 1 }, to: { row: h + n, column: cols.length } };
    }
    cols.forEach((c, i) => {
      ws.getColumn(i + 1).width = c[2];
      if (['flaeche', 'wofl', 'wofl_faktor'].includes(c[1])) ws.getColumn(i + 1).numFmt = NUM;
    });
    ws.views = [{ state: 'frozen', ySplit: h }];
  }

  // Wohnflächen
  {
    const ws = wb.addWorksheet('Wohnflächen');
    title(ws, 'Wohnflächen nach WoFlV', project);
    ws.addRow([]);
    const h = ws.addRow(['Wohnung', 'Räume', 'Grundfläche [m²]', 'Wohnfläche [m²]']).number;
    styleHeader(ws, h);
    for (const w of ctx.collections.wohnung) ws.addRow([w.name, w.anzahl_raeume, w.grundflaeche, w.wofl]);
    const n = ctx.collections.wohnung.length;
    const sum = ws.addRow(['Summe', null, n ? { formula: `SUM(C${h + 1}:C${h + n})` } : 0, n ? { formula: `SUM(D${h + 1}:D${h + n})` } : 0]);
    styleSum(ws, sum.number);
    [18, 8, 16, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.getColumn(3).numFmt = NUM;
    ws.getColumn(4).numFmt = NUM;
  }

  // BRI-Rechenweg
  {
    const ws = wb.addWorksheet('BRI-Rechenweg');
    title(ws, 'Brutto-Rauminhalt – Rechenweg', project);
    ws.addRow([]);
    const h = ws.addRow(['Geschoss', 'Umriss', 'Teilkörper', 'Anzahl', 'Länge [m]', 'Breite [m]', 'Fläche [m²]', 'Höhe [m]', 'Faktor', 'Volumen [m³]', 'Rechenweg']).number;
    styleHeader(ws, h);
    const rows = ctx.collections.bri;
    rows.forEach((b, i) => {
      const r = h + 1 + i;
      ws.addRow([b.geschoss, b.umriss, b.bezeichnung, b.anzahl, toCellValue(b.laenge), toCellValue(b.breite), b.flaeche, b.hoehe, b.faktor, { formula: `D${r}*G${r}*H${r}*I${r}` }, b.formel]);
    });
    const n = rows.length;
    const sum = ws.addRow(['Summe', null, null, null, null, null, null, null, null, n ? { formula: `SUM(J${h + 1}:J${h + n})` } : 0, null]);
    styleSum(ws, sum.number);
    [12, 16, 40, 8, 10, 10, 11, 10, 9, 13, 34].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ['E', 'F', 'G', 'H'].forEach((c) => (ws.getColumn(c).numFmt = '#,##0.000'));
    ws.getColumn('I').numFmt = '0.0000';
    ws.getColumn('J').numFmt = NUM;
    ws.views = [{ state: 'frozen', ySplit: h }];
  }

  wb.eachSheet((ws) => writeFormulaResults(ws));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/* ---------- Mustervorlage ---------- */

const M2 = '#,##0.00 "m²"';
const M3 = '#,##0.00 "m³"';
const THIN = { style: 'thin' as const, color: { argb: 'FF1F2328' } };
const MEDIUM = { style: 'medium' as const, color: { argb: 'FF1F2328' } };

/** Kopf wie in einer Büro-Flächenberechnung: Titel, Projekt, Adresse, Stand, Leistungsphase */
function sampleHeader(ws: Worksheet, titel: string, lastCol = 'D') {
  ws.getCell('A1').value = titel;
  ws.getCell('A1').font = { size: 11, color: { argb: 'FF6B7280' } };
  ws.getCell('A3').value = '{{projekt.name}}';
  ws.getCell('A3').font = { bold: true, size: 12 };
  ws.getCell(`${lastCol}3`).value = 'Projekt {{projekt.code}}';
  ws.getCell(`${lastCol}3`).alignment = { horizontal: 'right' };
  ws.getCell('A4').value = '{{projekt.adresse}}';
  ws.getCell('A6').value = 'Stand {{datum}}';
  ws.getCell('A6').font = { size: 9 };
  ws.getCell('A8').value = 'Entwurfsplanung';
  ws.mergeCells(`A8:${lastCol}8`);
  ws.getCell('A8').font = { bold: true };
  ws.getCell('A8').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14;
  ws.headerFooter.oddFooter = '&LAusgegeben am &D&RSeite &P/&N';
  // A4, auf Seitenbreite verkleinern; Querformat bei breiten Tabellen
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 9,
    orientation: lastCol > 'F' ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.6, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
  };
}

/** Erzeugt eine Beispielvorlage mit allen Techniken – Ausgangspunkt für eigene Vorlagen. */
export async function buildSampleTemplate(): Promise<Uint8Array> {
  const ExcelJS = await excel();
  const wb: Workbook = new ExcelJS.Workbook();

  /* Wohnflächen: Blöcke je Geschoss, Haupt- und Nebenflächen getrennt, Summen per Excel-Formel */
  {
    const ws = wb.addWorksheet('Wohnflächen');
    sampleHeader(ws, 'Wohnflächen-Berechnung');
    const put = (r: number, vals: (string | { formula: string } | null)[], opts: { bold?: boolean; top?: boolean; bottom?: boolean; fmt?: boolean } = {}) => {
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v as never;
        if (opts.bold) c.font = { bold: true };
        if (opts.fmt && i >= 2) c.numFmt = M2;
        if (opts.top || opts.bottom) c.border = { ...(opts.top ? { top: MEDIUM } : {}), ...(opts.bottom ? { bottom: THIN } : {}) };
      });
    };
    put(10, ['Wohnflächen (Hauptnutzfläche)', null, 'WoFl', 'WoFl Summe'], { bold: true });
    ws.getCell('C10').alignment = { horizontal: 'right' };
    ws.getCell('D10').alignment = { horizontal: 'right' };
    put(11, ['{{#geschoss}}']);
    put(12, ['{{geschoss.name|einmal}}', '{{raum[wofl].name}}', '{{raum[wofl].wofl_roh}}', null], { fmt: true });
    ws.getCell('A12').font = { bold: true };
    put(13, [null, null, null, { formula: 'SUM(C12:C12)' }], { bold: true, fmt: true });
    put(14, [null]);
    put(15, ['{{/geschoss}}']);
    put(16, ['Brutto-Wohnflächen gesamt', null, null, { formula: 'SUM(D13:D13)' }], { bold: true, fmt: true, top: true });
    put(17, ['Abzug 3% Ausbau, Putz etc.', null, null, { formula: '-ROUND(D16*0.03,2)' }], { bold: true, fmt: true });
    put(18, ['Netto-Wohnflächen gesamt', null, null, { formula: 'D16+D17' }], { bold: true, fmt: true, top: true, bottom: true });
    put(20, ['Neben-Nutzflächen'], { bold: true });
    put(21, ['{{#geschoss}}{{geschoss.name|einmal}}', '{{raum[nebenflaeche].name}}', '{{raum[nebenflaeche].flaeche_roh}}', null], { fmt: true });
    ws.getCell('A21').font = { bold: true };
    put(22, [null, null, null, { formula: 'SUM(C21:C21)' }], { bold: true, fmt: true });
    put(23, ['{{/geschoss}}']);
    put(24, ['Brutto-Nebenflächen gesamt', null, null, { formula: 'SUM(D22:D22)' }], { bold: true, fmt: true, top: true, bottom: true });
  }

  /* BGF je Geschoss */
  {
    const ws = wb.addWorksheet('BGF');
    sampleHeader(ws, 'Bruttogrundflächen-Berechnung');
    ws.getRow(10).values = ['Bruttogrundfläche', null, 'BGF', 'BGF Summe'];
    ws.getRow(10).font = { bold: true };
    ws.getRow(11).values = [null, '{{geschoss.name}}', '{{geschoss.bgf}}'];
    ws.getCell('C11').numFmt = M2;
    ws.getCell('D12').value = { formula: 'SUM(C11:C11)' } as never;
    ws.getCell('D12').numFmt = M2;
    ws.getCell('D12').font = { bold: true };
    ws.getRow(14).values = ['Bruttogrundfläche gesamt', null, null, { formula: 'D12' } as never];
    ws.getRow(14).font = { bold: true };
    ws.getCell('D14').numFmt = M2;
    ['A', 'B', 'C', 'D'].forEach((c) => (ws.getCell(`${c}14`).border = { top: MEDIUM, bottom: THIN }));
  }

  /*
   * BRI wie in einer Büro-Berechnung: Normalgeschosse als Geschosshöhe × BGF (eine Zeile je Umriss),
   * Dachgeschosse je Körper mit geschlossener Formel (z. B. Walmdach B × H × (3 × L − B) / 6).
   */
  {
    const ws = wb.addWorksheet('BRI');
    sampleHeader(ws, 'Brutto-Rauminhaltsberechnung', 'F');
    const right = (ref: string) => (ws.getCell(ref).alignment = { horizontal: 'right' });
    ws.getRow(10).values = ['Brutto-Rauminhalt', null, 'Geschosshöhe', 'BGF', 'BRI', 'BRI Summe'];
    ws.getRow(10).font = { bold: true };
    ['C10', 'D10', 'E10', 'F10'].forEach(right);
    // Normalgeschosse: Höhe × Fläche, Ergebnis per Excel-Formel
    ws.getRow(11).values = [null, '{{koerper[normal,grundkoerper].geschoss}}', '{{koerper[normal,grundkoerper].hoehe}}', '{{koerper[normal,grundkoerper].flaeche}}', { formula: 'C11*D11' } as never];
    ws.getCell('C11').numFmt = '#,##0.00 "m  *"';
    ws.getCell('D11').numFmt = '#,##0.00 "m²  ="';
    ws.getCell('E11').numFmt = M3;
    ws.getCell('F12').value = { formula: 'SUM(E11:E11)' } as never;
    ws.getCell('F12').numFmt = M3;
    ws.getCell('F12').font = { bold: true };
    // Dachgeschosse: je Körper Bezeichnung, Maße, Formel und Rechnung
    ws.getCell('A14').value = '{{#geschoss[dg]}}{{geschoss.name}}';
    ws.getCell('A14').font = { bold: true };
    ws.getCell('B15').value = '{{#koerper}}{{koerper.bezeichnung}}';
    ws.getCell('B16').value = '{{koerper.parameter}}';
    ws.getCell('D18').value = '{{koerper.formel}} =';
    ws.getCell('D19').value = '{{koerper.rechnung}} =';
    ws.getCell('E19').value = '{{koerper.volumen}}';
    ws.getCell('E19').numFmt = M3;
    ['D18', 'D19'].forEach(right);
    ws.getCell('A21').value = '{{/koerper}}';
    ws.getCell('F22').value = { formula: 'SUM(E19:E19)' } as never;
    ws.getCell('F22').numFmt = M3;
    ws.getCell('F22').font = { bold: true };
    ws.getCell('A23').value = '{{/geschoss}}';
    ws.getRow(25).values = ['Brutto-Rauminhalt gesamt', null, null, null, null, { formula: 'SUM(F12:F22)' } as never];
    ws.getRow(25).font = { bold: true };
    ws.getCell('F25').numFmt = M3;
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach((c) => (ws.getCell(`${c}25`).border = { top: MEDIUM, bottom: THIN }));
    ws.getRow(26).values = ['Kontrolle (berechnet)', null, null, null, null, '{{summe.bri}}'];
    ws.getRow(26).font = { italic: true, color: { argb: 'FF6B7280' } };
    ws.getCell('F26').numFmt = M3;
    [16, 30, 14, 16, 14, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  }

  /* BRI mit Rechenweg: Teilkörper je Geschoss, Volumen per Excel-Formel */
  {
    const ws = wb.addWorksheet('BRI Teilkörper');
    sampleHeader(ws, 'Brutto-Rauminhalt (Rechenweg)', 'I');
    const head = ['Geschoss', 'Teilkörper', 'Anzahl', 'Länge', 'Breite', 'Fläche', 'Höhe', 'Faktor', 'Volumen'];
    ws.getRow(10).values = head;
    ws.getRow(10).font = { bold: true };
    ws.getRow(11).values = ['{{#geschoss}}{{geschoss.name}}'];
    ws.getCell('A11').font = { bold: true };
    ws.getRow(12).values = [
      '{{bri.umriss}}',
      '{{bri.bezeichnung}}',
      '{{bri.anzahl}}',
      '{{bri.laenge}}',
      '{{bri.breite}}',
      '{{bri.flaeche}}',
      '{{bri.hoehe}}',
      '{{bri.faktor}}',
      { formula: 'C12*F12*G12*H12' } as never,
    ];
    ws.getRow(13).values = [null, 'Summe {{geschoss.name}}', null, null, null, null, null, null, { formula: 'SUM(I12:I12)' } as never];
    ws.getRow(13).font = { bold: true };
    ws.getRow(14).values = ['{{/geschoss}}'];
    ws.getRow(15).values = ['Brutto-Rauminhalt gesamt', null, null, null, null, null, null, null, { formula: 'SUM(I13:I13)' } as never];
    ws.getRow(15).font = { bold: true };
    ws.getRow(16).values = ['Kontrolle (berechnet)', null, null, null, null, null, null, null, '{{summe.bri}}'];
    ws.getRow(16).font = { italic: true, color: { argb: 'FF6B7280' } };
    [22, 34, 8, 9, 9, 10, 9, 9, 13].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ['D', 'E', 'F', 'G'].forEach((c) => (ws.getColumn(c).numFmt = '#,##0.000'));
    ws.getColumn('H').numFmt = '0.0000';
    ws.getColumn('I').numFmt = M3;
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach((c) => (ws.getCell(`${c}15`).border = { top: MEDIUM, bottom: THIN }));
  }

  /* Raumliste (alle Räume, eine Zeile je Raum) */
  {
    const rs = wb.addWorksheet('Räume');
    rs.getRow(1).values = ['Geschoss', 'Nr.', 'Raum', 'Nutzung', 'Fläche [m²]', 'Faktor', 'WoFl [m²]', 'Wohnung'];
    styleHeader(rs, 1);
    rs.getRow(2).values = ['{{raum.geschoss}}', '{{raum.nummer}}', '{{raum.name}}', '{{raum.nutzung}}', '{{raum.flaeche}}', '{{raum.wofl_faktor}}', '{{raum.wofl}}', '{{raum.wohnung}}'];
    rs.getRow(3).values = ['Summe'];
    rs.getCell('E3').value = { formula: 'SUM(E2:E2)' } as never;
    rs.getCell('G3').value = { formula: 'SUM(G2:G2)' } as never;
    styleSum(rs, 3);
    [12, 9, 26, 10, 12, 8, 12, 12].forEach((w, i) => (rs.getColumn(i + 1).width = w));
    [5, 6, 7].forEach((c) => (rs.getColumn(c).numFmt = NUM));
  }

  /* Hilfe */
  {
    platzhalterBlatt(
      wb,
      PLACEHOLDER_DOCS,
      'Platzhalter in doppelten geschweiften Klammern werden beim Export ersetzt. Zeilen mit raum.*, geschoss.*, wohnung.*, nutzung.*, bri.* oder koerper.* werden je Datensatz wiederholt, #geschoss … /geschoss wiederholt ganze Zeilenblöcke. Formeln (z. B. SUMME über eine Wiederholungszeile) werden automatisch auf die erzeugten Zeilen erweitert. Steht nur ein Platzhalter in der Zelle, wird eine Zahl eingetragen und das Zellformat der Vorlage bleibt erhalten. Dieses Blatt kann gelöscht werden.',
    );
  }

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
