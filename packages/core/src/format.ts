const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** 1234.5 → "1.234,50" */
export function fmt2(v: number): string {
  return nf2.format(normZero(v));
}

export function fmt3(v: number): string {
  return nf3.format(normZero(v));
}

/** Zahl ohne Tausendertrennzeichen mit Dezimalkomma (für CSV/Excel). */
export function fmtPlain(v: number, digits = 2): string {
  return normZero(v).toFixed(digits).replace('.', ',');
}

export function fmtPercent(f: number): string {
  return `${Math.round(f * 100)} %`;
}

function normZero(v: number) {
  return Math.abs(v) < 5e-7 ? 0 : v;
}

/** Akzeptiert "3,25", "3.25", " 3 " → 3.25; ungültig → null. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || t === '-' || t === '.') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
