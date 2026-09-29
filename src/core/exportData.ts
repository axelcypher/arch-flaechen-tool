import type { AreaTotals, ProjectResult } from './calc';
import { polygonArea } from './geometry';
import type { Project } from './model';
import { anschriftEinzeilig, flurText, istDachgeschoss, plzOrt } from './model';
import { NUF_IDS, NUTZUNGSGRUPPEN, nutzungInfo, WOFL_KATEGORIEN } from './norms';
import { briKoerper, briRechenweg } from './rechenweg';

/**
 * Datengrundlage für Excel-Export und Vorlagen (Syntax siehe docs/excel-vorlagen.md).
 *
 *   {{projekt.name}}              Einzelwert
 *   {{summe.bgf}}                 Projektsumme
 *   {{geschoss:EG.bgf}}           Wert eines bestimmten Geschosses (über den Namen)
 *   {{raum.flaeche}}              Zeile wird je Raum wiederholt (ebenso geschoss, wohnung, nutzung, bri)
 *   {{raum[wofl].name}}           mit Filter (hier: nur Räume mit Wohnflächenanrechnung)
 *   {{#geschoss}} … {{/geschoss}} Zeilenblock je Geschoss; raum-/bri-Zeilen darin nur für dieses Geschoss
 *   {{geschoss.name|einmal}}      nur in der ersten Zeile der jeweiligen Wiederholung
 */

export type Value = string | number;
/** Datensatz; Schlüssel mit „_“ sind intern (Zuordnung in Blöcken) */
export type Row = Record<string, Value>;

export const COLLECTIONS = ['geschoss', 'raum', 'wohnung', 'nutzung', 'bri', 'koerper'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export interface ExportContext {
  scalars: Record<string, Value>;
  collections: Record<Collection, Row[]>;
  /** zum Nachschlagen einzelner Geschosse/Wohnungen per Name */
  byName: { geschoss: Map<string, Row>; wohnung: Map<string, Row> };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

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

/** alle Kontakte einer Art, mit Komma getrennt */
function kontakte(project: Project, art: 'email' | 'telefon'): string {
  return project.meta.bauherr.kontakte
    .filter((k) => k.art === art && k.wert.trim())
    .map((k) => k.wert.trim())
    .join(', ');
}

export function buildExportContext(project: Project, result: ProjectResult, date = new Date()): ExportContext {
  const scalars: Record<string, Value> = {
    'projekt.name': project.name,
    'projekt.code': project.meta.projektcode,
    'projekt.projektcode': project.meta.projektcode,
    'projekt.adresse': anschriftEinzeilig(project.meta.adresse),
    'projekt.strasse': project.meta.adresse.strasse,
    'projekt.plz': project.meta.adresse.plz,
    'projekt.ort': project.meta.adresse.ort,
    'projekt.plz_ort': plzOrt(project.meta.adresse),
    'projekt.bearbeiter': project.meta.bearbeiter,
    'grundstueck.gemarkung': project.meta.grundstueck.gemarkung,
    'grundstueck.flur': project.meta.grundstueck.flur,
    'grundstueck.flurstueck': project.meta.grundstueck.flurstueck,
    'grundstueck.flurtext': flurText(project.meta.grundstueck),
    'grundstueck.flaeche': project.meta.grundstueck.flaeche ?? '',
    'bauherr.name': project.meta.bauherr.name,
    'bauherr.adresse': anschriftEinzeilig(project.meta.bauherr.adresse),
    'bauherr.strasse': project.meta.bauherr.adresse.strasse,
    'bauherr.plz': project.meta.bauherr.adresse.plz,
    'bauherr.ort': project.meta.bauherr.adresse.ort,
    'bauherr.plz_ort': plzOrt(project.meta.bauherr.adresse),
    'bauherr.email': kontakte(project, 'email'),
    'bauherr.telefon': kontakte(project, 'telefon'),
    datum: date.toLocaleDateString('de-DE'),
  };

  const shapesById = new Map(project.storeys.flatMap((st) => st.shapes.map((sh) => [sh.id, sh] as const)));
  // Geschossart: „ja“ bei Dachgeschossen – für Filter [dg] / [normal] in allen Sammlungen
  const dg = new Map(project.storeys.map((st) => [st.id, istDachgeschoss(st) ? 'ja' : ''] as const));
  let nr = 0;
  const raum: Row[] = result.storeys.flatMap((s) =>
    s.rooms.map((r) => {
      const sh = shapesById.get(r.shapeId);
      const roh = (sh ? polygonArea(sh.points) : Math.abs(r.area)) * (r.subtract ? -1 : 1);
      const wofl = r.woflKategorie !== 'keine';
      return {
        _geschossId: s.storeyId,
        nr: ++nr,
        geschoss: r.storeyName,
        dachgeschoss: dg.get(s.storeyId) ?? '',
        nummer: r.nummer,
        name: r.name,
        nutzung: nutzungInfo(r.nutzung).kurz,
        nutzung_text: nutzungInfo(r.nutzung).label,
        umschliessung: r.umschliessung,
        flaeche: r2(r.area),
        flaeche_roh: r2(roh),
        putzabzug: sh?.kind === 'room' && sh.putzabzug ? sh.putzabzug : '',
        wohnflaeche: wofl ? 'ja' : '',
        wofl_kategorie: wofl ? (WOFL_KATEGORIEN.find((k) => k.id === r.woflKategorie)?.label ?? '') : '',
        wofl_faktor: wofl ? r2(r.woflFaktor) : '',
        wofl: wofl ? r2(r.woflArea) : '',
        wofl_roh: wofl ? r2(roh * r.woflFaktor) : '',
        wohnung: r.wohnung,
        abzug: r.subtract ? 'Abzug' : '',
        bemerkung: sh?.bemerkung ?? '',
      };
    }),
  );

  const sumBy = (rows: Row[], key: string) => r2(rows.reduce((a, x) => a + (typeof x[key] === 'number' ? (x[key] as number) : 0), 0));

  const geschoss: Row[] = result.storeys.map((s, i) => {
    const rooms = raum.filter((r) => r._geschossId === s.storeyId);
    return {
      _id: s.storeyId,
      nr: i + 1,
      name: s.name,
      dachgeschoss: dg.get(s.storeyId) ?? '',
      art: dg.get(s.storeyId) ? 'Dachgeschoss' : 'Normalgeschoss',
      hoehe: r2(s.hoehe),
      anzahl_raeume: s.rooms.length,
      ...totalsRow(s),
      wofl_roh: sumBy(rooms, 'wofl_roh'),
      nebenflaeche: sumBy(rooms.filter((r) => !r.wohnflaeche), 'flaeche'),
    };
  });

  const sum = totalsRow(result.total);
  sum.anzahl_raeume = raum.length;
  sum.wofl_roh = sumBy(raum, 'wofl_roh');
  sum.nebenflaeche = sumBy(raum.filter((r) => !r.wohnflaeche), 'flaeche');
  for (const [k, v] of Object.entries(sum)) scalars[`summe.${k}`] = v;

  const wohnung: Row[] = result.wohnungen.map((w, i) => ({
    nr: i + 1,
    name: w.wohnung,
    anzahl_raeume: w.rooms.length,
    grundflaeche: r2(w.grundflaeche),
    wofl: r2(w.wofl),
  }));

  const nutzung: Row[] = NUTZUNGSGRUPPEN.map((n) => ({ gruppe: n.kurz, bezeichnung: n.label, flaeche: r2(result.total.nutzung[n.id]) }));

  const bri: Row[] = briRechenweg(project).map((b) => ({
    _geschossId: b.geschossId,
    geschoss: b.geschoss,
    dachgeschoss: dg.get(b.geschossId) ?? '',
    umriss: b.umriss,
    umschliessung: b.umschliessung,
    nr: b.nr,
    bezeichnung: b.bezeichnung,
    anzahl: b.anzahl,
    laenge: b.laenge !== undefined ? r3(b.laenge) : '',
    breite: b.breite !== undefined ? r3(b.breite) : '',
    flaeche: r3(b.flaeche),
    hoehe: r3(b.hoehe),
    faktor: r6(b.faktor),
    volumen: r2(b.volumen),
    formel: b.formel,
  }));

  const koerper: Row[] = briKoerper(project).map((k) => ({
    _geschossId: k.geschossId,
    geschoss: k.geschoss,
    dachgeschoss: dg.get(k.geschossId) ?? '',
    umriss: k.umriss,
    umschliessung: k.umschliessung,
    nr: k.nr,
    art: k.art === 'dach' ? 'Dach' : k.art === 'gaube' ? 'Gaube' : 'Grundkörper',
    bezeichnung: k.bezeichnung,
    parameter: k.parameter,
    formel: k.formel,
    rechnung: k.rechnung,
    flaeche: r2(k.flaeche),
    hoehe: r3(k.hoehe),
    laenge: k.laenge !== undefined ? r3(k.laenge) : '',
    breite: k.breite !== undefined ? r3(k.breite) : '',
    neigung: k.neigung !== undefined ? r2(k.neigung) : '',
    volumen: r2(k.volumen),
  }));

  return {
    scalars,
    collections: { geschoss, raum, wohnung, nutzung, bri, koerper },
    byName: {
      geschoss: new Map(geschoss.map((g) => [String(g.name), g])),
      wohnung: new Map(wohnung.map((w) => [String(w.name), w])),
    },
  };
}

/** Beschreibung aller Platzhalter – Grundlage für Hilfe-Tabelle und Musterdatei. */
export const PLACEHOLDER_DOCS: { group: string; keys: [string, string][] }[] = [
  {
    group: 'Blöcke, Filter, Modifikatoren',
    keys: [
      ['#geschoss … /geschoss', 'Zeilenblock je Geschoss (Markierung in eigener Zeile oder in der ersten/letzten Blockzeile); ebenso #wohnung, #nutzung, #raum, #koerper'],
      ['raum-/bri-/koerper-Zeilen im Block', 'laufen nur über die Räume bzw. Körper des aktuellen Geschosses; leere Blöcke entfallen'],
      ['raum[wofl] / raum[nebenflaeche]', 'Filter: Räume mit bzw. ohne Wohnflächenanrechnung'],
      ['raum[hnf] / raum[nnf] / [nuf] [tf] [vf]', 'Filter nach Nutzungsgruppe (HNF = NUF 1–6, NNF = NUF 7)'],
      ['geschoss[dg] / geschoss[normal]', 'Filter: Dachgeschosse bzw. Normalgeschosse (gilt ebenso für raum, bri, koerper)'],
      ['koerper[dach] / [gaube] / [grundkoerper]', 'Filter: Dachkörper, Gauben bzw. Grundkörper (Quader)'],
      ['[r] [s] [abzug] [feld=wert] [!filter]', 'weitere Filter, mehrere mit Komma: raum[wofl,geschoss=EG]'],
      ['…|einmal', 'Wert nur in der ersten Zeile der Wiederholung, z. B. geschoss.name|einmal'],
    ],
  },
  {
    group: 'projekt / grundstueck / bauherr / datum',
    keys: [
      ['projekt.name', 'Projektbezeichnung'],
      ['projekt.code', 'Projektcode (auch projekt.projektcode)'],
      ['projekt.adresse', 'Adresse in einer Zeile: „Straße Nr., PLZ Ort“'],
      ['projekt.strasse, projekt.plz, projekt.ort, projekt.plz_ort', 'Adresse in Teilen'],
      ['projekt.bearbeiter', 'Bearbeiter'],
      ['grundstueck.gemarkung, grundstueck.flur, grundstueck.flurstueck', 'Grundstücksdaten'],
      ['grundstueck.flurtext', '„Gemarkung …, Flur …, Flurstück …“'],
      ['grundstueck.flaeche', 'Grundstücksfläche [m²]'],
      ['bauherr.name', 'Name des Bauherrn'],
      ['bauherr.adresse, bauherr.strasse, bauherr.plz, bauherr.ort, bauherr.plz_ort', 'Adresse des Bauherrn'],
      ['bauherr.email, bauherr.telefon', 'alle E-Mail-Adressen bzw. Telefonnummern, mit Komma getrennt'],
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
      ['wofl, wofl_roh', 'Wohnfläche nach WoFlV [m²] mit bzw. ohne Putzabzug der Räume'],
      ['nebenflaeche', 'Summe der Räume ohne Wohnflächenanrechnung [m²]'],
      ['anzahl_raeume', 'Anzahl Räume'],
      ['name, hoehe, nr', 'nur geschoss.*: Bezeichnung, Geschosshöhe, laufende Nr.'],
      ['dachgeschoss, art', 'nur geschoss.*: „ja“ bei Dachgeschossen; „Dachgeschoss“ bzw. „Normalgeschoss“'],
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
      ['raum.flaeche', 'Grundfläche [m²] abzüglich Putzabzug (Abzugsflächen negativ)'],
      ['raum.flaeche_roh', 'Grundfläche ohne Putzabzug [m²]'],
      ['raum.putzabzug', 'Putzabzug in %'],
      ['raum.wohnflaeche', '„ja“, wenn auf die Wohnfläche angerechnet'],
      ['raum.wofl_kategorie', 'Anrechnung nach WoFlV'],
      ['raum.wofl_faktor', 'Anrechnungsfaktor'],
      ['raum.wofl', 'anrechenbare Wohnfläche [m²]'],
      ['raum.wofl_roh', 'anrechenbare Wohnfläche ohne Putzabzug [m²] – wenn der Abzug in Excel gerechnet wird'],
      ['raum.wohnung', 'Wohnungszuordnung'],
      ['raum.abzug', '„Abzug“ bei Abzugsflächen, sonst leer'],
      ['raum.bemerkung', 'Bemerkung'],
    ],
  },
  {
    group: 'bri.* (Rechenweg Brutto-Rauminhalt, Zeile je Teilkörper)',
    keys: [
      ['bri.geschoss, bri.umriss, bri.nr', 'Geschoss, BGF-Umriss, laufende Nummer im Geschoss'],
      ['bri.bezeichnung', 'Teilkörper, z. B. „Satteldach: Dreiecksprisma“'],
      ['bri.anzahl', 'Anzahl gleicher Teilkörper (negativ bei Abzügen)'],
      ['bri.laenge, bri.breite', 'Länge (in Firstrichtung) und Breite – bei rechteckigen Grundflächen'],
      ['bri.flaeche', 'Grundfläche des Teilkörpers [m²]'],
      ['bri.hoehe', 'Höhe [m]'],
      ['bri.faktor', 'Formfaktor (1 Quader, 0,5 Prisma/Keil, 0,333 Pyramide …)'],
      ['bri.volumen', 'anzahl × flaeche × hoehe × faktor [m³]'],
      ['bri.formel', 'Rechenweg als Text, z. B. „12,00 × 9,00 × 3,151 × ½“'],
    ],
  },
  {
    group: 'koerper.* (BRI mit geschlossenen Formeln, Zeile je Körper – Normalgeschosse Höhe × BGF, Dächer als ganzer Körper)',
    keys: [
      ['koerper.geschoss, koerper.umriss, koerper.nr', 'Geschoss, BGF-Umriss, laufende Nummer im Geschoss'],
      ['koerper.art', '„Grundkörper“ (Quader bis Geschosshöhe bzw. Traufe), „Dach“ oder „Gaube“'],
      ['koerper.bezeichnung', 'z. B. „Quader“, „Grundkörper bis Traufe“, „Walmdach“, „Schleppgaube“'],
      ['koerper.parameter', 'Maße als Text, z. B. „H: 5,375 m; B: 10,75 m; L: 12,00 m“'],
      ['koerper.formel', 'Formel mit Formelzeichen, z. B. „B × H × (3 × L − B) / 6“'],
      ['koerper.rechnung', 'Formel mit eingesetzten Werten, z. B. „10,75 × 5,38 × (3 × 12 − 10,75) / 6“'],
      ['koerper.flaeche', 'Grundfläche [m²] (negativ bei Abzugsflächen)'],
      ['koerper.hoehe', 'Höhe [m]: Grundkörper = Geschoss-/Traufhöhe, Dach = Höhe über Traufe, Gaube = Höhe der Vorderwand über der Dachfläche'],
      ['koerper.laenge, koerper.breite, koerper.neigung', 'Länge (Firstrichtung) bzw. Gaubenbreite, Breite bzw. Gaubentiefe [m], Dach-/Gaubenneigung [°]'],
      ['koerper.volumen', 'Volumen [m³]; Summe aller Körper = BRI'],
      ['koerper.dachgeschoss', '„ja“, wenn der Körper in einem Dachgeschoss liegt'],
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

/* ---------- Filter ---------- */

const NUF_HNF = new Set(['NUF 1', 'NUF 2', 'NUF 3', 'NUF 4', 'NUF 5', 'NUF 6']);

/** vordefinierte Filter; sonst „feld=wert“ */
const NAMED_FILTERS: Record<string, (r: Row) => boolean> = {
  wofl: (r) => r.wohnflaeche === 'ja',
  wohnflaeche: (r) => r.wohnflaeche === 'ja',
  'wohnfläche': (r) => r.wohnflaeche === 'ja',
  nebenflaeche: (r) => r.wohnflaeche !== 'ja',
  'nebenfläche': (r) => r.wohnflaeche !== 'ja',
  nuf: (r) => String(r.nutzung).startsWith('NUF'),
  tf: (r) => String(r.nutzung).startsWith('TF'),
  vf: (r) => String(r.nutzung).startsWith('VF'),
  hnf: (r) => NUF_HNF.has(String(r.nutzung)),
  nnf: (r) => r.nutzung === 'NUF 7',
  r: (r) => r.umschliessung === 'R',
  s: (r) => r.umschliessung === 'S',
  abzug: (r) => r.abzug === 'Abzug',
  dg: (r) => r.dachgeschoss === 'ja',
  dachgeschoss: (r) => r.dachgeschoss === 'ja',
  normal: (r) => r.dachgeschoss !== 'ja',
  normalgeschoss: (r) => r.dachgeschoss !== 'ja',
  dach: (r) => r.art === 'Dach',
  gaube: (r) => r.art === 'Gaube',
  gauben: (r) => r.art === 'Gaube',
  grundkoerper: (r) => r.art === 'Grundkörper',
  'grundkörper': (r) => r.art === 'Grundkörper',
};

export function parseFilters(spec: string | undefined): ((r: Row) => boolean)[] {
  if (!spec) return [];
  return spec
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => {
      const neg = f.startsWith('!');
      const name = neg ? f.slice(1).trim() : f;
      let fn: (r: Row) => boolean;
      const eq = /^([a-z0-9_]+)\s*(!?=)\s*(.*)$/i.exec(name);
      if (eq) {
        const [, k, op, v] = eq;
        const want = v.trim().toLowerCase();
        fn = (r) => (String(r[k] ?? '').trim().toLowerCase() === want) === (op === '=');
      } else fn = NAMED_FILTERS[name.toLowerCase()] ?? (() => true);
      return neg ? (r: Row) => !fn(r) : fn;
    });
}

/** Wie hängen Sammlungen in Blöcken zusammen? (Kind-Datensatz passt zum gebundenen Eltern-Datensatz) */
export function belongsTo(child: Collection, row: Row, parent: Collection, p: Row, ctx: ExportContext): boolean {
  if (child === parent) return row === p;
  if (parent === 'geschoss') {
    if (child === 'raum' || child === 'bri' || child === 'koerper') return row._geschossId === p._id;
    if (child === 'wohnung') return ctx.collections.raum.some((r) => r._geschossId === p._id && r.wohnung === row.name);
  }
  if (parent === 'wohnung') {
    if (child === 'raum') return row.wohnung === p.name;
    if (child === 'geschoss') return ctx.collections.raum.some((r) => r._geschossId === row._id && r.wohnung === p.name);
  }
  if (parent === 'nutzung' && child === 'raum') return row.nutzung === p.gruppe;
  if ((parent === 'raum' || parent === 'bri' || parent === 'koerper') && child === 'geschoss') return row._id === p._geschossId;
  return true;
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
