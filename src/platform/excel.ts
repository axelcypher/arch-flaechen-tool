import type { Cell, Workbook, Worksheet } from 'exceljs';
import type { ProjectResult } from '../core/calc';
import type { Collection, ExportContext, Value } from '../core/exportData';
import {
  buildExportContext,
  hasPlaceholder,
  PLACEHOLDER_DOCS,
  repeatCollection,
  resolveText,
  shiftFormulaForInsert,
  shiftRelativeRows,
} from '../core/exportData';
import type { Project } from '../core/model';
import { NUF_IDS, nutzungInfo } from '../core/norms';

/**
 * Excel-Export (.xlsx) mit ExcelJS – entweder im Standardlayout oder auf Basis einer
 * vom Benutzer vorgegebenen Vorlage mit Platzhaltern (siehe core/exportData.ts).
 * ExcelJS wird erst beim Export geladen.
 */

async function excel() {
  const mod = await import('exceljs');
  return (mod as unknown as { default?: typeof import('exceljs') }).default ?? mod;
}

const NUM = '#,##0.00';

/* ---------- Vorlage füllen ---------- */

export async function exportWithTemplate(template: Uint8Array, project: Project, result: ProjectResult): Promise<Uint8Array> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength) as ArrayBuffer);
  } catch (e) {
    throw new Error(`Die Vorlage konnte nicht gelesen werden (nur .xlsx wird unterstützt): ${e instanceof Error ? e.message : String(e)}`);
  }
  const ctx = buildExportContext(project, result);
  wb.eachSheet((ws) => fillSheet(ws, ctx));
  // Excel soll alle Formeln beim Öffnen neu berechnen
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function cellText(cell: Cell): string | null {
  const v = cell.value as unknown;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'richText' in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  return null;
}

function formulaOf(cell: Cell): string | null {
  const v = cell.value as unknown;
  if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) return cell.formula ?? null;
  return null;
}

function fillSheet(ws: Worksheet, ctx: ExportContext) {
  // Geteilte Formeln in normale Formeln umwandeln, damit sie einzeln angepasst werden können
  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: false }, (cell) => {
      const f = formulaOf(cell);
      if (f !== null) cell.value = { formula: f } as never;
    }),
  );

  // Wiederholungszeilen von unten nach oben verarbeiten, damit Zeilennummern oberhalb gültig bleiben
  const repeatRows: { row: number; collection: Collection }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const texts: string[] = [];
    row.eachCell({ includeEmpty: false }, (c) => {
      const t = cellText(c);
      if (t) texts.push(t);
    });
    const coll = repeatCollection(texts);
    if (coll) repeatRows.push({ row: rowNumber, collection: coll });
  });
  repeatRows.sort((a, b) => b.row - a.row);

  for (const { row: r, collection } of repeatRows) {
    const items = ctx.collections[collection];
    const extra = Math.max(0, items.length - 1);
    if (extra > 0) {
      // Formeln im ganzen Blatt anpassen (vor dem Einfügen, Zeilen darunter rutschen danach)
      ws.eachRow({ includeEmpty: false }, (row) =>
        row.eachCell({ includeEmpty: false }, (cell) => {
          const f = formulaOf(cell);
          if (f !== null) cell.value = { formula: shiftFormulaForInsert(f, r, extra) } as never;
        }),
      );
      ws.duplicateRow(r, extra, true);
    }
    for (let i = 0; i < Math.max(items.length, 1); i++) {
      const row = ws.getRow(r + i);
      const item = items[i];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const f = formulaOf(cell);
        if (f !== null) {
          if (i > 0) cell.value = { formula: shiftRelativeRows(f, i) } as never;
          return;
        }
        const t = cellText(cell);
        if (t === null || !hasPlaceholder(t)) return;
        cell.value = item ? toCellValue(resolveText(t, ctx, { collection, row: item })) : null;
      });
      row.commit?.();
    }
  }

  // Einzelwerte im restlichen Blatt
  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: false }, (cell) => {
      const t = cellText(cell);
      if (t !== null && hasPlaceholder(t)) cell.value = toCellValue(resolveText(t, ctx));
    }),
  );
}

function toCellValue(v: Value): string | number | null {
  return v === '' ? null : v;
}

/* ---------- Standardlayout ---------- */

function styleHeader(ws: Worksheet, rowNo: number) {
  const row = ws.getRow(rowNo);
  row.font = { bold: true };
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EDFB' } };
    c.border = { bottom: { style: 'thin', color: { argb: 'FF1F2328' } } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
}

function styleSum(ws: Worksheet, rowNo: number) {
  const row = ws.getRow(rowNo);
  row.font = { bold: true };
  row.eachCell((c) => (c.border = { top: { style: 'thin', color: { argb: 'FF1F2328' } } }));
}

function title(ws: Worksheet, text: string, project: Project) {
  ws.getCell('A1').value = text;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = [project.name, project.meta.adresse].filter(Boolean).join(' · ');
  ws.getCell('A3').value = `Stand: ${new Date().toLocaleDateString('de-DE')}${project.meta.bearbeiter ? ` · Bearbeiter: ${project.meta.bearbeiter}` : ''}`;
  ws.getCell('A2').font = { color: { argb: 'FF6B7280' } };
  ws.getCell('A3').font = { color: { argb: 'FF6B7280' } };
}

const colLetter = (n: number) => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

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

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/* ---------- Mustervorlage ---------- */

/** Erzeugt eine Beispielvorlage, die alle Platzhalterarten zeigt – Ausgangspunkt für eigene Vorlagen. */
export async function buildSampleTemplate(): Promise<Uint8Array> {
  const ExcelJS = await excel();
  const wb: Workbook = new ExcelJS.Workbook();

  const ws = wb.addWorksheet('Flächen');
  ws.getCell('A1').value = 'Flächenberechnung {{projekt.name}}';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = '{{projekt.adresse}}';
  ws.getCell('A3').value = 'Stand: {{datum}} – Bearbeiter: {{projekt.bearbeiter}}';

  ws.getCell('A5').value = 'Geschoss';
  ws.getCell('B5').value = 'BGF [m²]';
  ws.getCell('C5').value = 'BRI [m³]';
  ws.getCell('D5').value = 'NRF [m²]';
  ws.getCell('E5').value = 'WoFl [m²]';
  ws.getCell('F5').value = 'NRF/BGF';
  styleHeader(ws, 5);
  ws.getRow(6).values = ['{{geschoss.name}}', '{{geschoss.bgf}}', '{{geschoss.bri}}', '{{geschoss.nrf}}', '{{geschoss.wofl}}'];
  ws.getCell('F6').value = { formula: 'IF(B6=0,"",D6/B6)' } as never;
  ws.getCell('F6').numFmt = '0.0%';
  ws.getRow(7).values = ['Summe'];
  ws.getCell('B7').value = { formula: 'SUM(B6:B6)' } as never;
  ws.getCell('C7').value = { formula: 'SUM(C6:C6)' } as never;
  ws.getCell('D7').value = { formula: 'SUM(D6:D6)' } as never;
  ws.getCell('E7').value = { formula: 'SUM(E6:E6)' } as never;
  styleSum(ws, 7);
  ws.getCell('A9').value = 'Kontrolle (Projektsumme BGF):';
  ws.getCell('B9').value = '{{summe.bgf}}';
  ws.getCell('A10').value = 'BGF Erdgeschoss (falls vorhanden):';
  ws.getCell('B10').value = '{{geschoss:EG.bgf}}';
  ['A', 'B', 'C', 'D', 'E', 'F'].forEach((c, i) => {
    ws.getColumn(c).width = i === 0 ? 34 : 13;
    if (i > 0 && i < 5) ws.getColumn(c).numFmt = NUM;
  });

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

  const wo = wb.addWorksheet('Wohnungen');
  wo.getRow(1).values = ['Wohnung', 'Räume', 'Wohnfläche [m²]'];
  styleHeader(wo, 1);
  wo.getRow(2).values = ['{{wohnung.name}}', '{{wohnung.anzahl_raeume}}', '{{wohnung.wofl}}'];
  wo.getRow(4).values = ['Nutzungsgruppe', 'Bezeichnung', 'Fläche [m²]'];
  styleHeader(wo, 4);
  wo.getRow(5).values = ['{{nutzung.gruppe}}', '{{nutzung.bezeichnung}}', '{{nutzung.flaeche}}'];
  [18, 40, 16].forEach((w, i) => (wo.getColumn(i + 1).width = w));
  wo.getColumn(3).numFmt = NUM;

  const help = wb.addWorksheet('Platzhalter');
  help.getCell('A1').value = 'Platzhalter für Excel-Vorlagen';
  help.getCell('A1').font = { bold: true, size: 14 };
  help.getCell('A2').value =
    'Platzhalter in doppelten geschweiften Klammern werden beim Export ersetzt. Eine Zeile mit raum.*, geschoss.*, wohnung.* oder nutzung.* wird je Eintrag wiederholt; Formeln (z. B. SUMME über diese Zeile) werden automatisch erweitert. Steht nur ein Platzhalter in der Zelle, wird eine Zahl eingetragen und das Zellformat der Vorlage bleibt erhalten. Dieses Blatt kann gelöscht werden.';
  help.getCell('A2').alignment = { wrapText: true };
  help.mergeCells('A2:B2');
  help.getRow(2).height = 75;
  let r = 4;
  for (const g of PLACEHOLDER_DOCS) {
    help.getCell(`A${r}`).value = g.group;
    help.getCell(`A${r}`).font = { bold: true };
    r++;
    for (const [k, d] of g.keys) {
      // Hilfetext ohne geschweifte Klammern, damit er selbst nicht ersetzt wird
      help.getCell(`A${r}`).value = k;
      help.getCell(`B${r}`).value = d;
      r++;
    }
    r++;
  }
  help.getColumn(1).width = 32;
  help.getColumn(2).width = 70;

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
