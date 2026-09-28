import type { AreaTotals, ProjectResult } from './calc';
import type { Project } from './model';
import { NUF_IDS, NUTZUNGSGRUPPEN, nutzungInfo, WOFL_KATEGORIEN } from './norms';

/**
 * Datengrundlage für Excel-Export und Vorlagen.
 *
 * Platzhalter in Vorlagen:
 *   {{projekt.name}}            Einzelwerte (siehe SCALAR_KEYS)
 *   {{summe.bgf}}               Projektsummen
 *   {{geschoss:EG.bgf}}         Werte eines bestimmten Geschosses (über den Namen)
 *   {{wohnung:WE 01.wofl}}      Werte einer bestimmten Wohnung
 *   {{raum.flaeche}}            in einer Zeile → Zeile wird je Raum wiederholt
 *   {{geschoss.bgf}}            in einer Zeile → Zeile wird je Geschoss wiederholt
 *   {{wohnung.wofl}}            in einer Zeile → Zeile wird je Wohnung wiederholt
 *   {{nutzung.flaeche}}         in einer Zeile → Zeile wird je Nutzungsgruppe wiederholt
 */

export type Value = string | number;
export type Row = Record<string, Value>;

export const COLLECTIONS = ['geschoss', 'raum', 'wohnung', 'nutzung'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export interface ExportContext {
  scalars: Record<string, Value>;
  collections: Record<Collection, Row[]>;
  /** zum Nachschlagen einzelner Geschosse/Wohnungen per Name */
  byName: { geschoss: Map<string, Row>; wohnung: Map<string, Row> };
}

/** Beschreibung aller Platzhalter – Grundlage für Hilfe-Tabelle und Musterdatei. */
export const PLACEHOLDER_DOCS: { group: string; keys: [string, string][] }[] = [
  {
    group: 'projekt / datum',
    keys: [
      ['projekt.name', 'Projektbezeichnung'],
      ['projekt.adresse', 'Adresse'],
      ['projekt.bearbeiter', 'Bearbeiter'],
      ['datum', 'Datum des Exports'],
    ],
  },
  {
    group: 'Kennwerte (summe.*, geschoss.*, geschoss:NAME.*)',
    keys: [
      ['bgf, bgf_r, bgf_s', 'Brutto-Grundfläche gesamt / Regelfall / Sonderfall [m²]'],
      ['bri, bri_r, bri_s', 'Brutto-Rauminhalt [m³]'],
      ['nuf, nuf1 … nuf7', 'Nutzungsfläche gesamt bzw. je Nutzungsgruppe [m²]'],
      ['tf, vf', 'Technikfläche, Verkehrsfläche [m²]'],
      ['nrf, nrf_r, nrf_s', 'Netto-Raumfläche [m²]'],
      ['kgf', 'Konstruktions-Grundfläche (BGF − NRF) [m²]'],
      ['wofl', 'Wohnfläche nach WoFlV [m²]'],
      ['anzahl_raeume', 'Anzahl Räume'],
      ['name, hoehe, nr', 'nur geschoss.*: Bezeichnung, Geschosshöhe, laufende Nr.'],
    ],
  },
  {
    group: 'raum.* (Zeile je Raum)',
    keys: [
      ['raum.nr', 'laufende Nummer'],
      ['raum.geschoss', 'Geschoss'],
      ['raum.nummer', 'Raumnummer'],
      ['raum.name', 'Raumbezeichnung'],
      ['raum.nutzung', 'Nutzungsgruppe kurz (z. B. NUF 1)'],
      ['raum.nutzung_text', 'Nutzungsgruppe ausgeschrieben'],
      ['raum.umschliessung', 'R oder S'],
      ['raum.flaeche', 'Grundfläche [m²] (Abzugsflächen negativ)'],
      ['raum.wofl_kategorie', 'Anrechnung nach WoFlV'],
      ['raum.wofl_faktor', 'Anrechnungsfaktor'],
      ['raum.wofl', 'anrechenbare Wohnfläche [m²]'],
      ['raum.wohnung', 'Wohnungszuordnung'],
      ['raum.abzug', '„Abzug“ bei Abzugsflächen, sonst leer'],
      ['raum.bemerkung', 'Bemerkung'],
    ],
  },
  {
    group: 'wohnung.* (Zeile je Wohnung) bzw. wohnung:NAME.*',
    keys: [
      ['wohnung.nr', 'laufende Nummer'],
      ['wohnung.name', 'Bezeichnung'],
      ['wohnung.anzahl_raeume', 'Anzahl Räume'],
      ['wohnung.grundflaeche', 'Summe Grundflächen [m²]'],
      ['wohnung.wofl', 'Wohnfläche [m²]'],
    ],
  },
  {
    group: 'nutzung.* (Zeile je Nutzungsgruppe)',
    keys: [
      ['nutzung.gruppe', 'Kürzel (NUF 1 … VF 9)'],
      ['nutzung.bezeichnung', 'Bezeichnung'],
      ['nutzung.flaeche', 'Fläche gesamt [m²]'],
    ],
  },
];

const r2 = (v: number) => Math.round(v * 100) / 100;

function totalsRow(t: AreaTotals): Row {
  const row: Row = {
    bgf: r2(t.bgf.total),
    bgf_r: r2(t.bgf.R),
    bgf_s: r2(t.bgf.S),
    bri: r2(t.bri.total),
    bri_r: r2(t.bri.R),
    bri_s: r2(t.bri.S),
    nuf: r2(t.nuf.total),
    tf: r2(t.tf.total),
    vf: r2(t.vf.total),
    nrf: r2(t.nrf.total),
    nrf_r: r2(t.nrf.R),
    nrf_s: r2(t.nrf.S),
    kgf: r2(t.kgf.total),
    wofl: r2(t.wofl),
  };
  NUF_IDS.forEach((id, i) => (row[`nuf${i + 1}`] = r2(t.nutzung[id])));
  return row;
}

export function buildExportContext(project: Project, result: ProjectResult, date = new Date()): ExportContext {
  const scalars: Record<string, Value> = {
    'projekt.name': project.name,
    'projekt.adresse': project.meta.adresse,
    'projekt.bearbeiter': project.meta.bearbeiter,
    datum: date.toLocaleDateString('de-DE'),
  };
  const sum = totalsRow(result.total);
  sum.anzahl_raeume = result.storeys.reduce((a, s) => a + s.rooms.length, 0);
  for (const [k, v] of Object.entries(sum)) scalars[`summe.${k}`] = v;

  const geschoss: Row[] = result.storeys.map((s, i) => ({
    nr: i + 1,
    name: s.name,
    hoehe: r2(s.hoehe),
    anzahl_raeume: s.rooms.length,
    ...totalsRow(s),
  }));

  let nr = 0;
  const shapesById = new Map(project.storeys.flatMap((st) => st.shapes.map((sh) => [sh.id, sh] as const)));
  const raum: Row[] = result.storeys.flatMap((s) =>
    s.rooms.map((r) => ({
      nr: ++nr,
      geschoss: r.storeyName,
      nummer: r.nummer,
      name: r.name,
      nutzung: nutzungInfo(r.nutzung).kurz,
      nutzung_text: nutzungInfo(r.nutzung).label,
      umschliessung: r.umschliessung,
      flaeche: r2(r.area),
      wofl_kategorie: r.woflKategorie === 'keine' ? '' : (WOFL_KATEGORIEN.find((k) => k.id === r.woflKategorie)?.label ?? ''),
      wofl_faktor: r.woflKategorie === 'keine' ? '' : r2(r.woflFaktor),
      wofl: r.woflKategorie === 'keine' ? '' : r2(r.woflArea),
      wohnung: r.wohnung,
      abzug: r.subtract ? 'Abzug' : '',
      bemerkung: shapesById.get(r.shapeId)?.bemerkung ?? '',
    })),
  );

  const wohnung: Row[] = result.wohnungen.map((w, i) => ({
    nr: i + 1,
    name: w.wohnung,
    anzahl_raeume: w.rooms.length,
    grundflaeche: r2(w.grundflaeche),
    wofl: r2(w.wofl),
  }));

  const nutzung: Row[] = NUTZUNGSGRUPPEN.map((n) => ({ gruppe: n.kurz, bezeichnung: n.label, flaeche: r2(result.total.nutzung[n.id]) }));

  return {
    scalars,
    collections: { geschoss, raum, wohnung, nutzung },
    byName: {
      geschoss: new Map(geschoss.map((g) => [String(g.name), g])),
      wohnung: new Map(wohnung.map((w) => [String(w.name), w])),
    },
  };
}

const PH_SOURCE = /\{\{\s*([^{}]+?)\s*\}\}/.source;
/** immer neue RegExp-Instanz: globale RegExps tragen lastIndex-Zustand zwischen Aufrufen */
const ph = () => new RegExp(PH_SOURCE, 'g');

/** Welche Sammlung wiederholt diese Zeile? (erste gefundene) */
export function repeatCollection(texts: string[]): Collection | null {
  for (const t of texts) {
    for (const m of t.matchAll(ph())) {
      const key = m[1];
      for (const c of COLLECTIONS) if (key.startsWith(`${c}.`)) return c;
    }
  }
  return null;
}

function lookup(key: string, ctx: ExportContext, item?: { collection: Collection; row: Row }): Value | undefined {
  if (key in ctx.scalars) return ctx.scalars[key];
  if (item && key.startsWith(`${item.collection}.`)) return item.row[key.slice(item.collection.length + 1)];
  const named = /^(geschoss|wohnung):(.+)\.([a-z0-9_]+)$/.exec(key);
  if (named) {
    const row = ctx.byName[named[1] as 'geschoss' | 'wohnung'].get(named[2].trim());
    return row ? row[named[3]] : '';
  }
  return undefined;
}

/**
 * Ersetzt Platzhalter in einem Zellinhalt. Besteht die Zelle nur aus einem Platzhalter,
 * wird der Rohwert (z. B. Zahl) zurückgegeben, damit Excel damit rechnen kann.
 * Unbekannte Platzhalter bleiben sichtbar stehen, damit Tippfehler auffallen.
 */
export function resolveText(text: string, ctx: ExportContext, item?: { collection: Collection; row: Row }): Value {
  const whole = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(text);
  if (whole) {
    const v = lookup(whole[1], ctx, item);
    return v === undefined ? text : v;
  }
  return text.replace(ph(), (m, key: string) => {
    const v = lookup(key, ctx, item);
    if (v === undefined) return m;
    return typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : v;
  });
}

export function hasPlaceholder(text: string): boolean {
  return new RegExp(PH_SOURCE).test(text);
}

/* ---------- Formelanpassung beim Einfügen von Zeilen ---------- */

// Zellbezug oder Bereich, nicht Teil eines Namens/Funktionsnamens und nicht auf ein anderes Blatt
const REF = /(^|[^A-Za-z0-9_.!$'"])(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(])/g;

function mapOutsideStrings(formula: string, fn: (part: string) => string): string {
  // Zeichenketten in Anführungszeichen unverändert lassen
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('');
}

/**
 * Passt eine Formel an, nachdem unter Zeile `row` `count` Kopien dieser Zeile eingefügt wurden.
 * Bezüge unterhalb von `row` rutschen nach unten, Bereiche, die in `row` enden, werden erweitert
 * (z. B. SUMME(C5:C5) → SUMME(C5:C9)).
 */
export function shiftFormulaForInsert(formula: string, row: number, count: number): string {
  if (count <= 0) return formula;
  return mapOutsideStrings(formula, (part) =>
    part.replace(REF, (_m, pre, c1a, c1, r1a, r1s, c2a, c2, r2a, r2s) => {
      let r1 = Number(r1s);
      if (r1 > row) r1 += count;
      if (c2 === undefined) return `${pre}${c1a}${c1}${r1a}${r1}`;
      let r2 = Number(r2s);
      if (r2 >= row) r2 += count;
      return `${pre}${c1a}${c1}${r1a}${r1}:${c2a}${c2}${r2a}${r2}`;
    }),
  );
}

/** Verschiebt relative Zeilenbezüge (ohne $) um `delta` – wie beim Kopieren einer Zeile in Excel. */
export function shiftRelativeRows(formula: string, delta: number): string {
  if (delta === 0) return formula;
  return mapOutsideStrings(formula, (part) =>
    part.replace(REF, (_m, pre, c1a, c1, r1a, r1s, c2a, c2, r2a, r2s) => {
      const r1 = r1a ? Number(r1s) : Number(r1s) + delta;
      if (c2 === undefined) return `${pre}${c1a}${c1}${r1a}${r1}`;
      const r2 = r2a ? Number(r2s) : Number(r2s) + delta;
      return `${pre}${c1a}${c1}${r1a}${r1}:${c2a}${c2}${r2a}${r2}`;
    }),
  );
}
