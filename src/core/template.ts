import type { Collection, ExportContext, Row, Value } from './exportData';
import { belongsTo, COLLECTIONS, parseFilters } from './exportData';

/**
 * Vorlagen-Engine für Tabellen (unabhängig von Excel-Bibliotheken).
 *
 * Eingabe: die Zeilen eines Tabellenblatts (Zellwerte, Formeln als { formula }).
 * Ausgabe: die erzeugten Zeilen; jede kennt ihre Vorlagenzeile (für Formatierung).
 *
 *  - {{#geschoss}} … {{/geschoss}} wiederholt den Zeilenblock je Datensatz (auch verschachtelt).
 *    Steht die Markierung allein in einer Zeile, entfällt diese Zeile in der Ausgabe.
 *  - Eine Zeile mit einem Platzhalter einer noch nicht gebundenen Sammlung ({{raum.name}}) wird je
 *    Datensatz wiederholt – innerhalb eines Blocks nur für die zugehörigen Datensätze.
 *  - Filter: {{raum[wofl].name}}; Modifikator |einmal: nur in der ersten Wiederholungszeile.
 *  - Blockinstanzen, deren Wiederholungszeilen leer bleiben, entfallen.
 *  - Formeln werden auf die erzeugten Zeilen umgeschrieben (siehe translateFormula).
 */

export type CellValue = string | number | boolean | Date | null | { formula: string } | { richText: { text: string }[] };

export interface TemplateRow {
  /** Zeilennummer in der Vorlage (1-basiert) */
  r: number;
  /** nur belegte Zellen: Spalte (1-basiert) → Wert */
  cells: Map<number, CellValue>;
}

export interface OutputRow {
  src: number;
  cells: Map<number, CellValue>;
}

/* ---------- Platzhalter ---------- */

const PH = () => /\{\{\s*([^{}]+?)\s*\}\}/g;
const BLOCK_START = /^#\s*([a-z]+)\s*(?:\[([^\]]*)\])?$/i;
const BLOCK_END = /^\/\s*([a-z]+)\s*$/i;

interface KeyInfo {
  coll?: Collection;
  filter?: string;
  field?: string;
  named?: { coll: 'geschoss' | 'wohnung'; name: string; field: string };
  scalar?: string;
  mod?: string;
}

function parseKey(raw: string): KeyInfo {
  let key = raw.trim();
  let mod: string | undefined;
  const pipe = key.lastIndexOf('|');
  if (pipe > 0 && !key.slice(pipe).includes(']')) {
    mod = key.slice(pipe + 1).trim().toLowerCase();
    key = key.slice(0, pipe).trim();
  }
  const named = /^(geschoss|wohnung):(.+)\.([a-z0-9_]+)$/i.exec(key);
  if (named) return { named: { coll: named[1].toLowerCase() as 'geschoss' | 'wohnung', name: named[2].trim(), field: named[3] }, mod };
  const m = /^([a-z]+)(?:\[([^\]]*)\])?\.([a-z0-9_]+)$/i.exec(key);
  if (m && (COLLECTIONS as readonly string[]).includes(m[1].toLowerCase())) return { coll: m[1].toLowerCase() as Collection, filter: m[2], field: m[3], mod };
  return { scalar: key, mod };
}

function cellText(v: CellValue | undefined): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('');
  return null;
}

type Bindings = Partial<Record<Collection, Row>>;

function lookup(k: KeyInfo, ctx: ExportContext, b: Bindings): Value | undefined {
  if (k.named) {
    const row = ctx.byName[k.named.coll].get(k.named.name);
    return row ? (row[k.named.field] ?? '') : '';
  }
  if (k.coll && k.field) {
    const row = b[k.coll];
    if (!row) return undefined;
    return k.field.startsWith('_') ? undefined : (row[k.field] ?? '');
  }
  if (k.scalar !== undefined && k.scalar in ctx.scalars) return ctx.scalars[k.scalar];
  return undefined;
}

/** Zellinhalt mit Platzhaltern auflösen; Einzelplatzhalter liefern den Rohwert (Zahl bleibt Zahl) */
function resolveCell(text: string, ctx: ExportContext, b: Bindings, firstOfRepeat: boolean): CellValue {
  const whole = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(text);
  if (whole) {
    const k = parseKey(whole[1]);
    if (k.mod === 'einmal' && !firstOfRepeat) return null;
    const v = lookup(k, ctx, b);
    if (v === undefined) return text;
    return v === '' ? null : v;
  }
  const out = text.replace(PH(), (m, key: string) => {
    const k = parseKey(key);
    if (k.mod === 'einmal' && !firstOfRepeat) return '';
    const v = lookup(k, ctx, b);
    if (v === undefined) return m;
    return typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 3 }) : v;
  });
  return out === '' ? null : out;
}

/* ---------- Blockstruktur ---------- */

interface BlockNode {
  kind: 'block';
  id: number;
  coll: Collection;
  filter?: string;
  children: Node[];
}
interface RowNode {
  kind: 'row';
  row: TemplateRow;
  /** Blöcke, in denen die Zeile liegt (außen → innen) */
  blocks: number[];
}
type Node = BlockNode | RowNode;

function parseStructure(rows: TemplateRow[]): { nodes: Node[]; blocksOfRow: Map<number, number[]> } {
  const root: Node[] = [];
  const stack: BlockNode[] = [];
  const blocksOfRow = new Map<number, number[]>();
  let nextId = 1;
  const current = () => (stack.length ? stack[stack.length - 1].children : root);

  for (const row of rows) {
    let start: { coll: Collection; filter?: string } | null = null;
    let end = false;
    let content = false;
    const cells = new Map(row.cells);
    for (const [col, v] of row.cells) {
      const t = cellText(v);
      if (t === null) {
        if (v !== null && v !== undefined) content = true;
        continue;
      }
      let rest = t;
      for (const m of t.matchAll(PH())) {
        const inner = m[1].trim();
        const s = BLOCK_START.exec(inner);
        const e = BLOCK_END.exec(inner);
        if (s && (COLLECTIONS as readonly string[]).includes(s[1].toLowerCase())) {
          start = { coll: s[1].toLowerCase() as Collection, filter: s[2] };
          rest = rest.replace(m[0], '');
        } else if (e && (COLLECTIONS as readonly string[]).includes(e[1].toLowerCase())) {
          end = true;
          rest = rest.replace(m[0], '');
        }
      }
      if (rest !== t) {
        if (rest.trim() === '') cells.delete(col);
        else cells.set(col, rest);
      }
      if (rest.trim() !== '') content = true;
    }
    if (start) {
      const b: BlockNode = { kind: 'block', id: nextId++, coll: start.coll, filter: start.filter, children: [] };
      current().push(b);
      stack.push(b);
    }
    // Zeilen, die nur aus einer Markierung bestehen, erscheinen nicht in der Ausgabe
    if (content || (!start && !end)) {
      const blocks = stack.map((b) => b.id);
      blocksOfRow.set(row.r, blocks);
      current().push({ kind: 'row', row: { r: row.r, cells }, blocks });
    }
    if (end && stack.length) stack.pop();
  }
  return { nodes: root, blocksOfRow };
}

/* ---------- Expansion ---------- */

interface OutMeta {
  src: number;
  /** Block-ID → Instanznummer */
  inst: Map<number, number>;
  bindings: Bindings;
  first: boolean;
  /** Wiederholungszeile ohne Datensatz (Platzhalter leeren) */
  empty?: boolean;
}

function rowRepeat(row: TemplateRow, bound: Bindings): { coll: Collection; filter?: string } | null {
  let coll: Collection | undefined;
  const filters = new Set<string>();
  for (const v of row.cells.values()) {
    const t = cellText(v);
    if (!t) continue;
    for (const m of t.matchAll(PH())) {
      const k = parseKey(m[1]);
      if (!k.coll || bound[k.coll]) continue;
      coll ??= k.coll;
      // alle Filter der Sammlung in dieser Zeile gelten gemeinsam (z. B. {{raum.nummer}} … {{raum[wofl].name}})
      if (k.coll === coll && k.filter) filters.add(k.filter);
    }
  }
  if (!coll) return null;
  return { coll, filter: filters.size ? [...filters].join(',') : undefined };
}

function itemsFor(coll: Collection, filter: string | undefined, bound: Bindings, ctx: ExportContext): Row[] {
  const preds = parseFilters(filter);
  return ctx.collections[coll].filter((row) => {
    for (const [pc, pr] of Object.entries(bound) as [Collection, Row][]) if (!belongsTo(coll, row, pc, pr, ctx)) return false;
    return preds.every((p) => p(row));
  });
}

export function expandTemplate(rows: TemplateRow[], ctx: ExportContext): OutputRow[] {
  const { nodes, blocksOfRow } = parseStructure(rows);
  const metas: OutMeta[] = [];

  // liefert: Anzahl Wiederholungszeilen und davon erzeugte Datensatzzeilen (für „leere Blöcke entfallen“)
  const expand = (list: Node[], bound: Bindings, inst: Map<number, number>, topLevel: boolean): { repeats: number; produced: number } => {
    let repeats = 0;
    let produced = 0;
    for (const n of list) {
      if (n.kind === 'row') {
        const rep = rowRepeat(n.row, bound);
        if (!rep) {
          metas.push({ src: n.row.r, inst, bindings: bound, first: true });
          continue;
        }
        repeats++;
        const items = itemsFor(rep.coll, rep.filter, bound, ctx);
        items.forEach((it, i) => metas.push({ src: n.row.r, inst, bindings: { ...bound, [rep.coll]: it }, first: i === 0 }));
        produced += items.length;
        // außerhalb von Blöcken bleibt eine leere Zeile stehen, damit das Layout erhalten bleibt
        if (!items.length && topLevel) metas.push({ src: n.row.r, inst, bindings: bound, first: true, empty: true });
      } else {
        const items = itemsFor(n.coll, n.filter, bound, ctx);
        items.forEach((it, i) => {
          const mark = metas.length;
          const childInst = new Map(inst);
          childInst.set(n.id, i);
          const r = expand(n.children, { ...bound, [n.coll]: it }, childInst, false);
          if (r.repeats > 0 && r.produced === 0) metas.length = mark; // leere Instanz verwerfen
          produced += r.produced;
          repeats += r.repeats;
        });
      }
    }
    return { repeats, produced };
  };
  expand(nodes, {}, new Map(), true);

  const tplByRow = new Map(rows.map((r) => [r.r, r]));
  // Vorlagenzeile → erzeugte Ausgabezeilen (1-basiert)
  const outBySrc = new Map<number, number[]>();
  metas.forEach((m, i) => {
    let arr = outBySrc.get(m.src);
    if (!arr) outBySrc.set(m.src, (arr = []));
    arr.push(i + 1);
  });

  return metas.map((m, i) => {
    const cells = new Map<number, CellValue>();
    const tpl = tplByRow.get(m.src);
    // Markierungen wurden in parseStructure entfernt – dortige Zellen verwenden
    const node = findRowNode(nodes, m.src);
    for (const [col, v] of (node?.row.cells ?? tpl?.cells ?? new Map()) as Map<number, CellValue>) {
      if (v && typeof v === 'object' && 'formula' in v) {
        cells.set(col, { formula: translateFormula(v.formula, i + 1, m, metas, outBySrc, blocksOfRow) });
        continue;
      }
      const t = cellText(v);
      if (t !== null && PH().test(t)) {
        cells.set(col, m.empty ? null : resolveCell(t, ctx, m.bindings, m.first));
        continue;
      }
      cells.set(col, v);
    }
    return { src: m.src, cells };
  });
}

function findRowNode(nodes: Node[], r: number): RowNode | undefined {
  for (const n of nodes) {
    if (n.kind === 'row' && n.row.r === r) return n;
    if (n.kind === 'block') {
      const f = findRowNode(n.children, r);
      if (f) return f;
    }
  }
  return undefined;
}

/* ---------- Formeln ---------- */

const REF = /(^|[^A-Za-z0-9_.!$'"])(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(])/g;

/**
 * Schreibt Zeilenbezüge einer Formel auf die erzeugten Zeilen um:
 *  - Bezug auf die eigene Vorlagenzeile → eigene Ausgabezeile
 *  - Bezug auf eine andere Zeile → deren Ausgabe im selben Block (gemeinsame Blöcke müssen übereinstimmen)
 *  - Bereiche → alle passenden Ausgabezeilen; zusammenhängend als A1:A9, sonst als Liste A3,A7,A11
 *    (z. B. SUMME über die Zwischensummen aller Geschossblöcke)
 *  - keine passende Zeile → 0
 */
function translateFormula(
  formula: string,
  selfRow: number,
  self: OutMeta,
  metas: OutMeta[],
  outBySrc: Map<number, number[]>,
  blocksOfRow: Map<number, number[]>,
): string {
  const selfBlocks = blocksOfRow.get(self.src) ?? [];
  const candidates = (tplRow: number): number[] => {
    if (tplRow === self.src) return [selfRow];
    const list = outBySrc.get(tplRow);
    if (!list) return [];
    const common = (blocksOfRow.get(tplRow) ?? []).filter((b) => selfBlocks.includes(b));
    return list.filter((o) => common.every((b) => metas[o - 1].inst.get(b) === self.inst.get(b)));
  };
  const hasTplRow = (r: number) => blocksOfRow.has(r);

  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(REF, (m, pre, c1a, c1, r1a, r1s, c2a, c2, r2a, r2s) => {
            const r1 = Number(r1s);
            if (c2 === undefined) {
              if (!hasTplRow(r1)) return m;
              const c = candidates(r1);
              return c.length ? `${pre}${c1a}${c1}${r1a}${c[0]}` : `${pre}0`;
            }
            const r2 = Number(r2s);
            const lo = Math.min(r1, r2);
            const hi = Math.max(r1, r2);
            let any = false;
            let mn = Infinity;
            let mx = -Infinity;
            for (let r = lo; r <= hi; r++) {
              if (!hasTplRow(r)) continue;
              any = true;
              for (const o of candidates(r)) {
                mn = Math.min(mn, o);
                mx = Math.max(mx, o);
              }
            }
            if (!any) return m;
            if (!Number.isFinite(mn)) return `${pre}0`;
            // nicht zusammenhängende Zeilen (z. B. Zwischensummen mehrerer Blöcke) als Liste, damit
            // dazwischenliegende Zeilen derselben Spalte nicht mitgezählt werden
            const rowsSet = new Set<number>();
            for (let r = lo; r <= hi; r++) if (hasTplRow(r)) for (const o of candidates(r)) rowsSet.add(o);
            const sorted = [...rowsSet].sort((a, b) => a - b);
            const runs: [number, number][] = [];
            for (const r of sorted) {
              const last = runs[runs.length - 1];
              if (last && r === last[1] + 1) last[1] = r;
              else runs.push([r, r]);
            }
            if (runs.length === 1) return `${pre}${c1a}${c1}${r1a}${mn}:${c2a}${c2}${r2a}${mx}`;
            return `${pre}${runs.map(([a, b]) => (a === b ? `${c1a}${c1}${r1a}${a}` : `${c1a}${c1}${r1a}${a}:${c2a}${c2}${r2a}${b}`)).join(',')}`;
          }),
    )
    .join('');
}
