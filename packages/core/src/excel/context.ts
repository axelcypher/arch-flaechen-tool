/**
 * Datengrundlage der Excel-Vorlagen – unabhängig von der App (Syntax siehe docs/excel-vorlagen.md).
 * Jede App baut ihren Kontext selbst: Einzelwerte, Sammlungen (Zeilen, die wiederholt werden),
 * Nachschlagen per Name ({{geschoss:EG.bgf}}), benannte Filter und die Zuordnung in Blöcken.
 */

export type Value = string | number;
/** Datensatz; Schlüssel mit „_“ sind intern (Zuordnung in Blöcken) */
export type Row = Record<string, Value>;

export interface ExportContext {
  scalars: Record<string, Value>;
  /** Sammlung → Datensätze; die Namen der Sammlungen sind zugleich die Präfixe der Platzhalter */
  collections: Record<string, Row[]>;
  /** zum Nachschlagen einzelner Datensätze per Name: {{geschoss:EG.bgf}} */
  byName?: Record<string, Map<string, Row>>;
  /** benannte Filter, z. B. raum[wofl]; sonst gilt „feld=wert“ */
  filters?: Record<string, (r: Row) => boolean>;
  /** Passt ein Kind-Datensatz zum gebundenen Eltern-Datensatz eines Blocks? (Vorgabe: ja) */
  belongsTo?: (child: string, row: Row, parent: string, p: Row, ctx: ExportContext) => boolean;
}

export const isCollection = (ctx: ExportContext, name: string) => Object.prototype.hasOwnProperty.call(ctx.collections, name);

export function belongsTo(child: string, row: Row, parent: string, p: Row, ctx: ExportContext): boolean {
  if (child === parent) return row === p;
  return ctx.belongsTo ? ctx.belongsTo(child, row, parent, p, ctx) : true;
}

export function parseFilters(spec: string | undefined, named: Record<string, (r: Row) => boolean> = {}): ((r: Row) => boolean)[] {
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
      } else fn = named[name.toLowerCase()] ?? (() => true);
      return neg ? (r: Row) => !fn(r) : fn;
    });
}

const PH_SOURCE = /\{\{\s*([^{}]+?)\s*\}\}/.source;
/** immer neue RegExp-Instanz: globale RegExps tragen lastIndex-Zustand zwischen Aufrufen */
const ph = () => new RegExp(PH_SOURCE, 'g');

/** Welche Sammlung wiederholt diese Zeile? (erste gefundene) */
export function repeatCollection(texts: string[], ctx: ExportContext): string | null {
  for (const t of texts) {
    for (const m of t.matchAll(ph())) {
      const key = m[1];
      for (const c of Object.keys(ctx.collections)) if (key.startsWith(`${c}.`)) return c;
    }
  }
  return null;
}

/** {{sammlung:Name.feld}} */
export function lookupNamed(key: string, ctx: ExportContext): Value | undefined {
  const named = /^([a-z]+):(.+)\.([a-z0-9_]+)$/i.exec(key);
  if (!named) return undefined;
  const map = ctx.byName?.[named[1].toLowerCase()];
  if (!map) return undefined;
  const row = map.get(named[2].trim());
  return row ? (row[named[3]] ?? '') : '';
}

function lookup(key: string, ctx: ExportContext, item?: { collection: string; row: Row }): Value | undefined {
  if (key in ctx.scalars) return ctx.scalars[key];
  if (item && key.startsWith(`${item.collection}.`)) return item.row[key.slice(item.collection.length + 1)];
  return lookupNamed(key, ctx);
}

/**
 * Ersetzt Platzhalter in einem Zellinhalt. Besteht die Zelle nur aus einem Platzhalter,
 * wird der Rohwert (z. B. Zahl) zurückgegeben, damit Excel damit rechnen kann.
 * Unbekannte Platzhalter bleiben sichtbar stehen, damit Tippfehler auffallen.
 */
export function resolveText(text: string, ctx: ExportContext, item?: { collection: string; row: Row }): Value {
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

/** Platzhalter-Dokumentation (Hilfe-Tabelle und Blatt „Platzhalter“ der Muster-Vorlage) */
export type PlaceholderDocs = { group: string; keys: [string, string][] }[];
