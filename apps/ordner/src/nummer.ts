/**
 * Projektnummern und Namensschemata. Platzhalter in einfachen geschweiften Klammern:
 *   {jahr} 2026 · {jj} 26 · {nr} bzw. {nr:3} laufende Nummer (mit führenden Nullen)
 * Das Tool schlägt nur vor: die nächste freie Nummer nach den Ordnern im Stammordner. Vergeben wird sie
 * von dem, der das Projekt anlegt – das Feld bleibt frei änderbar.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN = /\{([a-zäöü_]+)(?::(\d+))?\}/gi;

/** Projektnummer nach Schema */
export function nummerAus(schema: string, nr: number, date = new Date()): string {
  return schema.replace(TOKEN, (m, name: string, breite?: string) => {
    const n = name.toLowerCase();
    if (n === 'jahr') return String(date.getFullYear());
    if (n === 'jj') return String(date.getFullYear() % 100).padStart(2, '0');
    if (n === 'nr') return String(nr).padStart(Number(breite ?? 1), '0');
    return m;
  });
}

/**
 * Nächste freie Nummer: höchste laufende Nummer unter den vorhandenen Ordnernamen (im laufenden Jahr, wenn
 * das Schema ein Jahr enthält) plus eins.
 */
export function naechsteNummer(schema: string, vorhandene: string[], date = new Date()): string {
  if (!/\{nr(?::\d+)?\}/i.test(schema)) return nummerAus(schema, 1, date);
  let muster = '';
  let pos = 0;
  for (const m of schema.matchAll(TOKEN)) {
    muster += escape(schema.slice(pos, m.index));
    const n = m[1].toLowerCase();
    if (n === 'jahr') muster += String(date.getFullYear());
    else if (n === 'jj') muster += String(date.getFullYear() % 100).padStart(2, '0');
    else if (n === 'nr') muster += '(\\d+)';
    else muster += escape(m[0]);
    pos = m.index + m[0].length;
  }
  muster += escape(schema.slice(pos));
  // der Ordnername beginnt mit der Nummer; danach darf keine weitere Ziffer folgen
  const re = new RegExp(`^${muster}(?!\\d)`);
  let max = 0;
  for (const name of vorhandene) {
    const m = re.exec(name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return nummerAus(schema, max + 1, date);
}

/** Platzhalter in Datei- und Ordnernamen: {nummer}, {kurzname} … (auch in doppelten Klammern) */
export function nameAus(schema: string, werte: Record<string, string | number>): string {
  return schema.replace(/\{\{?\s*([a-zäöü_.]+)\s*\}?\}/gi, (m, key: string) => {
    const v = werte[key] ?? werte[key.toLowerCase()];
    return v === undefined ? m : String(v);
  });
}

/**
 * Prüfmuster für Dateinamen (ohne Endung) aus dem Dateinamenschema. {nummer} muss der Projektnummer
 * entsprechen, wenn sie bekannt ist; die übrigen Teile sind frei, dürfen aber das Trennzeichen nicht enthalten.
 */
export function dateimuster(schema: string, nummer: string): RegExp {
  let muster = '';
  let pos = 0;
  const tokens = [...schema.matchAll(TOKEN)];
  tokens.forEach((m, i) => {
    const davor = schema.slice(pos, m.index);
    muster += escape(davor);
    const n = m[1].toLowerCase();
    const letzter = i === tokens.length - 1;
    // Zeichen, das auf diesen Teil folgt – der Teil selbst darf es nicht enthalten
    const danach = schema.slice(m.index + m[0].length)[0];
    const frei = danach && !letzter ? `[^${escape(danach)}]+` : '.+';
    if (n === 'nummer' || n === 'projekt') muster += nummer ? escape(nummer) : frei;
    else if (n === 'index') muster += '[A-Za-z0-9]{1,3}';
    else if (n === 'datum') muster += '(?:\\d{4}-\\d{2}-\\d{2}|\\d{6}|\\d{8})';
    else muster += frei;
    pos = m.index + m[0].length;
  });
  muster += escape(schema.slice(pos));
  return new RegExp(`^${muster}$`);
}
