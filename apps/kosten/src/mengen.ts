import type { ProjectResult } from '@core/calc';
import type { KostenBezug, Project } from '@core/model';
import { useBauteile } from './bauteile';
import { mengenNachweis } from './nachweis';
import type { IfcWand } from './waende';

/**
 * Mengen für die Kostenermittlung: Grundflächen und Rauminhalte nach DIN 277 und daraus abgeleitete
 * Bauteilmengen (grob, aus den BGF-Umrissen, Geschosshöhen und Dächern) – ermittelt im Mengennachweis
 * (nachweis.ts), der jede Menge in darstellbare Teile zerlegt. Jede Menge lässt sich von Hand festlegen;
 * dann gilt der eingetragene Wert.
 */

export type MengenBezug = Exclude<KostenBezug, 'menge' | 'pauschal' | 'prozent'>;

export const MENGEN_BEZUEGE: MengenBezug[] = ['bgf', 'bri', 'nuf', 'nrf', 'tf', 'vf', 'wofl', 'grf', 'bgi', 'awf', 'iwf', 'def', 'daf', 'auf', 'fbg', 'we'];

export const MENGEN_INFO: Record<MengenBezug, { kurz: string; label: string; einheit: string; ermittlung: string }> = {
  bgf: { kurz: 'BGF', label: 'Brutto-Grundfläche', einheit: 'm²', ermittlung: 'DIN 277, alle Geschosse (R + S)' },
  bri: { kurz: 'BRI', label: 'Brutto-Rauminhalt', einheit: 'm³', ermittlung: 'DIN 277, bis zur Dachhaut' },
  nuf: { kurz: 'NUF', label: 'Nutzungsfläche', einheit: 'm²', ermittlung: 'DIN 277, NUF 1–7' },
  nrf: { kurz: 'NRF', label: 'Netto-Raumfläche', einheit: 'm²', ermittlung: 'DIN 277' },
  tf: { kurz: 'TF', label: 'Technikfläche', einheit: 'm²', ermittlung: 'DIN 277' },
  vf: { kurz: 'VF', label: 'Verkehrsfläche', einheit: 'm²', ermittlung: 'DIN 277' },
  wofl: { kurz: 'WoFl', label: 'Wohnfläche', einheit: 'm²', ermittlung: 'WoFlV' },
  grf: { kurz: 'GRF', label: 'Gründungsfläche', einheit: 'm²', ermittlung: 'BGF des untersten Geschosses' },
  bgi: { kurz: 'BGI', label: 'Baugrubeninhalt', einheit: 'm³', ermittlung: 'grob: Gründungsfläche × Tiefe des untersten Fußbodens unter ±0,00' },
  awf: { kurz: 'AWF', label: 'Außenwandfläche', einheit: 'm²', ermittlung: 'grob: senkrechte Außenflächen der BGF-Körper (R) bis zur Dachhaut, einschließlich Öffnungen' },
  iwf: { kurz: 'IWF', label: 'Innenwandfläche', einheit: 'm²', ermittlung: 'Innenwände aus dem IFC-Modell, Länge × Höhe je Wand (Öffnungen übermessen); ohne Modell grob aus den Raumumfängen' },
  def: { kurz: 'DEF', label: 'Deckenfläche', einheit: 'm²', ermittlung: 'BGF der Geschosse über dem untersten' },
  daf: { kurz: 'DAF', label: 'Dachfläche', einheit: 'm²', ermittlung: 'Oberseiten der BGF-Körper (R), geneigt in wahrer Größe, soweit kein Geschoss darüber liegt' },
  auf: { kurz: 'AUF', label: 'Außenanlagenfläche', einheit: 'm²', ermittlung: 'Grundstücksfläche − überbaute Fläche' },
  fbg: { kurz: 'FBG', label: 'Grundstücksfläche', einheit: 'm²', ermittlung: 'Projektdaten' },
  we: { kurz: 'WE', label: 'Wohneinheiten', einheit: 'Stk', ermittlung: 'Wohnungen im Projekt' },
};

export interface Menge {
  wert: number;
  /** abgeleiteter Wert (auch wenn von Hand festgelegt) */
  abgeleitet: number;
  festgelegt: boolean;
}

export type Mengen = Record<MengenBezug, Menge>;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Wände aus dem IFC-Modell des geöffneten Projekts (siehe bauteile.ts) */
const aktuelleWaende = () => useBauteile.getState().waende;

/** abgeleitete Mengen ohne Festlegungen: je Menge die Summe ihrer mitzählenden Teile im Mengennachweis */
export function mengenAbgeleitet(project: Project, result?: ProjectResult, waende: IfcWand[] | null = aktuelleWaende()): Record<MengenBezug, number> {
  const n = mengenNachweis(project, result, waende).mengen;
  const out = {} as Record<MengenBezug, number>;
  for (const b of MENGEN_BEZUEGE) out[b] = b === 'we' ? n[b].summe : r2(n[b].summe);
  return out;
}

export function mengen(project: Project, result?: ProjectResult, waende: IfcWand[] | null = aktuelleWaende()): Mengen {
  const ab = mengenAbgeleitet(project, result, waende);
  const fest = project.kosten?.mengen ?? {};
  const out = {} as Mengen;
  for (const b of MENGEN_BEZUEGE) {
    const f = fest[b];
    out[b] = { wert: f ?? ab[b], abgeleitet: ab[b], festgelegt: f !== undefined };
  }
  return out;
}

/** nur die Werte (für Kostenstände) */
export const mengenWerte = (m: Mengen): Record<string, number> => Object.fromEntries(MENGEN_BEZUEGE.map((b) => [b, m[b].wert]));
