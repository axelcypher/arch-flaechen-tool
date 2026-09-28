/**
 * Kleiner Formelrechner für die in Flächenberechnungen üblichen Excel-Formeln, damit exportierte
 * Dateien auch in Programmen ohne Neuberechnung (Vorschau, LibreOffice-Standardeinstellung) Ergebnisse
 * zeigen. Unterstützt: + − * / ^, Vergleiche, Klammern, Zellbezüge und Bereiche auf demselben Blatt,
 * SUM, ROUND, ROUNDUP, ROUNDDOWN, ABS, MIN, MAX, AVERAGE, COUNT, IF.
 * Unbekanntes (andere Blätter, weitere Funktionen) → kein Ergebnis (Excel rechnet beim Öffnen).
 */

export type EvalValue = number | string | boolean | null;

export class FormulaError extends Error {}

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; v: string } | { t: 'fn'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') {
          s += '"';
          j += 2;
        } else if (src[j] === '"') break;
        else s += src[j++];
      }
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const ref = /^\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/.exec(src.slice(i));
    if (ref && !/^[A-Z]+\(/.test(src.slice(i))) {
      out.push({ t: 'ref', v: ref[0].replace(/\$/g, '') });
      i += ref[0].length;
      continue;
    }
    const fn = /^[A-Z][A-Z0-9.]*(?=\()/i.exec(src.slice(i));
    if (fn) {
      out.push({ t: 'fn', v: fn[0].toUpperCase() });
      i += fn[0].length;
      continue;
    }
    const op = /^(<>|<=|>=|[-+*/^(),=<>&%])/.exec(src.slice(i));
    if (op) {
      out.push({ t: 'op', v: op[0] });
      i += op[0].length;
      continue;
    }
    throw new FormulaError(`Unbekanntes Zeichen: ${src.slice(i)}`);
  }
  return out;
}

export function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function expandRange(r: string): string[] {
  const [a, b] = r.split(':');
  if (!b) return [a];
  const pa = /^([A-Z]+)(\d+)$/.exec(a)!;
  const pb = /^([A-Z]+)(\d+)$/.exec(b)!;
  const c1 = Math.min(colToNum(pa[1]), colToNum(pb[1]));
  const c2 = Math.max(colToNum(pa[1]), colToNum(pb[1]));
  const r1 = Math.min(Number(pa[2]), Number(pb[2]));
  const r2 = Math.max(Number(pa[2]), Number(pb[2]));
  if ((c2 - c1 + 1) * (r2 - r1 + 1) > 200000) throw new FormulaError('Bereich zu groß');
  const out: string[] = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(`${numToCol(c)}${r}`);
  return out;
}

const num = (v: EvalValue): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new FormulaError('#WERT!');
  return n;
};

const round = (v: number, d: number, mode: 'n' | 'up' | 'down') => {
  const f = 10 ** d;
  const x = Math.abs(v) * f;
  const r = mode === 'n' ? Math.round(x + 1e-9) : mode === 'up' ? Math.ceil(x - 1e-9) : Math.floor(x + 1e-9);
  return (Math.sign(v) * r) / f;
};

/**
 * Wertet eine Formel aus. getCell liefert den Wert einer Zelle (bei Formeln rekursiv ausgewertet).
 */
export function evaluateFormula(formula: string, getCell: (addr: string) => EvalValue): EvalValue {
  const toks = tokenize(formula.replace(/^=/, ''));
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`„${v}“ erwartet`);
    p++;
  };

  // Argumente liefern Listen (für Bereiche)
  const argValues = (): EvalValue[] => {
    const t = peek();
    if (t?.t === 'ref' && t.v.includes(':') && (toks[p + 1]?.v === ',' || toks[p + 1]?.v === ')')) {
      p++;
      return expandRange(t.v).map(getCell);
    }
    return [comparison()];
  };

  const call = (name: string): EvalValue => {
    expect('(');
    const args: EvalValue[][] = [];
    if (!isOp(')')) {
      args.push(argValues());
      while (isOp(',')) {
        p++;
        args.push(argValues());
      }
    }
    expect(')');
    const flat = () => args.flat();
    const nums = () => flat().filter((v) => typeof v === 'number') as number[];
    switch (name) {
      case 'SUM':
        return nums().reduce((a, b) => a + b, 0);
      case 'MIN':
        return nums().length ? Math.min(...nums()) : 0;
      case 'MAX':
        return nums().length ? Math.max(...nums()) : 0;
      case 'AVERAGE': {
        const n = nums();
        if (!n.length) throw new FormulaError('#DIV/0!');
        return n.reduce((a, b) => a + b, 0) / n.length;
      }
      case 'COUNT':
        return nums().length;
      case 'ABS':
        return Math.abs(num(args[0][0]));
      case 'ROUND':
        return round(num(args[0][0]), num(args[1]?.[0] ?? 0), 'n');
      case 'ROUNDUP':
        return round(num(args[0][0]), num(args[1]?.[0] ?? 0), 'up');
      case 'ROUNDDOWN':
        return round(num(args[0][0]), num(args[1]?.[0] ?? 0), 'down');
      case 'IF': {
        const c = args[0][0];
        const truthy = typeof c === 'string' ? c !== '' : num(c) !== 0;
        return truthy ? (args[1]?.[0] ?? true) : (args[2]?.[0] ?? false);
      }
      default:
        throw new FormulaError(`Funktion ${name} nicht unterstützt`);
    }
  };

  const primary = (): EvalValue => {
    const t = toks[p++];
    if (!t) throw new FormulaError('Ausdruck erwartet');
    if (t.t === 'num') return t.v;
    if (t.t === 'str') return t.v;
    if (t.t === 'ref') {
      if (t.v.includes(':')) throw new FormulaError('Bereich nur in Funktionen');
      return getCell(t.v);
    }
    if (t.t === 'fn') return call(t.v);
    if (t.v === '(') {
      const v = comparison();
      expect(')');
      return v;
    }
    throw new FormulaError(`Unerwartet: ${t.v}`);
  };
  const postfix = (): EvalValue => {
    let v = primary();
    while (isOp('%')) {
      p++;
      v = num(v) / 100;
    }
    return v;
  };
  const power = (): EvalValue => {
    const v = postfix();
    if (isOp('^')) {
      p++;
      return num(v) ** num(unary());
    }
    return v;
  };
  const unary = (): EvalValue => {
    if (isOp('-')) {
      p++;
      return -num(unary());
    }
    if (isOp('+')) {
      p++;
      return num(unary());
    }
    return power();
  };
  const term = (): EvalValue => {
    let v = unary();
    while (isOp('*') || isOp('/')) {
      const op = toks[p++].v;
      const r = num(unary());
      if (op === '/' && r === 0) throw new FormulaError('#DIV/0!');
      v = op === '*' ? num(v) * r : num(v) / r;
    }
    return v;
  };
  const additive = (): EvalValue => {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      const r = num(term());
      v = op === '+' ? num(v) + r : num(v) - r;
    }
    return v;
  };
  const concat = (): EvalValue => {
    let v = additive();
    while (isOp('&')) {
      p++;
      v = `${v ?? ''}${additive() ?? ''}`;
    }
    return v;
  };
  function comparison(): EvalValue {
    let v = concat();
    const CMP = ['=', '<>', '<', '>', '<=', '>='];
    for (let t = peek(); t && t.t === 'op' && CMP.includes(t.v); t = peek()) {
      const op = String(toks[p++].v);
      const r = concat();
      const a = typeof v === 'string' || typeof r === 'string' ? String(v ?? '') : num(v);
      const b = typeof v === 'string' || typeof r === 'string' ? String(r ?? '') : num(r);
      v = op === '=' ? a === b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
    }
    return v;
  }

  const v = comparison();
  if (p !== toks.length) throw new FormulaError('Unerwartetes Ende');
  return v;
}

/**
 * Wertet alle Formeln eines Blatts aus. cells: Adresse → Wert oder { formula }.
 * Liefert Adresse → Ergebnis für alle berechenbaren Formeln.
 */
export function evaluateSheet(cells: Map<string, EvalValue | { formula: string }>): Map<string, EvalValue> {
  const results = new Map<string, EvalValue>();
  const failed = new Set<string>();
  const visiting = new Set<string>();
  const get = (addr: string): EvalValue => {
    const c = cells.get(addr);
    if (c === undefined) return null;
    if (c !== null && typeof c === 'object' && 'formula' in c) {
      if (results.has(addr)) return results.get(addr)!;
      if (failed.has(addr) || visiting.has(addr)) throw new FormulaError('nicht berechenbar');
      visiting.add(addr);
      try {
        const v = evaluateFormula(c.formula, get);
        results.set(addr, v);
        return v;
      } catch (e) {
        failed.add(addr);
        throw e;
      } finally {
        visiting.delete(addr);
      }
    }
    return c;
  };
  for (const [addr, c] of cells) {
    if (c !== null && typeof c === 'object' && 'formula' in c && !results.has(addr) && !failed.has(addr)) {
      try {
        get(addr);
      } catch {
        // bleibt ohne Ergebnis
      }
    }
  }
  return results;
}
