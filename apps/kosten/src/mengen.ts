import type { ProjectResult } from '@core/calc';
import { computeProject } from '@core/calc';
import { perimeter } from '@core/geometry';
import type { KostenBezug, OutlineShape, Project, Storey } from '@core/model';
import { storeyElevations } from '@core/model';
import { modellSolidFaces } from '@core/modellSolid';
import type { Point3, SolidFaces } from '@core/roof';
import { solidFaces } from '@core/roof';

/**
 * Mengen für die Kostenermittlung: Grundflächen und Rauminhalte nach DIN 277 und daraus abgeleitete
 * Bauteilmengen (grob, aus den BGF-Umrissen, Geschosshöhen und Dächern). Jede Menge lässt sich von Hand
 * festlegen; dann gilt der eingetragene Wert.
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
  awf: { kurz: 'AWF', label: 'Außenwandfläche', einheit: 'm²', ermittlung: 'grob: senkrechte Außenflächen der BGF-Körper (R), einschließlich Öffnungen' },
  iwf: { kurz: 'IWF', label: 'Innenwandfläche', einheit: 'm²', ermittlung: 'grob: (Σ Raumumfänge − Außenumfang) / 2 × Geschosshöhe' },
  def: { kurz: 'DEF', label: 'Deckenfläche', einheit: 'm²', ermittlung: 'BGF der Geschosse über dem untersten' },
  daf: { kurz: 'DAF', label: 'Dachfläche', einheit: 'm²', ermittlung: 'Oberseiten der BGF-Körper (geneigt in wahrer Größe) ohne Deckenfläche' },
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

/** Fläche eines ebenen 3D-Polygons (Newell) */
function flaeche3(poly: Point3[]): number {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return Math.hypot(x, y, z) / 2;
}

function koerper(project: Project, storey: Storey, s: OutlineShape, floorZ: number): SolidFaces {
  if (s.dach?.typ === 'modell' && project.dachModell) return modellSolidFaces(project, storey, s, floorZ);
  return solidFaces(s.points, s.dach, s.hoehe ?? storey.hoehe);
}

/** abgeleitete Mengen ohne Festlegungen */
export function mengenAbgeleitet(project: Project, result: ProjectResult = computeProject(project)): Record<MengenBezug, number> {
  const t = result.total;
  const elev = storeyElevations(project);
  const reihenfolge = project.storeys.map((s, i) => ({ s, i, e: elev[i] })).sort((a, b) => a.e - b.e);
  const bgfVon = (id: string) => result.storeys.find((x) => x.storeyId === id)?.bgf.total ?? 0;

  const unterstes = reihenfolge.find((x) => bgfVon(x.s.id) > 0) ?? reihenfolge[0];
  const grf = unterstes ? bgfVon(unterstes.s.id) : 0;
  const def = reihenfolge.filter((x) => x !== unterstes).reduce((a, x) => a + bgfVon(x.s.id), 0);
  const tiefe = unterstes && unterstes.e < -0.2 ? -unterstes.e : 0;

  let awf = 0;
  let oben = 0;
  let iwf = 0;
  for (const { s, e } of reihenfolge) {
    const umrisse = s.shapes.filter((x): x is OutlineShape => x.kind === 'outline' && !x.subtract && x.umschliessung === 'R');
    for (const u of umrisse) {
      const f = koerper(project, s, u, e);
      for (const w of f.sides) awf += flaeche3(w);
      for (const d of f.tops) oben += flaeche3(d);
    }
    const raumumfang = s.shapes.filter((x) => x.kind === 'room' && !x.subtract).reduce((a, r) => a + perimeter(r.points), 0);
    const aussen = umrisse.reduce((a, u) => a + perimeter(u.points), 0);
    if (raumumfang > 0) iwf += (Math.max(0, raumumfang - aussen) / 2) * s.hoehe;
  }

  // überbaute Fläche: größte BGF eines Geschosses ab Geländehöhe (sonst des untersten)
  const oberirdisch = reihenfolge.filter((x) => x.e >= -0.5).map((x) => bgfVon(x.s.id));
  const ueberbaut = oberirdisch.length ? Math.max(...oberirdisch) : grf;
  const fbg = project.meta.grundstueck.flaeche ?? 0;

  return {
    bgf: r2(t.bgf.total),
    bri: r2(t.bri.total),
    nuf: r2(t.nuf.total),
    nrf: r2(t.nrf.total),
    tf: r2(t.tf.total),
    vf: r2(t.vf.total),
    wofl: r2(t.wofl),
    grf: r2(grf),
    bgi: r2(grf * tiefe),
    awf: r2(awf),
    iwf: r2(iwf),
    def: r2(def),
    daf: r2(Math.max(0, oben - def)),
    auf: r2(fbg > 0 ? Math.max(0, fbg - ueberbaut) : 0),
    fbg: r2(fbg),
    we: result.wohnungen.filter((w) => w.wohnung.trim()).length,
  };
}

export function mengen(project: Project, result?: ProjectResult): Mengen {
  const ab = mengenAbgeleitet(project, result);
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
