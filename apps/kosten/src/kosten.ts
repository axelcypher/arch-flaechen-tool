import type { ProjectResult } from '@core/calc';
import { computeProject } from '@core/calc';
import type { Kosten, KostenPosition, KostenStand, KostenStufe, Project, Spanne } from '@core/model';
import { KOSTEN_STUFEN, newId } from '@core/model';
import { istKg, kg1, kg2, kgInBasis, kgName, kgUnter } from './din276';
import type { Mengen, MengenBezug } from './mengen';
import { MENGEN_INFO, mengen, mengenWerte } from './mengen';

/**
 * Rechenkern der Kostenermittlung (unabhängig von der Oberfläche):
 *   Kosten = Menge × Kennwert × Faktor   (Faktor = Baupreisindex aktuell/Basis × Regionalfaktor)
 * je Position als Bandbreite von / Mittel / bis. Pauschalen gelten unverändert, Prozentpositionen
 * (z. B. Baunebenkosten) beziehen sich auf die Summe der angegebenen Kostengruppen.
 * Gerechnet wird netto; enthalten die Kennwerte die Umsatzsteuer, werden sie vorher herausgerechnet.
 */

export const MWST_STANDARD = 19;

export interface PositionErgebnis {
  pos: KostenPosition;
  /** Menge in der Bezugseinheit (Pauschale 1, Prozent: Grundlage in €) */
  menge: number;
  einheit: string;
  /** Kennwert nach Faktor, netto (bei Prozent: Prozentsatz) */
  kennwert: Spanne;
  kosten: Spanne;
  aktiv: boolean;
  hinweis?: string;
}

export interface KgSumme {
  kg: string;
  name: string;
  ebene: 1 | 2;
  summe: Spanne;
}

export interface Ergebnis {
  mengen: Mengen;
  faktor: number;
  mwst: number;
  positionen: PositionErgebnis[];
  /** Summen je Kostengruppe der 1. und 2. Ebene (netto), sortiert */
  summen: KgSumme[];
  gesamtNetto: Spanne;
  gesamtBrutto: Spanne;
  /** Bauwerkskosten (KG 300 + 400) brutto je Bezugseinheit */
  kennwerte: { kurz: string; einheit: string; wert: Spanne }[];
  hinweise: string[];
}

const NULL: Spanne = [0, 0, 0];
const add = (a: Spanne, b: Spanne): Spanne => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mal = (a: Spanne, f: number): Spanne => [a[0] * f, a[1] * f, a[2] * f];

/** Bandbreite einer Position: fehlende Werte werden aus den vorhandenen ergänzt */
export function spanneVon(p: Pick<KostenPosition, 'von' | 'mittel' | 'bis'>): Spanne {
  const { von, bis } = p;
  const mittel = p.mittel ?? (von !== undefined && bis !== undefined ? (von + bis) / 2 : (von ?? bis));
  if (mittel === undefined) return NULL;
  return [von ?? mittel, mittel, bis ?? mittel];
}

export function faktorVon(k: Kosten | undefined): number {
  const index = k?.indexBasis && k.indexAktuell ? k.indexAktuell / k.indexBasis : 1;
  return index * (k?.regionalfaktor ?? 1);
}

export function einheitVon(p: KostenPosition): string {
  if (p.bezug === 'pauschal') return 'psch';
  if (p.bezug === 'prozent') return '%';
  if (p.bezug === 'menge') return p.einheit || 'Stk';
  return MENGEN_INFO[p.bezug].einheit;
}

/** Bezugsgröße als Text: „m² BGF“, „Stk“, „psch“, „% von KG 300 + 400“ */
export function bezugLabel(p: Pick<KostenPosition, 'bezug' | 'einheit' | 'basis'>): string {
  if (p.bezug === 'pauschal') return 'psch';
  if (p.bezug === 'prozent') return `% von KG ${(p.basis ?? []).join(' + ')}`;
  if (p.bezug === 'menge') return p.einheit || 'Stk';
  return `${MENGEN_INFO[p.bezug].einheit} ${MENGEN_INFO[p.bezug].kurz}`;
}

export function berechne(project: Project, result: ProjectResult = computeProject(project)): Ergebnis {
  const k = project.kosten;
  const m = mengen(project, result);
  const faktor = faktorVon(k);
  const mwst = k?.mwst ?? MWST_STANDARD;
  const netto = k?.kennwerteBrutto ? 1 / (1 + mwst / 100) : 1;
  const hinweise: string[] = [];
  const positionen = k?.positionen ?? [];

  // zuerst alle Positionen mit Menge bzw. Betrag, dann Prozentpositionen auf deren Summen
  const ergebnisse = new Map<string, PositionErgebnis>();
  for (const pos of positionen) {
    if (pos.bezug === 'prozent') continue;
    const kw = spanneVon(pos);
    let menge = 1;
    let kennwert: Spanne;
    let hinweis: string | undefined;
    if (pos.bezug === 'pauschal') kennwert = mal(kw, netto);
    else {
      menge = pos.bezug === 'menge' ? (pos.menge ?? 0) : m[pos.bezug as MengenBezug].wert;
      kennwert = mal(kw, faktor * netto);
      if (menge === 0) hinweis = pos.bezug === 'menge' ? 'Menge fehlt' : `${MENGEN_INFO[pos.bezug as MengenBezug].kurz} ist 0`;
    }
    if (kw[1] === 0) hinweis = hinweis ?? 'Kennwert fehlt';
    ergebnisse.set(pos.id, { pos, menge, einheit: einheitVon(pos), kennwert, kosten: mal(kennwert, menge), aktiv: !pos.aus && istKg(pos.kg), hinweis });
  }
  for (const pos of positionen) {
    if (pos.bezug !== 'prozent') continue;
    const basis = (pos.basis ?? []).filter(istKg);
    const eigene = basis.some((b) => pos.kg === b || kgUnter(pos.kg, b) || kgUnter(b, pos.kg));
    const grundlage = eigene
      ? NULL
      : [...ergebnisse.values()].filter((e) => e.aktiv && kgInBasis(e.pos.kg, basis)).reduce((a, e) => add(a, e.kosten), NULL);
    const kennwert = spanneVon(pos);
    // von/bis: niedriger Satz auf niedrige Grundlage, hoher auf hohe
    const kosten: Spanne = [(grundlage[0] * kennwert[0]) / 100, (grundlage[1] * kennwert[1]) / 100, (grundlage[2] * kennwert[2]) / 100];
    ergebnisse.set(pos.id, {
      pos,
      menge: grundlage[1],
      einheit: '%',
      kennwert,
      kosten,
      aktiv: !pos.aus && istKg(pos.kg),
      hinweis: eigene ? 'Grundlage enthält die eigene Kostengruppe' : !basis.length ? 'Grundlage fehlt' : kennwert[1] === 0 ? 'Prozentsatz fehlt' : undefined,
    });
  }
  const liste = positionen.map((p) => ergebnisse.get(p.id)!);
  const aktiv = liste.filter((e) => e.aktiv);

  // Summen je Kostengruppe (1. und 2. Ebene)
  const sum = new Map<string, Spanne>();
  for (const e of aktiv) {
    for (const g of [kg1(e.pos.kg), kg2(e.pos.kg)]) if (g) sum.set(g, add(sum.get(g) ?? NULL, e.kosten));
  }
  const summen: KgSumme[] = [...sum.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kg, s]) => ({ kg, name: kgName(kg), ebene: kg[1] === '0' ? 1 : 2, summe: s }));
  const gesamtNetto = summen.filter((s) => s.ebene === 1).reduce((a, s) => add(a, s.summe), NULL);
  const gesamtBrutto = mal(gesamtNetto, 1 + mwst / 100);

  // Doppelerfassung: Position und eine Position in einer übergeordneten Kostengruppe gleichzeitig aktiv
  const doppelt = new Set<string>();
  for (const a of aktiv) for (const b of aktiv) if (kgUnter(a.pos.kg, b.pos.kg)) doppelt.add(`KG ${b.pos.kg} und KG ${a.pos.kg}`);
  for (const d of doppelt) hinweise.push(`${d} sind beide erfasst – die Kosten werden doppelt gezählt. Eine der Positionen ausschalten.`);
  for (const e of liste) if (!istKg(e.pos.kg)) hinweise.push(`„${e.pos.bezeichnung || 'Position'}“: keine gültige Kostengruppe (dreistellig, 100–899) – wird nicht gerechnet.`);
  const fehlend = aktiv.filter((e) => e.hinweis);
  if (fehlend.length) hinweise.push(`${fehlend.length} Position${fehlend.length > 1 ? 'en' : ''} ohne Menge oder Kennwert: ${fehlend.map((e) => `KG ${e.pos.kg} (${e.hinweis})`).join(', ')}.`);
  if (faktor !== 1) hinweise.push(`Kennwerte mit Faktor ${faktor.toLocaleString('de-DE', { maximumFractionDigits: 4 })} angepasst (Baupreisindex/Regionalfaktor); Pauschalen und Prozentsätze unverändert.`);
  if (!positionen.length) hinweise.push('Noch keine Positionen – Gliederung anlegen oder Kennwerte aus dem Katalog übernehmen.');

  const bauwerk = mal(
    summen.filter((s) => s.kg === '300' || s.kg === '400').reduce((a, s) => add(a, s.summe), NULL),
    1 + mwst / 100,
  );
  const kennwerte = (['bgf', 'bri', 'nuf', 'wofl'] as MengenBezug[])
    .filter((b) => m[b].wert > 0 && bauwerk[1] > 0)
    .map((b) => ({ kurz: MENGEN_INFO[b].kurz, einheit: MENGEN_INFO[b].einheit, wert: mal(bauwerk, 1 / m[b].wert) }));

  return { mengen: m, faktor, mwst, positionen: liste, summen, gesamtNetto, gesamtBrutto, kennwerte, hinweise };
}

/** Herkunft der Kennwerte in einer Zeile: „Name (Quelle), Stand …“ */
export function katalogText(k: Kosten['katalog']): string {
  if (!k) return '';
  return `${k.name}${k.quelle ? ` (${k.quelle})` : ''}${k.stand ? `, Stand ${k.stand}` : ''}`;
}

export const HAFTUNG =
  'Die Kennwerte sind Eingaben des Anwenders; das Tool rechnet transparent mit den hinterlegten Werten und liefert keine Preise. Die Verantwortung für die Kostenermittlung bleibt bei der Verfasserin bzw. dem Verfasser.';

/* ---------- Kostenstände ---------- */

export const stufeLabel = (s: KostenStufe | undefined) => KOSTEN_STUFEN.find((x) => x.id === s)?.label ?? 'Kostenermittlung';

export function standAus(e: Ergebnis, stufe: KostenStufe, bemerkung: string, datum = new Date().toISOString().slice(0, 10)): KostenStand {
  return {
    id: newId('ks'),
    datum,
    stufe,
    bemerkung,
    mengen: mengenWerte(e.mengen),
    summen: Object.fromEntries(e.summen.map((s) => [s.kg, s.summe])),
    gesamtNetto: e.gesamtNetto,
    gesamtBrutto: e.gesamtBrutto,
  };
}

export interface VergleichZeile {
  kg: string;
  name: string;
  vorher: number;
  jetzt: number;
  differenz: number;
}

/** Vorher/Nachher (Mittelwerte, netto) gegenüber einem Kostenstand – je Kostengruppe der 1. Ebene und Mengen */
export function vergleiche(stand: KostenStand, e: Ergebnis): { zeilen: VergleichZeile[]; gesamt: VergleichZeile; mengen: { bezug: MengenBezug; vorher: number; jetzt: number }[] } {
  const jetzt = new Map(e.summen.filter((s) => s.ebene === 1).map((s) => [s.kg, s.summe[1]]));
  const kgs = [...new Set([...Object.keys(stand.summen).filter((kg) => kg[1] === '0'), ...jetzt.keys()])].sort();
  const zeilen = kgs.map((kg) => {
    const v = stand.summen[kg]?.[1] ?? 0;
    const j = jetzt.get(kg) ?? 0;
    return { kg, name: kgName(kg), vorher: v, jetzt: j, differenz: j - v };
  });
  const gesamt = { kg: '', name: 'Gesamt netto', vorher: stand.gesamtNetto[1], jetzt: e.gesamtNetto[1], differenz: e.gesamtNetto[1] - stand.gesamtNetto[1] };
  const mengenDiff = (Object.keys(stand.mengen) as MengenBezug[])
    .filter((b) => b in e.mengen && Math.abs((stand.mengen[b] ?? 0) - e.mengen[b].wert) > 0.005)
    .map((b) => ({ bezug: b, vorher: stand.mengen[b], jetzt: e.mengen[b].wert }));
  return { zeilen, gesamt, mengen: mengenDiff };
}

/* ---------- Formatierung ---------- */

export const euro = (v: number) => `${Math.round(v).toLocaleString('de-DE')} €`;
export const euroSpanne = (s: Spanne) => (Math.round(s[0]) === Math.round(s[2]) ? euro(s[1]) : `${Math.round(s[0]).toLocaleString('de-DE')} – ${Math.round(s[2]).toLocaleString('de-DE')} €`);
