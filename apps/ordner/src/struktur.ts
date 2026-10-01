/**
 * Struktur: die bürospezifische Konfiguration – Ordnerbaum, Namensschemata, Ort der Vorlagen. Sie gehört
 * nicht ins Tool, sondern in eine austauschbare JSON-Datei; die eingebaute Vorgabe ist neutral gehalten.
 */

export interface OrdnerRegel {
  /** Pfad im Projektordner, mit „/“ getrennt */
  pfad: string;
  /** nur anlegen, wenn eine dieser Leistungsphasen beauftragt ist (leer = immer) */
  lph?: number[];
  /** Dateien in diesem Ordner (und darunter) sollen dem Dateinamenschema folgen */
  dateischema?: boolean;
}

export interface Struktur {
  name: string;
  /** Projektnummer, z. B. „{jahr}-{nr:3}“ → 2026-014 */
  nummernschema: string;
  /** Name des Projektordners, z. B. „{nummer} {kurzname}“ */
  ordnername: string;
  /** Dateinamenschema für Pläne, z. B. „{nummer}_{plannummer}_{index}_{titel}“ */
  dateischema: string;
  ordner: OrdnerRegel[];
  /** leere Flächenrechner-Datei (.oap) an diesem Pfad anlegen; leer = keine */
  flaechenprojekt: string;
}

export const STANDARD: Struktur = {
  name: 'Standard',
  nummernschema: '{jahr}-{nr:3}',
  ordnername: '{nummer} {kurzname}',
  dateischema: '{nummer}_{plannummer}_{index}_{titel}',
  flaechenprojekt: '03 Berechnungen/Flächen/{nummer} {kurzname}.oap',
  ordner: [
    { pfad: '00 Projekt' },
    { pfad: '01 Grundlagen/Bestand' },
    { pfad: '01 Grundlagen/Vermessung' },
    { pfad: '01 Grundlagen/Baugrund' },
    { pfad: '02 Pläne/Entwurf', dateischema: true },
    { pfad: '02 Pläne/Genehmigung', lph: [4], dateischema: true },
    { pfad: '02 Pläne/Ausführung', lph: [5], dateischema: true },
    { pfad: '02 Pläne/Fachplaner' },
    { pfad: '03 Berechnungen/Flächen' },
    { pfad: '03 Berechnungen/Kosten' },
    { pfad: '03 Berechnungen/Nachweise' },
    { pfad: '04 Schriftverkehr/Bauherr' },
    { pfad: '04 Schriftverkehr/Behörden' },
    { pfad: '04 Schriftverkehr/Fachplaner' },
    { pfad: '05 Protokolle' },
    { pfad: '06 Genehmigung', lph: [4] },
    { pfad: '07 Ausschreibung', lph: [6, 7] },
    { pfad: '08 Bauleitung/Mängel', lph: [8] },
    { pfad: '08 Bauleitung/Rechnungen', lph: [8] },
    { pfad: '09 Fotos' },
  ],
};

/** Pfad vereinheitlichen: „/“ als Trenner, keine leeren Teile, keine Leerzeichen an den Rändern */
export function normPfad(p: string): string {
  return p
    .split(/[\\/]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .join('/');
}

/** in Datei- und Ordnernamen unzulässige Zeichen (Windows) entfernen; keine Punkte/Leerzeichen am Ende */
export function sichererName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
}

/** „5-8“, „6, 7“ oder „4“ → Leistungsphasen */
function lphAus(text: string): number[] {
  const out = new Set<number>();
  for (const teil of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d)(?:\s*[-–]\s*(\d))?$/.exec(teil);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= 9) out.add(i);
  }
  return [...out].sort();
}

function lphText(lph: number[]): string {
  // zusammenhängende Phasen als Bereich
  const teile: string[] = [];
  for (let i = 0; i < lph.length; i++) {
    let j = i;
    while (j + 1 < lph.length && lph[j + 1] === lph[j] + 1) j++;
    teile.push(j > i ? `${lph[i]}-${lph[j]}` : String(lph[i]));
    i = j;
  }
  return teile.join(', ');
}

/**
 * Ordnerliste als Text – eine Zeile je Ordner, Zusätze mit „|“:
 *   02 Pläne/Ausführung | LPh 5 | Dateischema
 * Leerzeilen und Zeilen mit „#“ werden übergangen.
 */
export function ordnerAusText(text: string): OrdnerRegel[] {
  const out: OrdnerRegel[] = [];
  const gesehen = new Set<string>();
  for (const zeile of text.split(/\r?\n/)) {
    if (!zeile.trim() || zeile.trim().startsWith('#')) continue;
    const [roh, ...zusaetze] = zeile.split('|');
    const pfad = normPfad(roh).split('/').map(sichererName).filter(Boolean).join('/');
    if (!pfad || gesehen.has(pfad.toLowerCase())) continue;
    gesehen.add(pfad.toLowerCase());
    const regel: OrdnerRegel = { pfad };
    for (const z of zusaetze.map((x) => x.trim())) {
      const m = /^lph\.?\s*(.+)$/i.exec(z);
      if (m) {
        const lph = lphAus(m[1]);
        if (lph.length) regel.lph = lph;
      } else if (/^dateischema$/i.test(z)) regel.dateischema = true;
    }
    out.push(regel);
  }
  return out;
}

export function ordnerAlsText(ordner: OrdnerRegel[]): string {
  return ordner.map((o) => [o.pfad, o.lph?.length ? `LPh ${lphText(o.lph)}` : '', o.dateischema ? 'Dateischema' : ''].filter(Boolean).join(' | ')).join('\n');
}

const text = (v: unknown, vorgabe: string) => (typeof v === 'string' && v.trim() ? v.trim() : vorgabe);

/** Struktur aus einer Konfigurationsdatei; fehlende Angaben kommen aus der Vorgabe */
export function strukturAusJson(json: string): Struktur {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Die Konfiguration ist kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Die Konfiguration muss ein JSON-Objekt sein.');
  const liste = Array.isArray(o.ordner) ? o.ordner : null;
  const ordner: OrdnerRegel[] = [];
  for (const x of liste ?? []) {
    if (typeof x === 'string') ordner.push(...ordnerAusText(x));
    else if (x && typeof x === 'object' && typeof (x as OrdnerRegel).pfad === 'string') {
      const r = x as OrdnerRegel;
      const pfad = normPfad(r.pfad).split('/').map(sichererName).filter(Boolean).join('/');
      if (!pfad) continue;
      const lph = Array.isArray(r.lph) ? r.lph.filter((n) => Number.isInteger(n) && n >= 1 && n <= 9) : [];
      ordner.push({ pfad, ...(lph.length ? { lph } : {}), ...(r.dateischema === true ? { dateischema: true } : {}) });
    }
  }
  if (liste && !ordner.length) throw new Error('Die Konfiguration enthält keinen gültigen Ordner.');
  return {
    name: text(o.name, STANDARD.name),
    nummernschema: text(o.nummernschema, STANDARD.nummernschema),
    ordnername: text(o.ordnername, STANDARD.ordnername),
    dateischema: text(o.dateischema, STANDARD.dateischema),
    flaechenprojekt: typeof o.flaechenprojekt === 'string' ? normPfad(o.flaechenprojekt) : STANDARD.flaechenprojekt,
    ordner: liste ? ordner : STANDARD.ordner,
  };
}

export const strukturAlsJson = (s: Struktur) => `${JSON.stringify(s, null, 2)}\n`;

/** Gilt die Regel für ein Projekt mit diesen Leistungsphasen? Ohne Angabe von Phasen gelten alle Ordner. */
export const regelGilt = (r: OrdnerRegel, lph: number[]) => !r.lph?.length || !lph.length || r.lph.some((p) => lph.includes(p));
