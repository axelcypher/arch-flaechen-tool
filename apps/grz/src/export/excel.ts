import type { Workbook, Worksheet } from 'exceljs';
import { excel, fuelleVorlage, platzhalterBlatt } from '@core/excel/fill';
import type { Project } from '@core/model';
import { buildGrzContext, GRZ_PLACEHOLDER_DOCS } from './exportData';

/**
 * Excel-Export des GRZ-Nachweises. Das Standardlayout ist die Muster-Vorlage selbst (ohne Hilfeblatt),
 * gefüllt über dieselbe Vorlagen-Engine wie eigene Vorlagen – was die Muster-Vorlage zeigt, kommt auch
 * im Standardexport heraus.
 */

const M2 = '#,##0.00 "m²"';
const M = '0.00 "m"';
const RATIO = '0.00';
const PROZENT = '0 %';
const THIN = { style: 'thin' as const, color: { argb: 'FF1F2328' } };
const GRAU = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9D9D9' } };

type Zelle = string | number | { formula: string } | null;

/** Blatt „GRZ GFZ“: Grundlagen, Kennzahlen, Vollgeschosse, Geschossfläche, Flächenbilanz, Lageplan, Hinweise */
function nachweisBlatt(wb: Workbook): Worksheet {
  const ws = wb.addWorksheet('GRZ GFZ');
  [22, 34, 14, 14, 14, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.6, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter.oddFooter = '&L{{projekt.name}} · Stand {{datum}}&RSeite &P/&N';

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
  const kopf = (r: number, werte: string[]) => {
    zeile(r, werte, { bold: true });
    for (let i = 0; i < 6; i++) ws.getCell(r, i + 1).border = { bottom: THIN };
  };
  const abschnitt = (r: number, text: string) => {
    put(`A${r}`, text, { bold: true });
    ws.mergeCells(`A${r}:F${r}`);
    ws.getCell(`A${r}`).fill = GRAU;
  };
  const summe = (r: number, spalte: string, von: number, bis: number) => {
    put(`B${r}`, 'Summe', { bold: true });
    put(`${spalte}${r}`, { formula: `SUM(${spalte}${von}:${spalte}${bis})` }, { fmt: M2, bold: true });
    for (let i = 0; i < 6; i++) ws.getCell(r, i + 1).border = { top: THIN };
  };

  // Kopf
  put('A1', 'Nachweis des Maßes der baulichen Nutzung');
  ws.getCell('A1').font = { size: 11, color: { argb: 'FF6B7280' } };
  put('A3', '{{projekt.name}}');
  ws.getCell('A3').font = { bold: true, size: 12 };
  put('F3', 'Projekt {{projekt.code}}', { right: true });
  put('A4', '{{projekt.adresse}}');
  put('A5', '{{grundstueck.flurtext}}');
  put('A6', 'Stand {{datum}}');
  put('F6', '{{projekt.bearbeiter}}', { right: true });
  ws.getCell('A6').font = { size: 9 };
  ws.getCell('F6').font = { size: 9 };

  abschnitt(8, 'Grundlagen');
  zeile(9, ['Bebauungsplan vom', '{{bplan.datum}}']);
  zeile(10, ['Baunutzungsverordnung', '{{baunvo.fassung}}']);
  zeile(11, ['Vollgeschossbegriff', '{{bauo.fassung}}']);
  zeile(12, ['Grundstücksfläche', '{{grundstueck.quelle}}', '{{grundstueck.flaeche_nachweis}}'], { fmts: [undefined, undefined, M2] });
  zeile(13, ['Geländeoberfläche', '{{gelaende.quelle}}', '{{gelaende}}'], { fmts: [undefined, undefined, M] });
  zeile(14, ['Hauptanlage', 'Grundfläche der Gebäude', '{{hauptanlage}}'], { fmts: [undefined, undefined, M2] });

  abschnitt(16, 'Kennzahlen');
  kopf(17, ['', '', 'Fläche', 'vorhanden', 'zulässig', 'Ergebnis']);
  const kz = [undefined, undefined, M2, RATIO, RATIO];
  zeile(18, ['{{grz.bezeichnung}}', 'Grundfläche', '{{grz.flaeche}}', '{{grz}}', '{{grz.zulaessig}}', '{{grz.status}}'], { fmts: kz });
  zeile(19, ['{{grz.ii.bezeichnung}}', '', '{{grz.ii.flaeche}}', '{{grz.ii}}', '{{grz.ii.zulaessig}}', '{{grz.ii.status}}'], { fmts: kz });
  zeile(20, ['GFZ', 'Geschossfläche', '{{gf}}', '{{gfz}}', '{{gfz.zulaessig}}', '{{gfz.status}}'], { fmts: kz });
  zeile(21, ['Vollgeschosse', '{{vollgeschosse.namen}}', null, '{{vollgeschosse}}', '{{vollgeschosse.zulaessig}}', '{{vollgeschosse.status}}'], { fmts: [undefined, undefined, undefined, '0', '0'] });
  ws.getCell('D18').font = { bold: true };
  ws.getCell('D20').font = { bold: true };
  ws.getCell('D21').font = { bold: true };

  // ab hier dynamisch (Wiederholungszeilen)
  abschnitt(23, 'Vollgeschosse');
  kopf(24, ['Geschoss', 'Begründung', 'über Gelände', 'Anteil', 'Ergebnis', '']);
  zeile(25, ['{{geschoss.name}}', '{{geschoss.begruendung}}', '{{geschoss.ueber_gelaende}}', '{{geschoss.anteil}}', '{{geschoss.ergebnis}}'], {
    fmts: [undefined, undefined, M, PROZENT],
    wrap: [1],
  });
  ws.mergeCells('E25:F25');

  abschnitt(27, 'Geschossfläche');
  kopf(28, ['Geschoss', 'Ermittlung', 'Fläche', '', '', '']);
  zeile(29, ['{{geschoss.name}}', '{{geschoss.gf_art}}', '{{geschoss.gf}}'], { fmts: [undefined, undefined, M2], wrap: [1] });
  summe(30, 'C', 29, 29);

  put('A32', '{{aufenthalt.titel}}', { bold: true });
  zeile(33, ['{{raum[gf].geschoss}}', '{{raum[gf].nummer}} {{raum[gf].name}}', '{{raum[gf].flaeche}}', '{{raum[gf].aufenthalt}}'], { fmts: [undefined, undefined, M2] });
  ws.mergeCells('D33:F33');

  abschnitt(35, 'Flächenbilanz des Grundstücks');
  zeile(36, [null, 'Gebäude', '{{bilanz.gebaeude}}'], { fmts: [undefined, undefined, M2] });
  zeile(37, [null, 'vollversiegelt', '{{bilanz.vollversiegelt}}'], { fmts: [undefined, undefined, M2] });
  zeile(38, [null, 'teilversiegelt', '{{bilanz.teilversiegelt}}'], { fmts: [undefined, undefined, M2] });
  zeile(39, [null, 'Grünfläche', '{{bilanz.gruen}}'], { fmts: [undefined, undefined, M2] });
  summe(40, 'C', 36, 39);

  abschnitt(42, 'Lageplan-Flächen');
  kopf(43, ['Fläche', 'Nutzung', 'Fläche', 'Versiegelung', 'Anrechnung', '']);
  zeile(44, ['{{lageplan[eigen].name}}', '{{lageplan[eigen].nutzung}}', '{{lageplan[eigen].flaeche}}', '{{lageplan[eigen].versiegelung}}', '{{lageplan[eigen].anrechnung}}'], {
    fmts: [undefined, undefined, M2],
  });
  ws.mergeCells('E44:F44');
  summe(45, 'C', 44, 44);

  abschnitt(47, 'Hinweise');
  put('A48', '{{hinweis.text}}', { wrap: true });
  ws.mergeCells('A48:F48');
  put('A50', '{{haftung}}', { wrap: true });
  ws.getCell('A50').font = { size: 9, color: { argb: 'FF6B7280' } };
  ws.mergeCells('A50:F50');
  ws.getRow(50).height = 26;
  return ws;
}

async function vorlage(mitHilfe: boolean): Promise<Uint8Array> {
  const ExcelJS = await excel();
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = 'GRZ-Nachweis';
  wb.created = new Date();
  nachweisBlatt(wb);
  if (mitHilfe)
    platzhalterBlatt(
      wb,
      GRZ_PLACEHOLDER_DOCS,
      'Platzhalter in doppelten geschweiften Klammern werden beim Export ersetzt. Zeilen mit geschoss.*, lageplan.*, raum.* oder hinweis.* werden je Datensatz wiederholt, #geschoss … /geschoss wiederholt ganze Zeilenblöcke. Formeln (z. B. SUMME über eine Wiederholungszeile) werden automatisch auf die erzeugten Zeilen erweitert. Steht nur ein Platzhalter in der Zelle, wird eine Zahl eingetragen und das Zellformat der Vorlage bleibt erhalten. Dieses Blatt kann gelöscht werden.',
    );
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Erzeugt die Muster-Vorlage (Blatt „GRZ GFZ“ und Platzhalter-Hilfe) – Ausgangspunkt für eigene Vorlagen. */
export const buildSampleTemplate = () => vorlage(true);

export async function exportWithTemplate(template: Uint8Array, project: Project, date = new Date()): Promise<Uint8Array> {
  return fuelleVorlage(template, buildGrzContext(project, date));
}

export async function exportDefault(project: Project, date = new Date()): Promise<Uint8Array> {
  return exportWithTemplate(await vorlage(false), project, date);
}
