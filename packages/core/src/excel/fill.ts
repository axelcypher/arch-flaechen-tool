import type { Cell, Style, Workbook, Worksheet } from 'exceljs';
import type { Project } from '../model';
import { anschriftEinzeilig } from '../model';
import type { ExportContext, PlaceholderDocs, Value } from './context';
import { resolveText } from './context';
import type { EvalValue } from './formulaEval';
import { evaluateSheet } from './formulaEval';
import type { CellValue, TemplateRow } from './template';
import { expandTemplate } from './template';
import { restoreTemplateGraphics } from './xlsxGraphics';

/**
 * Excel-Grundlagen für alle Apps (ExcelJS, erst bei Bedarf geladen): Vorlage mit Platzhaltern füllen
 * und Bausteine für Standardlayouts.
 */

export async function excel() {
  const mod = await import('exceljs');
  return (mod as unknown as { default?: typeof import('exceljs') }).default ?? mod;
}

export const NUM = '#,##0.00';

/* ---------- Vorlage füllen ---------- */

/**
 * Füllt eine Vorlage (.xlsx) mit den Werten eines Export-Kontexts: Kopf-/Fußzeilen, Zellen,
 * wiederholte Zeilen und Blöcke, Formelergebnisse; Bilder und Zeichnungen der Vorlage bleiben erhalten.
 */
export async function fuelleVorlage(template: Uint8Array, ctx: ExportContext): Promise<Uint8Array> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength) as ArrayBuffer);
  } catch (e) {
    throw new Error(`Die Vorlage konnte nicht gelesen werden (nur .xlsx wird unterstützt): ${e instanceof Error ? e.message : String(e)}`);
  }
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
 * Füllt ein Blatt über die Vorlagen-Engine (template.ts):
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
  const dynamic = new RegExp(`\\{\\{\\s*(#|\\/|(${Object.keys(ctx.collections).join('|')})(\\[[^\\]]*\\])?\\.)`, 'i');

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
export function writeFormulaResults(ws: Worksheet) {
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

export function toCellValue(v: Value): string | number | null {
  return v === '' ? null : v;
}

/* ---------- Standardlayout ---------- */

export function styleHeader(ws: Worksheet, rowNo: number) {
  const row = ws.getRow(rowNo);
  row.font = { bold: true };
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EDFB' } };
    c.border = { bottom: { style: 'thin', color: { argb: 'FF1F2328' } } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
}

export function styleSum(ws: Worksheet, rowNo: number) {
  const row = ws.getRow(rowNo);
  row.font = { bold: true };
  row.eachCell((c) => (c.border = { top: { style: 'thin', color: { argb: 'FF1F2328' } } }));
}

export function titel(ws: Worksheet, text: string, project: Project) {
  ws.getCell('A1').value = text;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = [project.meta.projektcode, project.name, anschriftEinzeilig(project.meta.adresse)].filter(Boolean).join(' · ');
  ws.getCell('A3').value = `Stand: ${new Date().toLocaleDateString('de-DE')}${project.meta.bearbeiter ? ` · Bearbeiter: ${project.meta.bearbeiter}` : ''}`;
  ws.getCell('A2').font = { color: { argb: 'FF6B7280' } };
  ws.getCell('A3').font = { color: { argb: 'FF6B7280' } };
}

export const colLetter = (n: number) => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/** Blatt „Platzhalter“ der Muster-Vorlagen: Einleitung und alle Platzhalter (ohne Klammern, damit sie nicht ersetzt werden) */
export function platzhalterBlatt(wb: Workbook, docs: PlaceholderDocs, einleitung: string) {
  const help = wb.addWorksheet('Platzhalter');
  help.getCell('A1').value = 'Platzhalter für Excel-Vorlagen';
  help.getCell('A1').font = { bold: true, size: 14 };
  help.getCell('A2').value = einleitung;
  help.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
  help.mergeCells('A2:B2');
  help.getRow(2).height = 90;
  let r = 4;
  for (const g of docs) {
    help.getCell(`A${r}`).value = g.group;
    help.getCell(`A${r}`).font = { bold: true };
    r++;
    for (const [k, d] of g.keys) {
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
