import { strToU8 } from 'fflate';
import { ARCHIV_ENDUNGEN, writeArchive } from '@core/archive';
import type { Dateisystem, Eintrag } from './dateisystem';
import { nameAus } from './nummer';
import type { Stammdaten } from './stammdaten';
import { alsProject, bereinigt, platzhalter, PROJEKT_DATEI, projektJson } from './stammdaten';
import type { Struktur } from './struktur';
import { normPfad, regelGilt, sichererName } from './struktur';
import { fuelleVorlage } from './vorlagen';

/**
 * Plan für einen neuen Projektordner: erst zeigen, was passiert (Trockenlauf), dann ausführen.
 * Es wird nur neu angelegt – was es schon gibt, bleibt unverändert und ist im Plan als „vorhanden“ markiert.
 */

/** Datei im Vorlagenordner */
export interface Vorlage {
  /** Pfad im Vorlagenordner, mit „/“ getrennt */
  pfad: string;
  lies: () => Promise<Uint8Array>;
}

export type Herkunft = 'struktur' | 'vorlage' | 'stammdaten' | 'flaechen';

export interface Schritt {
  art: 'ordner' | 'datei';
  /** Pfad im Projektordner */
  pfad: string;
  herkunft: Herkunft;
  /** bei Vorlagen: Pfad im Vorlagenordner */
  quelle?: string;
  /** gibt es schon – bleibt unverändert */
  vorhanden: boolean;
  daten?: () => Promise<Uint8Array>;
}

export interface Plan {
  /** Name des Projektordners */
  ordner: string;
  schritte: Schritt[];
  /** verhindern das Anlegen (fehlende Angaben) */
  fehler: string[];
  hinweise: string[];
}

/** Dateien, die keine Vorlagen sind: Systemdateien, Sperrdateien von Office, die Anleitung im Stamm */
const KEINE_VORLAGE = /(^|\/)(thumbs\.db|desktop\.ini|\.ds_store|~\$[^/]*|\.[^/]*)$/i;
const ANLEITUNG = /^liesmich\.(txt|md)$/i;

const kurzeWerte = (s: Stammdaten, date: Date) => ({ nummer: s.nummer, kurzname: s.kurzname, jahr: date.getFullYear() });

/** Zielpfad: Platzhalter ersetzen, jeden Teil für das Dateisystem bereinigen */
function zielPfad(pfad: string, werte: Record<string, string | number>): string {
  return normPfad(pfad)
    .split('/')
    .map((t) => sichererName(nameAus(t, werte)))
    .filter(Boolean)
    .join('/');
}

export function ordnerName(stamm: Stammdaten, struktur: Struktur, date = new Date()): string {
  const s = bereinigt(stamm);
  return sichererName(nameAus(struktur.ordnername, kurzeWerte(s, date)));
}

/**
 * Stellt den Plan auf. `vorhandene` sind die Einträge, die es im Projektordner schon gibt (leer, wenn der
 * Ordner neu ist).
 */
export function planen(stamm: Stammdaten, struktur: Struktur, vorlagen: Vorlage[], vorhandene: Eintrag[] = [], date = new Date()): Plan {
  const s = bereinigt(stamm);
  const werte = kurzeWerte(s, date);
  const ordner = ordnerName(s, struktur, date);
  const fehler: string[] = [];
  const hinweise: string[] = [];
  if (!s.nummer) fehler.push('Die Projektnummer fehlt.');
  if (!s.kurzname) fehler.push('Der Kurzname fehlt.');
  if (!ordner) fehler.push('Aus dem Schema für den Ordnernamen ergibt sich kein Name.');
  if (/\{[^}]*\}/.test(ordner)) fehler.push(`Der Ordnername enthält einen unbekannten Platzhalter: ${ordner}`);

  const da = new Map(vorhandene.map((e) => [e.pfad.toLowerCase(), e]));
  const schritte = new Map<string, Schritt>();
  const ordnerSchritt = (pfad: string, herkunft: Herkunft) => {
    // Zwischenordner mit aufnehmen, damit der Plan vollständig zeigt, was entsteht
    const teile = pfad.split('/');
    for (let i = 1; i <= teile.length; i++) {
      const p = teile.slice(0, i).join('/');
      const k = p.toLowerCase();
      if (!schritte.has(k)) schritte.set(k, { art: 'ordner', pfad: p, herkunft, vorhanden: da.get(k)?.ordner === true });
    }
  };

  const ausgeschlossen: string[] = [];
  for (const r of struktur.ordner) {
    const pfad = zielPfad(r.pfad, werte);
    if (!pfad) continue;
    if (regelGilt(r, s.leistungsphasen)) ordnerSchritt(pfad, 'struktur');
    else ausgeschlossen.push(pfad.toLowerCase());
  }
  if (ausgeschlossen.length) hinweise.push(`${ausgeschlossen.length} Ordner gehören zu nicht beauftragten Leistungsphasen und werden nicht angelegt.`);

  const ctx = platzhalter(s, ordner, date);
  const datei = (pfad: string, herkunft: Herkunft, daten: () => Promise<Uint8Array>, quelle?: string) => {
    const k = pfad.toLowerCase();
    if (schritte.has(k)) {
      hinweise.push(`„${pfad}“ ergibt sich mehrfach – nur die erste Quelle wird verwendet.`);
      return;
    }
    const eltern = pfad.split('/').slice(0, -1).join('/');
    if (eltern) ordnerSchritt(eltern, herkunft);
    schritte.set(k, { art: 'datei', pfad, herkunft, quelle, vorhanden: da.has(k), daten });
  };

  datei(PROJEKT_DATEI, 'stammdaten', async () => strToU8(projektJson(s, struktur, date)));

  if (struktur.flaechenprojekt.trim()) {
    let pfad = zielPfad(struktur.flaechenprojekt, werte);
    if (pfad && !new RegExp(`\\.(${ARCHIV_ENDUNGEN.join('|')})$`, 'i').test(pfad)) pfad += `.${ARCHIV_ENDUNGEN[0]}`;
    if (pfad) datei(pfad, 'flaechen', async () => writeArchive(alsProject(s), { app: `Projektordner ${__APP_VERSION__}`, date }));
  }

  let uebersprungen = 0;
  for (const v of [...vorlagen].sort((a, b) => a.pfad.localeCompare(b.pfad, 'de'))) {
    const quelle = normPfad(v.pfad);
    if (!quelle || KEINE_VORLAGE.test(quelle) || ANLEITUNG.test(quelle)) continue;
    const pfad = zielPfad(quelle, werte);
    if (!pfad) continue;
    // Vorlagen in Ordnern nicht beauftragter Leistungsphasen bleiben weg
    if (ausgeschlossen.some((a) => pfad.toLowerCase() === a || pfad.toLowerCase().startsWith(`${a}/`))) {
      uebersprungen++;
      continue;
    }
    const name = quelle.split('/').pop()!;
    datei(pfad, 'vorlage', async () => fuelleVorlage(name, await v.lies(), ctx), quelle);
  }
  if (uebersprungen) hinweise.push(`${uebersprungen} ${uebersprungen === 1 ? 'Vorlage liegt' : 'Vorlagen liegen'} in Ordnern nicht beauftragter Leistungsphasen und ${uebersprungen === 1 ? 'wird' : 'werden'} nicht kopiert.`);

  const liste = [...schritte.values()];
  const vorhanden = liste.filter((x) => x.vorhanden).length;
  if (vorhanden) hinweise.push(`${vorhanden} ${vorhanden === 1 ? 'Eintrag ist' : 'Einträge sind'} schon vorhanden und ${vorhanden === 1 ? 'bleibt' : 'bleiben'} unverändert.`);

  // als Baum: jeder Ordner vor seinem Inhalt, Dateien im Stamm zuletzt
  const schluessel = (x: Schritt) => (x.art === 'datei' && !x.pfad.includes('/') ? `￿${x.pfad}` : x.pfad);
  liste.sort((a, b) => schluessel(a).localeCompare(schluessel(b), 'de', { numeric: true }));
  return { ordner, schritte: liste, fehler, hinweise };
}

export interface Ergebnis {
  schritt: Schritt;
  status: 'angelegt' | 'vorhanden' | 'fehler';
  meldung?: string;
}

/**
 * Führt den Plan unter `stammordner` aus. Fehler einzelner Schritte halten die übrigen nicht auf; jeder
 * Schritt meldet, ob er angelegt hat oder das Ziel schon vorhanden war.
 */
export async function ausfuehren(fs: Dateisystem, stammordner: string, plan: Plan, fortschritt?: (fertig: number, gesamt: number) => void): Promise<Ergebnis[]> {
  if (plan.fehler.length) throw new Error(plan.fehler.join(' '));
  const out: Ergebnis[] = [];
  for (const [i, schritt] of plan.schritte.entries()) {
    const pfad = `${plan.ordner}/${schritt.pfad}`;
    try {
      const neu = schritt.art === 'ordner' ? await fs.ordnerAnlegen(stammordner, pfad) : await fs.dateiAnlegen(stammordner, pfad, await schritt.daten!());
      out.push({ schritt, status: neu ? 'angelegt' : 'vorhanden' });
    } catch (e) {
      out.push({ schritt, status: 'fehler', meldung: e instanceof Error ? e.message : String(e) });
    }
    fortschritt?.(i + 1, plan.schritte.length);
  }
  return out;
}

/** Vorlagen aus einem Vorlagenordner */
export async function ladeVorlagen(fs: Dateisystem, ordner: string): Promise<Vorlage[]> {
  const eintraege = await fs.liste(ordner, 12);
  return eintraege.filter((e) => !e.ordner).map((e) => ({ pfad: e.pfad, lies: () => fs.lies(ordner, e.pfad) }));
}
