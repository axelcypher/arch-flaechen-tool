import { projektWerte } from '@core/excel/projekt';
import type { ExportContext, Row, Value } from '@core/excel/context';
import type { Anschrift, Bauherr, Grundstueck, Kontakt, Project } from '@core/model';
import { createProject, leereAnschrift } from '@core/model';
import { sichererName } from './struktur';

/**
 * Stammdaten eines Projekts – die zentrale Quelle für Ordnername, Vorlagen und projekt.json.
 * Adresse, Grundstück und Bauherr haben dieselbe Form wie im Flächenrechner, damit die leere
 * Flächenrechner-Datei gleich die richtigen Projektdaten trägt.
 */

export interface Beteiligter {
  /** z. B. Tragwerksplanung, Vermessung, Bauamt */
  rolle: string;
  name: string;
  kontakt: string;
}

export interface Stammdaten {
  nummer: string;
  kurzname: string;
  /** ausführliche Bezeichnung des Vorhabens */
  bezeichnung: string;
  adresse: Anschrift;
  grundstueck: Grundstueck;
  bauherr: Bauherr;
  bearbeiter: string;
  /** beauftragte Leistungsphasen (1–9); leer = nicht festgelegt */
  leistungsphasen: number[];
  beteiligte: Beteiligter[];
}

export const LEISTUNGSPHASEN: { nr: number; label: string }[] = [
  { nr: 1, label: 'Grundlagenermittlung' },
  { nr: 2, label: 'Vorplanung' },
  { nr: 3, label: 'Entwurfsplanung' },
  { nr: 4, label: 'Genehmigungsplanung' },
  { nr: 5, label: 'Ausführungsplanung' },
  { nr: 6, label: 'Vorbereitung der Vergabe' },
  { nr: 7, label: 'Mitwirkung bei der Vergabe' },
  { nr: 8, label: 'Objektüberwachung' },
  { nr: 9, label: 'Objektbetreuung' },
];

export function leereStammdaten(): Stammdaten {
  return {
    nummer: '',
    kurzname: '',
    bezeichnung: '',
    adresse: leereAnschrift(),
    grundstueck: { gemarkung: '', flur: '', flurstueck: '' },
    bauherr: { name: '', adresse: leereAnschrift(), kontakte: [] },
    bearbeiter: '',
    leistungsphasen: [],
    beteiligte: [],
  };
}

/* ---------- projekt.json ---------- */

export const PROJEKT_DATEI = 'projekt.json';
export const PROJEKT_FORMAT = 'projektordner';

export interface ProjektDatei extends Stammdaten {
  format: typeof PROJEKT_FORMAT;
  version: 1;
  /** ISO-Datum JJJJ-MM-TT */
  angelegt: string;
  /** Name der Struktur, nach der der Ordner angelegt wurde */
  struktur: string;
  dateischema: string;
}

export const isoDatum = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function projektJson(s: Stammdaten, struktur: { name: string; dateischema: string }, date = new Date()): string {
  const datei: ProjektDatei = { format: PROJEKT_FORMAT, version: 1, ...bereinigt(s), angelegt: isoDatum(date), struktur: struktur.name, dateischema: struktur.dateischema };
  return `${JSON.stringify(datei, null, 2)}\n`;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const anschrift = (v: unknown): Anschrift => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { strasse: str(o.strasse), plz: str(o.plz), ort: str(o.ort) };
};

/** Liest eine projekt.json; wirft bei fremden oder kaputten Dateien */
export function leseProjektJson(json: string): ProjektDatei {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`kein gültiges JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!o || typeof o !== 'object' || o.format !== PROJEKT_FORMAT) throw new Error('keine Projektdatei dieses Tools (Feld „format“ fehlt)');
  const g = (o.grundstueck && typeof o.grundstueck === 'object' ? o.grundstueck : {}) as Record<string, unknown>;
  const b = (o.bauherr && typeof o.bauherr === 'object' ? o.bauherr : {}) as Record<string, unknown>;
  return {
    format: PROJEKT_FORMAT,
    version: 1,
    nummer: str(o.nummer),
    kurzname: str(o.kurzname),
    bezeichnung: str(o.bezeichnung),
    adresse: anschrift(o.adresse),
    grundstueck: {
      gemarkung: str(g.gemarkung),
      flur: str(g.flur),
      flurstueck: str(g.flurstueck),
      ...(typeof g.flaeche === 'number' && Number.isFinite(g.flaeche) ? { flaeche: g.flaeche } : {}),
    },
    bauherr: {
      name: str(b.name),
      adresse: anschrift(b.adresse),
      kontakte: (Array.isArray(b.kontakte) ? b.kontakte : [])
        .filter((k): k is Kontakt => !!k && typeof k === 'object' && ((k as Kontakt).art === 'email' || (k as Kontakt).art === 'telefon') && typeof (k as Kontakt).wert === 'string')
        .map((k) => ({ art: k.art, wert: k.wert })),
    },
    bearbeiter: str(o.bearbeiter),
    leistungsphasen: (Array.isArray(o.leistungsphasen) ? o.leistungsphasen : []).filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 9),
    beteiligte: (Array.isArray(o.beteiligte) ? o.beteiligte : [])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({ rolle: str(x.rolle), name: str(x.name), kontakt: str(x.kontakt) })),
    angelegt: str(o.angelegt),
    struktur: str(o.struktur),
    dateischema: str(o.dateischema),
  };
}

/** Stammdaten ohne Leerzeichen an den Rändern und ohne leere Zeilen */
export function bereinigt(s: Stammdaten): Stammdaten {
  const t = (v: string) => v.trim();
  const a = (x: Anschrift): Anschrift => ({ strasse: t(x.strasse), plz: t(x.plz), ort: t(x.ort) });
  return {
    nummer: t(s.nummer),
    kurzname: sichererName(s.kurzname),
    bezeichnung: t(s.bezeichnung),
    adresse: a(s.adresse),
    grundstueck: { gemarkung: t(s.grundstueck.gemarkung), flur: t(s.grundstueck.flur), flurstueck: t(s.grundstueck.flurstueck), ...(s.grundstueck.flaeche !== undefined ? { flaeche: s.grundstueck.flaeche } : {}) },
    bauherr: { name: t(s.bauherr.name), adresse: a(s.bauherr.adresse), kontakte: s.bauherr.kontakte.map((k) => ({ art: k.art, wert: t(k.wert) })).filter((k) => k.wert) },
    bearbeiter: t(s.bearbeiter),
    leistungsphasen: [...new Set(s.leistungsphasen)].sort(),
    beteiligte: s.beteiligte.map((b) => ({ rolle: t(b.rolle), name: t(b.name), kontakt: t(b.kontakt) })).filter((b) => b.rolle || b.name || b.kontakt),
  };
}

/* ---------- Übergabe an die anderen Werkzeuge ---------- */

/** Projekt im gemeinsamen Format (.oap) mit den Stammdaten – als leere Flächenberechnung */
export function alsProject(s: Stammdaten): Project {
  const p = createProject(s.bezeichnung || s.kurzname || s.nummer || 'Neues Projekt');
  p.meta = { projektcode: s.nummer, adresse: { ...s.adresse }, grundstueck: { ...s.grundstueck }, bauherr: { ...s.bauherr, adresse: { ...s.bauherr.adresse }, kontakte: s.bauherr.kontakte.map((k) => ({ ...k })) }, bearbeiter: s.bearbeiter };
  return p;
}

/* ---------- Platzhalter ---------- */

/**
 * Werte für Platzhalter in Vorlagen. Die Projektangaben heißen wie in den Excel-Vorlagen der anderen Werkzeuge
 * ({{projekt.name}}, {{bauherr.name}} …), dazu kommen die Angaben dieses Tools.
 */
export function platzhalter(s: Stammdaten, ordner: string, date = new Date()): ExportContext {
  const scalars: Record<string, Value> = {
    ...projektWerte(alsProject(s), date),
    'projekt.nummer': s.nummer,
    'projekt.kurzname': s.kurzname,
    'projekt.bezeichnung': s.bezeichnung,
    'projekt.ordner': ordner,
    'projekt.leistungsphasen': s.leistungsphasen.join(', '),
    'datum.iso': isoDatum(date),
    jahr: date.getFullYear(),
    beteiligte: s.beteiligte.map((b) => [b.rolle && `${b.rolle}:`, b.name, b.kontakt && `(${b.kontakt})`].filter(Boolean).join(' ')).join('\n'),
    // kurze Namen für Datei- und Ordnernamen
    nummer: s.nummer,
    kurzname: s.kurzname,
  };
  const beteiligter: Row[] = s.beteiligte.map((b, i) => ({ nr: i + 1, rolle: b.rolle, name: b.name, kontakt: b.kontakt }));
  const lph: Row[] = LEISTUNGSPHASEN.filter((l) => s.leistungsphasen.includes(l.nr)).map((l) => ({ nr: l.nr, name: l.label }));
  return { scalars, collections: { beteiligter, lph } };
}
