import type { Workbook, Worksheet } from 'exceljs';
import { excel, fuelleVorlage, platzhalterBlatt } from '@core/excel/fill';
import type { Project } from '@core/model';
import { buildKostenContext, KOSTEN_PLACEHOLDER_DOCS } from './exportData';

/**
 * Excel-Export der Kostenermittlung. Das Standardlayout ist die Muster-Vorlage selbst (ohne Hilfeblatt),
 * gefüllt über dieselbe Vorlagen-Engine wie eigene Vorlagen – was die Muster-Vorlage zeigt, kommt auch
 * im Standardexport heraus.
 */

const EURO = '#,##0 "€"';
const ZAHL = '#,##0.00';
const FAKTOR = '0.0000';
const PROZENT = '0.## "%"';
const SPALTEN = 8;
const THIN = { style: 'thin' as const, color: { argb: 'FF1F2328' } };
const GRAU = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9D9D9' } };

type Zelle = string | number | { formula: string } | null;

/** Blatt „Kosten“: Grundlagen, Kostenübersicht, Kennwerte, Positionen, Mengen, Kostenstände, Hinweise */
function kostenBlatt(wb: Workbook): Worksheet {
  const ws = wb.addWorksheet('Kosten');
  [8, 40, 13, 20, 13, 15, 15, 15].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.6, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter.oddFooter = '&L{{projekt.name}} · {{stufe}} · Stand {{datum}}&RSeite &P/&N';

  const put = (ref: string, v: Zelle, o: { fmt?: string; bold?: boolean; wrap?: boolean; right?: boolean } = {}) => {
    const c = ws.getCell(ref);
    c.value = v as never;
    if (o.fmt) c.numFmt = o.fmt;
    if (o.bold) c.font = { bold: true };
    if (o.wrap || o.right) c.alignment = { wrapText: !!o.wrap, vertical: 'top', horizontal: o.right ? 'right' : undefined };
  };
  const zeile = (r: number, werte: Zelle[], o: { bold?: boolean; fmts?: (string | undefined)[]; wrap?: number[] } = {}) =>
    werte.forEach((v, i) => {
      if (v === null) return;
      put(`${String.fromCharCode(65 + i)}${r}`, v, { bold: o.bold, fmt: o.fmts?.[i], wrap: o.wrap?.includes(i) });
    });
  const kopf = (r: number, werte: string[], rechtsAb = SPALTEN) => {
    zeile(r, werte, { bold: true });
    for (let i = 0; i < SPALTEN; i++) {
      ws.getCell(r, i + 1).border = { bottom: THIN };
      if (i >= rechtsAb) ws.getCell(r, i + 1).alignment = { horizontal: 'right' };
    }
  };
  const abschnitt = (r: number, text: string) => {
    put(`A${r}`, text, { bold: true });
    ws.mergeCells(`A${r}:H${r}`);
    ws.getCell(`A${r}`).fill = GRAU;
  };
  /** Zeile mit Formeln in F, G, H (von / Mittel / bis) */
  const betraege = (r: number, text: string, formel: (spalte: string) => string, o: { bold?: boolean; strich?: boolean } = {}) => {
    put(`B${r}`, text, { bold: o.bold });
    for (const s of ['F', 'G', 'H']) put(`${s}${r}`, { formula: formel(s) }, { fmt: EURO, bold: o.bold });
    if (o.strich) for (let i = 0; i < SPALTEN; i++) ws.getCell(r, i + 1).border = { top: THIN };
  };
  const euro3 = [undefined, undefined, undefined, undefined, undefined, EURO, EURO, EURO];

  // Kopf
  put('A1', 'Kostenermittlung nach DIN 276');
  ws.getCell('A1').font = { size: 11, color: { argb: 'FF6B7280' } };
  put('A3', '{{projekt.name}}');
  ws.getCell('A3').font = { bold: true, size: 12 };
  put('H3', 'Projekt {{projekt.code}}', { right: true });
  put('A4', '{{projekt.adresse}}');
  put('A5', '{{stufe}} ({{stufe.lph}})', { bold: true });
  put('A6', 'Stand {{datum}}');
  put('H6', '{{projekt.bearbeiter}}', { right: true });
  ws.getCell('A6').font = { size: 9 };
  ws.getCell('H6').font = { size: 9 };

  abschnitt(8, 'Grundlagen');
  put('A9', 'Preisstand');
  put('C9', '{{preisstand}}');
  put('A10', 'Kennwerte');
  put('C10', '{{katalog}}');
  put('A11', 'Baupreisindex zum Stand der Kennwerte');
  put('C11', '{{index.basis}}', { fmt: '0.0' });
  put('A12', 'Baupreisindex aktuell');
  put('C12', '{{index.aktuell}}', { fmt: '0.0' });
  put('A13', 'Regionalfaktor');
  put('C13', '{{regionalfaktor}}', { fmt: '0.000' });
  put('A14', 'Faktor auf die Kennwerte');
  put('C14', '{{faktor}}', { fmt: FAKTOR });
  for (const r of [9, 10, 11, 12, 13, 14]) ws.getCell(`C${r}`).alignment = { horizontal: 'left' };

  // ab hier dynamisch (Wiederholungszeilen)
  abschnitt(16, 'Kostenübersicht (netto)');
  kopf(17, ['KG', 'Kostengruppe', '', '', '', 'von', 'Mittel', 'bis'], 5);
  zeile(18, ['{{kg.kg}}', '{{kg.name}}', null, null, null, '{{kg.von}}', '{{kg.mittel}}', '{{kg.bis}}'], { fmts: euro3 });
  betraege(19, 'Gesamt netto', (s) => `SUM(${s}18:${s}18)`, { bold: true, strich: true });
  betraege(20, 'Umsatzsteuer', (s) => `${s}19*$C$20/100`);
  put('C20', '{{mwst}}', { fmt: PROZENT });
  betraege(21, 'Gesamt brutto', (s) => `${s}19+${s}20`, { bold: true, strich: true });

  abschnitt(23, 'Kennwerte Bauwerk (KG 300 + 400, brutto)');
  const kw = (r: number, text: string, b: string) => zeile(r, [null, text, null, null, null, `{{kennwert.${b}.von}}`, `{{kennwert.${b}}}`, `{{kennwert.${b}.bis}}`], { fmts: euro3 });
  kw(24, 'je m² BGF', 'bgf');
  kw(25, 'je m³ BRI', 'bri');
  kw(26, 'je m² NUF', 'nuf');
  kw(27, 'je m² Wohnfläche', 'wofl');

  abschnitt(29, 'Positionen (netto)');
  kopf(30, ['KG', 'Bezeichnung', 'Menge', 'Bezug', 'Kennwert', 'von', 'Mittel', 'bis'], 4);
  ws.getCell('C30').alignment = { horizontal: 'right' };
  zeile(
    31,
    [
      '{{position[aktiv].kg}}',
      '{{position[aktiv].bezeichnung}}',
      '{{position[aktiv].menge}}',
      '{{position[aktiv].bezug}}',
      '{{position[aktiv].kennwert}}',
      '{{position[aktiv].kosten_von}}',
      '{{position[aktiv].kosten}}',
      '{{position[aktiv].kosten_bis}}',
    ],
    { fmts: [undefined, undefined, ZAHL, undefined, ZAHL, EURO, EURO, EURO], wrap: [1] },
  );
  betraege(32, 'Summe', (s) => `SUM(${s}31:${s}31)`, { bold: true, strich: true });

  abschnitt(34, 'Mengen');
  kopf(35, ['', 'Menge', 'Wert', 'Einheit', 'Ermittlung', '', '', '']);
  ws.getCell('C35').alignment = { horizontal: 'right' };
  zeile(36, ['{{menge.kurz}}', '{{menge.label}}', '{{menge.wert}}', '{{menge.einheit}}', '{{menge.ermittlung}}'], { fmts: [undefined, undefined, ZAHL] });
  ws.mergeCells('E36:H36');

  abschnitt(38, 'Kostenstände (brutto)');
  kopf(39, ['Nr.', 'Stufe', 'Datum', 'Bemerkung', '', 'von', 'Mittel', 'bis'], 5);
  zeile(40, ['{{stand.nr}}', '{{stand.stufe}}', '{{stand.datum}}', '{{stand.bemerkung}}', null, '{{stand.brutto_von}}', '{{stand.brutto}}', '{{stand.brutto_bis}}'], { fmts: euro3 });
  ws.mergeCells('D40:E40');

  abschnitt(42, 'Hinweise');
  put('A43', '{{hinweis.text}}', { wrap: true });
  ws.mergeCells('A43:H43');
  put('A45', '{{haftung}}', { wrap: true });
  ws.getCell('A45').font = { size: 9, color: { argb: 'FF6B7280' } };
  ws.mergeCells('A45:H45');
  ws.getRow(45).height = 26;
  return ws;
}

async function vorlage(mitHilfe: boolean): Promise<Uint8Array> {
  const ExcelJS = await excel();
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = 'Kostenermittlung';
  wb.created = new Date();
  kostenBlatt(wb);
  if (mitHilfe)
    platzhalterBlatt(
      wb,
      KOSTEN_PLACEHOLDER_DOCS,
      'Platzhalter in doppelten geschweiften Klammern werden beim Export ersetzt. Zeilen mit kg.*, kg2.*, position.*, menge.*, stand.* oder hinweis.* werden je Datensatz wiederholt, #kg … /kg wiederholt ganze Zeilenblöcke je Kostengruppe. Formeln (z. B. SUMME über eine Wiederholungszeile) werden automatisch auf die erzeugten Zeilen erweitert. Steht nur ein Platzhalter in der Zelle, wird eine Zahl eingetragen und das Zellformat der Vorlage bleibt erhalten. Dieses Blatt kann gelöscht werden.',
    );
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Erzeugt die Muster-Vorlage (Blatt „Kosten“ und Platzhalter-Hilfe) – Ausgangspunkt für eigene Vorlagen. */
export const buildSampleTemplate = () => vorlage(true);

export async function exportWithTemplate(template: Uint8Array, project: Project, date = new Date()): Promise<Uint8Array> {
  return fuelleVorlage(template, buildKostenContext(project, date));
}

export async function exportDefault(project: Project, date = new Date()): Promise<Uint8Array> {
  return exportWithTemplate(await vorlage(false), project, date);
}
