import type { Cell, Style, Workbook, Worksheet } from 'exceljs';
import type { ProjectResult } from '../core/calc';
import type { ExportContext, Value } from '../core/exportData';
import { buildExportContext, PLACEHOLDER_DOCS, resolveText } from '../core/exportData';
import type { CellValue, TemplateRow } from '../core/template';
import { expandTemplate } from '../core/template';
import type { EvalValue } from '../core/formulaEval';
import { evaluateSheet } from '../core/formulaEval';
import { restoreTemplateGraphics } from './xlsxGraphics';
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
  wb.eachSheet((ws) => fillHeaderFooter(ws, ctx));
  wb.eachSheet((ws) => fillSheet(ws, ctx));
  wb.eachSheet((ws) => writeFormulaResults(ws));
  // Excel soll alle Formeln beim Öffnen neu berechnen
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
  // Logos/Bilder der Vorlage (auch in Kopf-/Fußzeile) unverändert übernehmen
  // Textfelder in Zeichnungen erhalten ebenfalls ersetzte Platzhalter
  return restoreTemplateGraphics(template, new Uint8Array(await wb.xlsx.writeBuffer()), (t) => String(resolveText(t, ctx)));
}

const HF_KEYS = ['oddHeader', 'oddFooter', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter'] as const;

/** Platzhalter in Kopf-/Fußzeilen ersetzen („&“ ist dort Steuerzeichen und wird verdoppelt) */
function fillHeaderFooter(ws: Worksheet, ctx: ExportContext) {
  const hf = ws.headerFooter as Record<string, unknown> | undefined;
  if (!hf) return;
  for (const k of HF_KEYS) {
    const t = hf[k];
    if (typeof t !== 'string' || !t.includes('{{')) continue;
    hf[k] = t.replace(/\{\{[^{}]+\}\}/g, (m) => {
      const v = resolveText(m, ctx);
      return v === m ? m : (typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : String(v)).replace(/&/g, '&&');
    });
  }
}

function formulaOf(cell: Cell): string | null {
  const v = cell.value as unknown;
  if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) return cell.formula ?? null;
  return null;
}

/**
 * Füllt ein Blatt über die Vorlagen-Engine (core/template.ts):
 * Zeilen ab der ersten dynamischen Zeile werden neu geschrieben; Formatierung, Zeilenhöhe und
 * einzeilige Zellverbünde stammen jeweils aus der zugehörigen Vorlagenzeile. Der Bereich darüber
 * (Kopf mit Logo, Projektangaben) bleibt unverändert – dort werden nur Platzhalter ersetzt.
 */
function fillSheet(ws: Worksheet, ctx: ExportContext) {
  const lastRow = ws.rowCount;
  const lastCol = Math.max(ws.columnCount, 1);
  const tpl: TemplateRow[] = [];
  const styles = new Map<number, Map<number, Partial<Style>>>();
  const heights = new Map<number, number | undefined>();
  const rowStyles = new Map<number, Partial<Style>>();
  let firstDynamic = Infinity;
  const dynamic = /\{\{\s*(#|\/|(geschoss|raum|wohnung|nutzung|bri)(\[[^\]]*\])?\.)/i;

  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    heights.set(r, row.height);
    rowStyles.set(r, JSON.parse(JSON.stringify((row as unknown as { style?: Partial<Style> }).style ?? {})));
    const cells = new Map<number, CellValue>();
    const st = new Map<number, Partial<Style>>();
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      st.set(c, JSON.parse(JSON.stringify(cell.style ?? {})));
      const f = formulaOf(cell);
      if (f !== null) {
        cells.set(c, { formula: f });
        continue;
      }
      const v = cell.value as CellValue;
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'object' && !(v instanceof Date) && !('richText' in v)) continue; // Hyperlinks, Fehlerwerte …
      cells.set(c, v);
      const t = typeof v === 'string' ? v : v && typeof v === 'object' && 'richText' in v ? v.richText.map((x: { text: string }) => x.text).join('') : '';
      if (t && dynamic.test(t)) firstDynamic = Math.min(firstDynamic, r);
    }
    styles.set(r, st);
    tpl.push({ r, cells });
  }

  if (!Number.isFinite(firstDynamic)) {
    // nur Einzelwerte → Platzhalter an Ort und Stelle ersetzen
    const out = expandTemplate(tpl, ctx);
    out.forEach((o, i) => o.cells.forEach((v, c) => (ws.getCell(i + 1, c).value = v as never)));
    return;
  }

  const out = expandTemplate(tpl, ctx);
  // Zellverbünde im dynamischen Bereich merken und lösen
  const merges: { row: number; c1: number; c2: number }[] = [];
  for (const m of ((ws.model as { merges?: string[] }).merges ?? []).slice()) {
    const mm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
    if (!mm) continue;
    const r1 = Number(mm[2]);
    const r2 = Number(mm[4]);
    if (r2 < firstDynamic) continue;
    ws.unMergeCells(m);
    if (r1 === r2) merges.push({ row: r1, c1: colNumber(mm[1]), c2: colNumber(mm[3]) });
  }

  // Zeilen oberhalb: nur Platzhalter ersetzen (Zeilennummern sind dort identisch)
  for (let i = 0; i < firstDynamic - 1 && i < out.length; i++) out[i].cells.forEach((v, c) => (ws.getCell(i + 1, c).value = v as never));

  // ab der ersten dynamischen Zeile neu schreiben
  const total = Math.max(out.length, lastRow);
  for (let r = firstDynamic; r <= total; r++) {
    const o = out[r - 1];
    const row = ws.getRow(r);
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      if (!o) {
        cell.value = null;
        cell.style = {};
        continue;
      }
      cell.style = JSON.parse(JSON.stringify(styles.get(o.src)?.get(c) ?? {}));
      const v = o.cells.get(c);
      cell.value = (v === undefined ? null : v) as never;
    }
    row.height = o ? (heights.get(o.src) as number) : (undefined as never);
    // zeilenweite Formatierung der Vorlagenzeile mitnehmen (sonst bliebe sie an der alten Zeilennummer)
    (row as unknown as { style: Partial<Style> }).style = o ? JSON.parse(JSON.stringify(rowStyles.get(o.src) ?? {})) : {};
  }
  // Zellverbünde je erzeugter Zeile wiederherstellen
  for (let r = firstDynamic; r <= out.length; r++) {
    for (const m of merges.filter((x) => x.row === out[r - 1].src)) ws.mergeCells(r, m.c1, r, m.c2);
  }
}

/**
 * Formelergebnisse vorberechnen und mitspeichern – für Programme, die beim Öffnen nicht neu rechnen
 * (Dateivorschau, LibreOffice-Standard). Excel rechnet wegen fullCalcOnLoad ohnehin neu.
 */
function writeFormulaResults(ws: Worksheet) {
  const cells = new Map<string, EvalValue | { formula: string }>();
  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: false }, (cell) => {
      const f = formulaOf(cell);
      if (f !== null) cells.set(cell.address, { formula: f });
      else {
        const v = cell.value as unknown;
        if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') cells.set(cell.address, v);
      }
    }),
  );
  const results = evaluateSheet(cells);
  for (const [addr, result] of results) {
    const f = cells.get(addr) as { formula: string };
    ws.getCell(addr).value = { formula: f.formula, result: result ?? '' } as never;
  }
}

function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
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
  ws.getCell('A2').value = [project.meta.projektcode, project.name, project.meta.adresse].filter(Boolean).join(' · ');
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

  /* BRI mit Rechenweg: Teilkörper je Geschoss, Volumen per Excel-Formel */
  {
    const ws = wb.addWorksheet('BRI');
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
    const help = wb.addWorksheet('Platzhalter');
    help.getCell('A1').value = 'Platzhalter für Excel-Vorlagen';
    help.getCell('A1').font = { bold: true, size: 14 };
    help.getCell('A2').value =
      'Platzhalter in doppelten geschweiften Klammern werden beim Export ersetzt. Zeilen mit raum.*, geschoss.*, wohnung.*, nutzung.* oder bri.* werden je Datensatz wiederholt, #geschoss … /geschoss wiederholt ganze Zeilenblöcke. Formeln (z. B. SUMME über eine Wiederholungszeile) werden automatisch auf die erzeugten Zeilen erweitert. Steht nur ein Platzhalter in der Zelle, wird eine Zahl eingetragen und das Zellformat der Vorlage bleibt erhalten. Dieses Blatt kann gelöscht werden.';
    help.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
    help.mergeCells('A2:B2');
    help.getRow(2).height = 90;
    let r = 4;
    for (const g of PLACEHOLDER_DOCS) {
      help.getCell(`A${r}`).value = g.group;
      help.getCell(`A${r}`).font = { bold: true };
      r++;
      for (const [k, d] of g.keys) {
        // ohne geschweifte Klammern, damit die Hilfe selbst nicht ersetzt wird
        help.getCell(`A${r}`).value = k;
        help.getCell(`B${r}`).value = d;
        help.getCell(`B${r}`).alignment = { wrapText: true };
        r++;
      }
      r++;
    }
    help.getColumn(1).width = 40;
    help.getColumn(2).width = 90;
  }

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
