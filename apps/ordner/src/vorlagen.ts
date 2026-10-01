import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { ExportContext } from '@core/excel/context';
import { resolveText } from '@core/excel/context';

/**
 * Vorlagen füllen. Platzhalter stehen in doppelten geschweiften Klammern ({{projekt.nummer}},
 * {{bauherr.name}} …) – wie in den Excel-Vorlagen der anderen Werkzeuge. Unbekannte Platzhalter bleiben
 * stehen, damit Tippfehler auffallen.
 *
 *   Textdateien (.md, .txt, .csv, .json, .html, .xml …)  Platzhalter im Text
 *   Excel (.xlsx)                                        Vorlagen-Engine mit Wiederholungszeilen
 *   Word (.docx)                                         Platzhalter im Text, in Kopf- und Fußzeilen
 *   alles andere                                         unverändert kopiert
 */

const TEXT = /\.(md|txt|csv|tsv|json|html?|xml|ya?ml|ini|url)$/i;

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function text(v: unknown): string {
  return typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : String(v);
}

/** Platzhalter in einem Text ersetzen */
export function fuelleText(inhalt: string, ctx: ExportContext): string {
  return inhalt.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m) => {
    const v = resolveText(m, ctx);
    return v === m ? m : text(v);
  });
}

/**
 * Word: Platzhalter im Fließtext, in Kopf- und Fußzeilen. Ein Platzhalter muss in Word in einem Zug getippt
 * sein – wechselt mittendrin die Formatierung, zerlegt Word ihn, und er wird nicht erkannt.
 */
export function fuelleDocx(daten: Uint8Array, ctx: ExportContext): Uint8Array {
  const zip = unzipSync(daten);
  let geaendert = false;
  for (const name of Object.keys(zip)) {
    if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)) continue;
    const xml = strFromU8(zip[name]);
    const neu = xml.replace(/\{\{\s*([^{}<>]+?)\s*\}\}/g, (m) => {
      const v = resolveText(m, ctx);
      // Zeilenumbrüche als Umbruch im Absatz
      return v === m ? m : xmlEscape(text(v)).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
    });
    if (neu !== xml) {
      zip[name] = strToU8(neu);
      geaendert = true;
    }
  }
  return geaendert ? zipSync(zip, { level: 6 }) : daten;
}

/** Füllt eine Vorlage je nach Dateiart; unbekannte Arten bleiben unverändert */
export async function fuelleVorlage(name: string, daten: Uint8Array, ctx: ExportContext): Promise<Uint8Array> {
  if (TEXT.test(name)) {
    // BOM erhalten (Excel-CSV)
    const bom = daten.length >= 3 && daten[0] === 0xef && daten[1] === 0xbb && daten[2] === 0xbf;
    const inhalt = new TextDecoder('utf-8').decode(bom ? daten.subarray(3) : daten);
    const neu = strToU8(fuelleText(inhalt, ctx));
    if (!bom) return neu;
    const out = new Uint8Array(neu.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(neu, 3);
    return out;
  }
  if (/\.xlsx$/i.test(name)) return (await import('@core/excel/fill')).fuelleVorlage(daten, ctx);
  if (/\.docx$/i.test(name)) return fuelleDocx(daten, ctx);
  return daten;
}

/* ---------- Muster-Vorlagen ---------- */

/**
 * Ausgangspunkt für einen eigenen Vorlagenordner. Die Vorlagen gehören nicht ins Tool: Diese Muster werden
 * einmal in einen Ordner geschrieben und dort durch die eigenen Dateien des Büros ersetzt oder ergänzt.
 * Der Vorlagenordner ist aufgebaut wie ein Projektordner – jede Datei landet am selben Ort im Projekt.
 */
export const MUSTER_VORLAGEN: { pfad: string; inhalt: string }[] = [
  {
    pfad: 'LIESMICH.txt',
    inhalt: `Vorlagenordner für das Projektordner-Tool
==========================================

Dieser Ordner ist aufgebaut wie ein Projektordner. Jede Datei wird beim Anlegen eines Projekts an denselben
Ort im Projektordner kopiert; diese Datei (LIESMICH.txt im Stamm) wird nicht kopiert.

Platzhalter
-----------
In Datei- und Ordnernamen: {nummer}, {kurzname}, {jahr}
In Textdateien, Excel (.xlsx) und Word (.docx): {{projekt.nummer}}, {{projekt.kurzname}}, {{projekt.name}},
{{projekt.adresse}}, {{bauherr.name}}, {{bauherr.adresse}}, {{projekt.bearbeiter}}, {{datum}} ...
Die vollständige Liste zeigt das Tool unter "Struktur".

In Excel wird eine Zeile mit {{beteiligter.rolle}}, {{beteiligter.name}}, {{beteiligter.kontakt}} je
Beteiligtem wiederholt. In Word muss ein Platzhalter in einem Zug getippt sein.

Vorhandene Dateien im Projektordner werden nie überschrieben.
`,
  },
  {
    pfad: '00 Projekt/{nummer} Projektblatt.md',
    inhalt: `# Projektblatt {{projekt.nummer}} – {{projekt.kurzname}}

| | |
|---|---|
| Projekt | {{projekt.name}} |
| Projektnummer | {{projekt.nummer}} |
| Bauvorhaben | {{projekt.adresse}} |
| Grundstück | {{grundstueck.flurtext}} |
| Bauherr | {{bauherr.name}} |
| Anschrift Bauherr | {{bauherr.adresse}} |
| E-Mail | {{bauherr.email}} |
| Telefon | {{bauherr.telefon}} |
| Leistungsphasen | {{projekt.leistungsphasen}} |
| Bearbeitung | {{projekt.bearbeiter}} |
| Angelegt | {{datum}} |

## Beteiligte

{{beteiligte}}

## Notizen

`,
  },
  {
    pfad: '02 Pläne/{nummer} Planliste.csv',
    inhalt: `﻿Projekt;{{projekt.nummer}} {{projekt.kurzname}}\r\nStand;{{datum}}\r\n\r\nPlannummer;Index;Titel;Maßstab;Format;Datum;Verfasser;Verteiler;Bemerkung\r\n`,
  },
  {
    pfad: '05 Protokolle/{nummer} Besprechungsprotokoll Vorlage.md',
    inhalt: `# Besprechungsprotokoll Nr. __

**Projekt:** {{projekt.nummer}} – {{projekt.name}}
**Bauvorhaben:** {{projekt.adresse}}
**Datum / Ort:**
**Teilnehmer:**
**Verteiler:**

| Nr. | Thema / Festlegung | zuständig | Termin |
|---|---|---|---|
| 1 | | | |

Aufgestellt: {{projekt.bearbeiter}}
`,
  },
];

/** Platzhalter für die Hilfe unter „Struktur“ */
export const PLATZHALTER_DOCS: { gruppe: string; zeilen: [string, string][] }[] = [
  {
    gruppe: 'In Datei- und Ordnernamen (einfache Klammern)',
    zeilen: [
      ['{nummer}, {kurzname}', 'Projektnummer und Kurzname'],
      ['{jahr}', 'Jahr des Anlegens'],
    ],
  },
  {
    gruppe: 'In Vorlagen (doppelte Klammern)',
    zeilen: [
      ['{{projekt.nummer}}, {{projekt.kurzname}}', 'Projektnummer, Kurzname'],
      ['{{projekt.name}}, {{projekt.bezeichnung}}', 'Bezeichnung des Vorhabens (ohne Bezeichnung der Kurzname)'],
      ['{{projekt.adresse}}, {{projekt.strasse}}, {{projekt.plz}}, {{projekt.ort}}', 'Adresse des Bauvorhabens'],
      ['{{grundstueck.gemarkung}}, {{grundstueck.flur}}, {{grundstueck.flurstueck}}, {{grundstueck.flurtext}}, {{grundstueck.flaeche}}', 'Grundstück'],
      ['{{bauherr.name}}, {{bauherr.adresse}}, {{bauherr.email}}, {{bauherr.telefon}}', 'Bauherr'],
      ['{{projekt.bearbeiter}}, {{projekt.leistungsphasen}}, {{projekt.ordner}}', 'Bearbeitung, Leistungsphasen, Name des Projektordners'],
      ['{{datum}}, {{datum.iso}}, {{jahr}}', 'Datum des Anlegens'],
      ['{{beteiligte}}', 'alle Beteiligten, je Zeile „Rolle: Name (Kontakt)“'],
      ['{{beteiligter.rolle}}, {{beteiligter.name}}, {{beteiligter.kontakt}}', 'nur Excel: Zeile je Beteiligtem'],
      ['{{lph.nr}}, {{lph.name}}', 'nur Excel: Zeile je Leistungsphase'],
    ],
  },
];
