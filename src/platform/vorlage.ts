import type { Project } from '../core/model';
import { addDatei } from '../core/model';
import { base64ToBytes, bytesToBase64 } from './files';

/**
 * Excel-Vorlage: Sie gehört zum Projekt (Project.dateien, Art „vorlage“) und wird im Projektarchiv
 * mitgespeichert. Zusätzlich bleibt die zuletzt gewählte Vorlage im Browser hinterlegt und gilt
 * für Projekte ohne eigene Vorlage – beim Speichern wandert sie dann mit ins Archiv.
 */

const TEMPLATE_KEY = 'arch-flaechen-tool:excel-template';

export interface Vorlage {
  name: string;
  daten: Uint8Array;
  datum: string;
  /** aus dem Projekt (sonst die im Browser hinterlegte) */
  ausProjekt: boolean;
}

interface StoredTemplate {
  name: string;
  base64: string;
  date: string;
}

export function globaleVorlage(): Vorlage | null {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as StoredTemplate;
    return { name: t.name, daten: base64ToBytes(t.base64), datum: t.date, ausProjekt: false };
  } catch {
    return null;
  }
}

/** Liefert false, wenn die Vorlage zu groß für den Browserspeicher ist. */
export function setGlobaleVorlage(name: string, daten: Uint8Array): boolean {
  const t: StoredTemplate = { name, base64: bytesToBase64(daten), date: new Date().toLocaleDateString('de-DE') };
  try {
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(t));
    return true;
  } catch {
    return false;
  }
}

export function removeGlobaleVorlage() {
  try {
    localStorage.removeItem(TEMPLATE_KEY);
  } catch {
    // ignorieren
  }
}

export function aktuelleVorlage(p: Project): Vorlage | null {
  const d = p.dateien?.find((x) => x.art === 'vorlage');
  return d ? { name: d.name, daten: d.daten, datum: d.datum, ausProjekt: true } : globaleVorlage();
}

/** Projekt mit Vorlage fürs Archiv: ohne eigene Vorlage wird die hinterlegte übernommen. */
export function mitVorlage(p: Project): Project {
  if (p.dateien?.some((x) => x.art === 'vorlage')) return p;
  const g = globaleVorlage();
  return g ? addDatei(p, g.name, 'vorlage', g.daten).project : p;
}
