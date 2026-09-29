import type { LageplanNutzung, Versiegelung } from './model';

/**
 * Flächen im Lageplan: Versiegelung (aus der Zeichnung) und Nutzung (für die Anrechnung auf die
 * Grundfläche) sind unabhängig – eine Zufahrt aus Rasengitter ist teilversiegelt und trotzdem Zufahrt.
 */

export const VERSIEGELUNGEN: { id: Versiegelung; label: string; color: string }[] = [
  { id: 'voll', label: 'vollversiegelt', color: '#8a8f99' },
  { id: 'teil', label: 'teilversiegelt', color: '#c9a95c' },
  { id: 'gruen', label: 'Grünfläche', color: '#7cb66a' },
];

export const LAGEPLAN_NUTZUNGEN: { id: LageplanNutzung; label: string }[] = [
  { id: 'zufahrt', label: 'Zufahrt' },
  { id: 'stellplatz', label: 'Stellplatz' },
  { id: 'garage', label: 'Garage / Carport' },
  { id: 'terrasse', label: 'Terrasse' },
  { id: 'weg', label: 'Weg' },
  { id: 'nebenanlage', label: 'Nebenanlage (§ 14 BauNVO)' },
  { id: 'unterirdisch', label: 'unterirdische Anlage' },
  { id: 'garten', label: 'Garten / Grünfläche' },
  { id: 'sonstige', label: 'sonstige' },
];

export const versiegelungInfo = (v: Versiegelung) => VERSIEGELUNGEN.find((x) => x.id === v) ?? VERSIEGELUNGEN[0];
export const nutzungLabel = (n: LageplanNutzung) => LAGEPLAN_NUTZUNGEN.find((x) => x.id === n)?.label ?? n;

const NUTZUNG_KEYWORDS: [RegExp, LageplanNutzung][] = [
  [/tiefgarage|unterirdisch/i, 'unterirdisch'],
  [/zufahrt|einfahrt|ausfahrt|auffahrt/i, 'zufahrt'],
  [/stellpl|parkpl|parkfl/i, 'stellplatz'],
  [/garage|carport/i, 'garage'],
  [/terrasse|sitzpl|freisitz/i, 'terrasse'],
  [/weg|zugang|pflaster|gehweg|podest|treppe/i, 'weg'],
  [/gartenhaus|schuppen|gerätehaus|geraetehaus|müll|muell|fahrrad|pool|nebenanlage/i, 'nebenanlage'],
  [/rasen|garten|grün|gruen|beet|wiese|pflanz|hecke/i, 'garten'],
];

const VERSIEGELUNG_KEYWORDS: [RegExp, Versiegelung][] = [
  [/grün|gruen|rasen(?!gitter)|garten|beet|wiese|pflanz|hecke/i, 'gruen'],
  [/teil|rasengitter|rasenfuge|schotter|kies|splitt|öko|oeko|drän|draen|wassergebunden/i, 'teil'],
  [/voll|asphalt|beton|pflaster|platten|versiegelt/i, 'voll'],
];

/** Vorschlag aus Name, Ebene oder Baustoff eines Bauteils */
export function nutzungAusText(text: string): LageplanNutzung {
  for (const [re, n] of NUTZUNG_KEYWORDS) if (re.test(text)) return n;
  return 'sonstige';
}

export function versiegelungAusText(text: string, nutzung?: LageplanNutzung): Versiegelung {
  for (const [re, v] of VERSIEGELUNG_KEYWORDS) if (re.test(text)) return v;
  return nutzung === 'garten' ? 'gruen' : 'voll';
}
