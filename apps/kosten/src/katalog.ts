import type { KostenBezug, KostenPosition, KostenStufe } from '@core/model';
import { KOSTEN_BEZUEGE, newId } from '@core/model';
import { kgName, standardBezug } from './din276';
import { MENGEN_INFO } from './mengen';

/**
 * Kennwertkatalog: eigene, austauschbare Datei (JSON oder CSV) mit Quelle und Stand. Die Werte sind
 * Eingaben des Büros (eigene Projekte, Kennwertsammlungen, Literatur) – das Tool rechnet nur transparent damit.
 * Der zuletzt geladene Katalog bleibt im Browser hinterlegt; übernommene Kennwerte stehen im Projekt.
 */

export interface KatalogEintrag {
  kg: string;
  bezeichnung: string;
  bezug: KostenBezug;
  einheit?: string;
  basis?: string[];
  von?: number;
  mittel?: number;
  bis?: number;
  bemerkung?: string;
}

export interface Katalog {
  name: string;
  quelle?: string;
  /** Preisstand, z. B. „1. Quartal 2026“ */
  stand?: string;
  /** Baupreisindex zum Preisstand der Kennwerte */
  index?: number;
  eintraege: KatalogEintrag[];
}

const KEY = 'kostenermittlung:katalog';

export function gespeicherterKatalog(): Katalog | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? leseJson(raw) : null;
  } catch {
    return null;
  }
}

export function katalogSpeichern(k: Katalog | null): boolean {
  try {
    if (k) localStorage.setItem(KEY, JSON.stringify(k));
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Lesen ---------- */

const zahl = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const n = Number(v.trim().replace(/\s|€|%/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Bezug aus Kürzel (BGF, AWF, psch, %) oder interner Bezeichnung; sonst eigene Menge mit dieser Einheit */
function bezugAus(text: string, kg: string): { bezug: KostenBezug; einheit?: string } {
  const t = text.trim();
  if (!t) return { bezug: standardBezug(kg).bezug };
  const l = t.toLowerCase();
  if (KOSTEN_BEZUEGE.includes(l as KostenBezug)) return { bezug: l as KostenBezug };
  if (l === '%' || l === 'prozent') return { bezug: 'prozent' };
  if (l === 'psch' || l === 'pauschal' || l === 'pausch.') return { bezug: 'pauschal' };
  const kurz = Object.entries(MENGEN_INFO).find(([, v]) => v.kurz.toLowerCase() === l.replace(/^m[²³]\s*/, ''));
  if (kurz) return { bezug: kurz[0] as KostenBezug };
  return { bezug: 'menge', einheit: t };
}

function eintragAus(o: Record<string, unknown>): KatalogEintrag | null {
  const kg = String(o.kg ?? '').trim();
  if (!/^[1-8]\d\d$/.test(kg)) return null;
  const b = typeof o.bezug === 'string' ? bezugAus(o.bezug, kg) : { bezug: standardBezug(kg).bezug };
  const e: KatalogEintrag = { kg, bezeichnung: String(o.bezeichnung ?? '').trim() || kgName(kg), ...b };
  if (typeof o.einheit === 'string' && o.einheit.trim()) e.einheit = o.einheit.trim();
  const basis = Array.isArray(o.basis) ? o.basis.map(String) : typeof o.basis === 'string' ? o.basis.split(/[\s,+;]+/) : [];
  if (e.bezug === 'prozent') e.basis = basis.filter((x) => /^[1-8]\d\d$/.test(x)).length ? basis.filter((x) => /^[1-8]\d\d$/.test(x)) : (standardBezug(kg).basis ?? ['300', '400']);
  for (const f of ['von', 'mittel', 'bis'] as const) if (zahl(o[f]) !== undefined) e[f] = zahl(o[f]);
  if (typeof o.bemerkung === 'string' && o.bemerkung.trim()) e.bemerkung = o.bemerkung.trim();
  return e;
}

function leseJson(text: string): Katalog {
  const o = JSON.parse(text) as Record<string, unknown>;
  const list = Array.isArray(o) ? o : Array.isArray(o.eintraege) ? o.eintraege : [];
  const eintraege = (list as unknown[])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map(eintragAus)
    .filter((x): x is KatalogEintrag => x !== null);
  return {
    name: typeof o.name === 'string' && o.name ? o.name : 'Kennwertkatalog',
    ...(typeof o.quelle === 'string' && o.quelle ? { quelle: o.quelle } : {}),
    ...(typeof o.stand === 'string' && o.stand ? { stand: o.stand } : {}),
    ...(zahl(o.index) !== undefined ? { index: zahl(o.index) } : {}),
    eintraege,
  };
}

const CSV_SPALTEN = ['KG', 'Bezeichnung', 'Bezug', 'Grundlage', 'von', 'Mittel', 'bis', 'Bemerkung'];

function csvZeilen(text: string): string[][] {
  const sep = (text.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '').includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * CSV (Excel, Semikolon, Dezimalkomma): Kopfzeilen „# Name: …“, „# Quelle: …“, „# Stand: …“, „# Index: …“,
 * dann die Spalten KG; Bezeichnung; Bezug; Grundlage; von; Mittel; bis; Bemerkung.
 */
function leseCsv(text: string, dateiname: string): Katalog {
  const k: Katalog = { name: dateiname.replace(/\.[^.]+$/, ''), eintraege: [] };
  let kopf: string[] | null = null;
  for (const r of csvZeilen(text.replace(/^﻿/, ''))) {
    const erste = (r[0] ?? '').trim();
    const meta = /^#\s*(name|quelle|stand|index)\s*:\s*(.*)$/i.exec(r.join(';').trim());
    if (meta) {
      const wert = meta[2].replace(/;+$/, '').trim();
      const f = meta[1].toLowerCase();
      if (f === 'index') k.index = zahl(wert);
      else if (wert) (k as unknown as Record<string, string>)[f] = wert;
      continue;
    }
    if (!erste || erste.startsWith('#')) continue;
    if (!kopf && /^kg$/i.test(erste)) {
      kopf = r.map((x) => x.trim().toLowerCase());
      continue;
    }
    const spalten = kopf ?? CSV_SPALTEN.map((x) => x.toLowerCase());
    const o: Record<string, unknown> = {};
    spalten.forEach((s, i) => {
      const key = s === 'grundlage' ? 'basis' : s;
      o[key] = r[i] ?? '';
    });
    const e = eintragAus(o);
    if (e) k.eintraege.push(e);
  }
  return k;
}

export function leseKatalog(text: string, dateiname: string): Katalog {
  const k = /\.json$/i.test(dateiname) || text.trim().startsWith('{') || text.trim().startsWith('[') ? leseJson(text) : leseCsv(text, dateiname);
  if (!k.eintraege.length) throw new Error('Keine Einträge gefunden. Erwartet wird JSON oder CSV mit den Spalten KG; Bezeichnung; Bezug; Grundlage; von; Mittel; bis.');
  return k;
}

/* ---------- Schreiben ---------- */

const csvZelle = (v: string | number | undefined) => {
  if (v === undefined) return '';
  const s = typeof v === 'number' ? v.toLocaleString('de-DE', { useGrouping: false, maximumFractionDigits: 4 }) : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function bezugText(e: KatalogEintrag): string {
  if (e.bezug === 'menge') return e.einheit ?? 'Stk';
  if (e.bezug === 'pauschal') return 'psch';
  if (e.bezug === 'prozent') return '%';
  return MENGEN_INFO[e.bezug].kurz;
}

export function katalogCsv(k: Katalog): string {
  const zeilen = [
    `# Name: ${k.name}`,
    `# Quelle: ${k.quelle ?? ''}`,
    `# Stand: ${k.stand ?? ''}`,
    `# Index: ${k.index !== undefined ? k.index.toLocaleString('de-DE') : ''}`,
    CSV_SPALTEN.join(';'),
    ...k.eintraege.map((e) => [e.kg, e.bezeichnung, bezugText(e), e.basis?.join('+') ?? '', e.von, e.mittel, e.bis, e.bemerkung].map(csvZelle).join(';')),
  ];
  return `﻿${zeilen.join('\r\n')}\r\n`;
}

export const katalogJson = (k: Katalog) => JSON.stringify(k, null, 2);

/* ---------- Übernahme ---------- */

export function positionAusEintrag(e: KatalogEintrag, k: Pick<Katalog, 'name' | 'stand'>): KostenPosition {
  const p: KostenPosition = { id: newId('kp'), kg: e.kg, bezeichnung: e.bezeichnung, bezug: e.bezug };
  if (e.bezug === 'menge') p.einheit = e.einheit ?? 'Stk';
  if (e.basis) p.basis = [...e.basis];
  for (const f of ['von', 'mittel', 'bis'] as const) if (e[f] !== undefined) p[f] = e[f];
  p.quelle = [k.name, k.stand].filter(Boolean).join(', ');
  if (e.bemerkung) p.bemerkung = e.bemerkung;
  return p;
}

export function eintragAusPosition(p: KostenPosition): KatalogEintrag {
  const e: KatalogEintrag = { kg: p.kg, bezeichnung: p.bezeichnung, bezug: p.bezug };
  if (p.bezug === 'menge') e.einheit = p.einheit ?? 'Stk';
  if (p.basis) e.basis = [...p.basis];
  for (const f of ['von', 'mittel', 'bis'] as const) if (p[f] !== undefined) e[f] = p[f];
  if (p.bemerkung) e.bemerkung = p.bemerkung;
  return e;
}

/* ---------- Gliederungen ---------- */

const GLIEDERUNG: Record<'grob' | 'fein', string[]> = {
  // Kostenrahmen/-schätzung: 1. Ebene
  grob: ['300', '400', '500', '700'],
  // Kostenberechnung: 2. Ebene für das Bauwerk
  fein: ['310', '320', '330', '340', '350', '360', '390', '410', '420', '430', '440', '450', '500', '700'],
};

export const gliederungFuer = (stufe: KostenStufe | undefined) => (stufe === 'rahmen' || stufe === 'schaetzung' || !stufe ? 'grob' : 'fein');

/** leere Positionen (ohne Kennwerte) mit der üblichen Bezugsgröße je Kostengruppe */
export function gliederung(art: 'grob' | 'fein'): KostenPosition[] {
  return GLIEDERUNG[art].map((kg) => {
    const b = standardBezug(kg);
    return { id: newId('kp'), kg, bezeichnung: kgName(kg), bezug: b.bezug, ...(b.basis ? { basis: b.basis } : {}) };
  });
}
