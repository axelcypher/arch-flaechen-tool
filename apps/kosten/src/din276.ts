import type { KostenBezug } from '@core/model';

/**
 * Kostengruppen nach DIN 276 (Ausgabe 2018), 1. und 2. Gliederungsebene. Die 3. Ebene (z. B. 331)
 * ist frei eintragbar; ihr Name steht dann an der Position.
 */
export const KOSTENGRUPPEN: Record<string, string> = {
  '100': 'Grundstück',
  '110': 'Grundstückswert',
  '120': 'Grundstücksnebenkosten',
  '130': 'Rechte Dritter',
  '190': 'Sonstige Grundstückskosten',
  '200': 'Vorbereitende Maßnahmen',
  '210': 'Herrichten',
  '220': 'Öffentliche Erschließung',
  '230': 'Nichtöffentliche Erschließung',
  '240': 'Ausgleichsmaßnahmen und -abgaben',
  '250': 'Übergangsmaßnahmen',
  '300': 'Bauwerk – Baukonstruktionen',
  '310': 'Baugrube/Erdbau',
  '320': 'Gründung, Unterbau',
  '330': 'Außenwände/Vertikale Baukonstruktionen, außen',
  '340': 'Innenwände/Vertikale Baukonstruktionen, innen',
  '350': 'Decken/Horizontale Baukonstruktionen',
  '360': 'Dächer',
  '370': 'Infrastrukturanlagen',
  '380': 'Baukonstruktive Einbauten',
  '390': 'Sonstige Maßnahmen für Baukonstruktionen',
  '400': 'Bauwerk – Technische Anlagen',
  '410': 'Abwasser-, Wasser-, Gasanlagen',
  '420': 'Wärmeversorgungsanlagen',
  '430': 'Raumlufttechnische Anlagen',
  '440': 'Elektrische Anlagen',
  '450': 'Kommunikations-, sicherheits- und informationstechnische Anlagen',
  '460': 'Förderanlagen',
  '470': 'Nutzungsspezifische und verfahrenstechnische Anlagen',
  '480': 'Gebäude- und Anlagenautomation',
  '490': 'Sonstige Maßnahmen für technische Anlagen',
  '500': 'Außenanlagen und Freiflächen',
  '510': 'Erdbau',
  '520': 'Gründung, Unterbau',
  '530': 'Oberbau, Deckschichten',
  '540': 'Baukonstruktionen',
  '550': 'Technische Anlagen',
  '560': 'Einbauten in Außenanlagen und Freiflächen',
  '570': 'Vegetationsflächen',
  '580': 'Wasserflächen',
  '590': 'Sonstige Maßnahmen für Außenanlagen und Freiflächen',
  '600': 'Ausstattung und Kunstwerke',
  '610': 'Allgemeine Ausstattung',
  '620': 'Besondere Ausstattung',
  '630': 'Informationstechnische Ausstattung',
  '640': 'Künstlerische Ausstattung',
  '690': 'Sonstige Ausstattung',
  '700': 'Baunebenkosten',
  '710': 'Bauherrenaufgaben',
  '720': 'Vorbereitung der Objektplanung',
  '730': 'Objektplanung',
  '740': 'Fachplanung',
  '750': 'Künstlerische Leistungen',
  '760': 'Allgemeine Baunebenkosten',
  '790': 'Sonstige Baunebenkosten',
  '800': 'Finanzierung',
  '810': 'Finanzierungsnebenkosten',
  '820': 'Fremdkapitalzinsen',
  '830': 'Eigenkapitalzinsen',
  '840': 'Bürgschaften',
  '890': 'Sonstige Finanzierungskosten',
};

export const KG_ERSTE_EBENE = ['100', '200', '300', '400', '500', '600', '700', '800'];

/** gültige Kostengruppe: drei Ziffern, 1. Ziffer 1–8 */
export const istKg = (kg: string) => /^[1-8]\d\d$/.test(kg);

/** übergeordnete Kostengruppe: 331 → 330 → 300 → null */
export function kgEltern(kg: string): string | null {
  if (!istKg(kg)) return null;
  if (kg[2] !== '0') return `${kg.slice(0, 2)}0`;
  if (kg[1] !== '0') return `${kg[0]}00`;
  return null;
}

/** Kostengruppe der 1. Ebene (331 → 300) */
export const kg1 = (kg: string) => (istKg(kg) ? `${kg[0]}00` : '');
/** Kostengruppe der 2. Ebene (331 → 330, 300 → '') */
export const kg2 = (kg: string) => (istKg(kg) && kg[1] !== '0' ? `${kg.slice(0, 2)}0` : '');

/** Ebene 1–3 */
export const kgEbene = (kg: string) => (!istKg(kg) ? 0 : kg[1] === '0' ? 1 : kg[2] === '0' ? 2 : 3);

/** Liegt `kind` unterhalb von `vorfahr` (331 unter 300 oder 330)? */
export function kgUnter(kind: string, vorfahr: string): boolean {
  let k = kgEltern(kind);
  while (k) {
    if (k === vorfahr) return true;
    k = kgEltern(k);
  }
  return false;
}

/** Gehört `kg` zu einer der Grundlagen (gleich oder darunter), z. B. 331 zu „300“? */
export const kgInBasis = (kg: string, basis: string[]) => basis.some((b) => kg === b || kgUnter(kg, b));

export function kgName(kg: string): string {
  return KOSTENGRUPPEN[kg] ?? '';
}

/**
 * übliche Bezugsgröße je Kostengruppe (Mengen und Bezugseinheiten nach DIN 277, wie in den gängigen
 * Kennwertsammlungen): Bauwerk je m² BGF, Bauteile je m² Bauteilfläche, Außenanlagen je m² AUF,
 * Baunebenkosten in % von KG 300 + 400.
 */
export function standardBezug(kg: string): { bezug: KostenBezug; basis?: string[] } {
  const g = kg1(kg);
  const z = kg2(kg);
  if (g === '100' || g === '200') return { bezug: 'fbg' };
  if (g === '300') {
    const map: Record<string, KostenBezug> = { '310': 'bgi', '320': 'grf', '330': 'awf', '340': 'iwf', '350': 'def', '360': 'daf' };
    return { bezug: map[z] ?? 'bgf' };
  }
  if (g === '400' || g === '600') return { bezug: 'bgf' };
  if (g === '500') return { bezug: 'auf' };
  if (g === '700') return { bezug: 'prozent', basis: ['300', '400'] };
  return { bezug: 'pauschal' };
}
