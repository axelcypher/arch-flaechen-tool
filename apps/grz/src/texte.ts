import type { Anrechnung, Nachweis, Status } from './massNutzung';

/** Bezeichnungen für Ansicht, Druck und Excel */

export const STATUS: Record<Status, { label: string; cls: string }> = {
  ok: { label: 'eingehalten', cls: 'ok' },
  ueberschritten: { label: 'überschritten', cls: 'bad' },
  pruefen: { label: 'prüfen', cls: 'warn' },
  offen: { label: 'Festsetzung fehlt', cls: 'off' },
};

export const ANRECHNUNG: Record<Anrechnung, string> = {
  hauptanlage: 'zählt',
  grz2: 'GRZ II',
  garage01: 'bis 0,1 frei',
  nein: 'zählt nicht',
  pruefen: 'prüfen',
};

export const AUFENTHALT = { ja: 'Aufenthaltsraum', nein: 'kein Aufenthaltsraum', treppe: 'Treppenraum' } as const;

export const GF_ART: Record<Nachweis['gfJeGeschoss'][number]['art'], string> = {
  vollgeschoss: 'Vollgeschoss, Außenmaße (ohne Balkone, Loggien, Terrassen)',
  aufenthalt: 'Aufenthaltsräume mit Treppenräumen und Umfassungswänden',
  keine: 'zählt nicht',
};

export function roemisch(n: number): string {
  const r = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return n >= 0 && n <= 10 ? r[n] || '0' : String(n);
}

/** Kennzahl mit zwei Nachkommastellen (GRZ/GFZ) */
export const zahl = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const HAFTUNG =
  'Das Tool rechnet nach und zeigt die angewandte Fassung; die Verantwortung für den Nachweis bleibt bei der Entwurfsverfasserin bzw. dem Entwurfsverfasser.';
