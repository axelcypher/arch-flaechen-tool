import { polygonArea } from './geometry';
import type { Nutzungsgruppe, OutlineShape, Project, Raumumschliessung, Storey, WoflKategorie } from './model';
import { storeyElevations } from './model';
import { roofStats } from './roof';
import { meshRoofStats } from './roofMesh';
import { nutzungInfo, woflFaktor } from './norms';

/**
 * Flächen- und Rauminhaltsberechnung.
 *
 *  BGF  = Σ Umrissflächen (R/S getrennt), Abzugsflächen negativ
 *  BRI  = Σ Umrissfläche × Höhe (Geschosshöhe oder abweichende Höhe je Umriss)
 *  NRF  = NUF + TF + VF (Σ Raumflächen je Nutzungsgruppe)
 *  KGF  = BGF − NRF
 *  WoFl = Σ Raumfläche × Anrechnungsfaktor (WoFlV § 4)
 */

export interface RS {
  R: number;
  S: number;
  total: number;
}

export type NutzungSummen = Record<Nutzungsgruppe, number>;

export interface RoomResult {
  shapeId: string;
  storeyId: string;
  storeyName: string;
  nummer: string;
  name: string;
  nutzung: Nutzungsgruppe;
  umschliessung: Raumumschliessung;
  subtract: boolean;
  /** vorzeichenbehaftet: Abzugsflächen negativ */
  area: number;
  woflKategorie: WoflKategorie;
  woflFaktor: number;
  woflArea: number;
  wohnung: string;
}

export interface AreaTotals {
  bgf: RS;
  bri: RS;
  nutzung: NutzungSummen;
  nuf: RS;
  tf: RS;
  vf: RS;
  nrf: RS;
  kgf: RS;
  wofl: number;
}

export interface StoreyResult extends AreaTotals {
  storeyId: string;
  name: string;
  hoehe: number;
  rooms: RoomResult[];
}

export interface WohnungResult {
  wohnung: string;
  wofl: number;
  grundflaeche: number;
  rooms: RoomResult[];
}

export interface ProjectResult {
  storeys: StoreyResult[];
  total: AreaTotals;
  wohnungen: WohnungResult[];
}

const rs = (): RS => ({ R: 0, S: 0, total: 0 });
const emptyNutzung = (): NutzungSummen => ({ NUF1: 0, NUF2: 0, NUF3: 0, NUF4: 0, NUF5: 0, NUF6: 0, NUF7: 0, TF: 0, VF: 0 });

function addRS(target: RS, key: Raumumschliessung, v: number) {
  target[key] += v;
  target.total += v;
}

function emptyTotals(): AreaTotals {
  return { bgf: rs(), bri: rs(), nutzung: emptyNutzung(), nuf: rs(), tf: rs(), vf: rs(), nrf: rs(), kgf: rs(), wofl: 0 };
}

/** Rauminhalt eines BGF-Umrisses (ohne Vorzeichen): Fläche × Höhe bzw. bis zur Dachhaut */
export function outlineVolume(s: OutlineShape, storey: Storey, project: Project): number {
  const h = s.hoehe ?? storey.hoehe;
  if (!s.dach) return polygonArea(s.points) * h;
  if (s.dach.typ === 'modell') {
    if (!project.dachModell) return polygonArea(s.points) * h;
    const idx = project.storeys.indexOf(storey);
    const floorZ = storeyElevations(project)[idx] ?? 0;
    return meshRoofStats(project.dachModell, s.points, floorZ, h, s.dach.maxHoehe).volumen;
  }
  return Math.abs(roofStats(s.dach, s.points).volumen);
}

export function computeStorey(storey: Storey, project: Project): StoreyResult {
  const t = emptyTotals();
  const rooms: RoomResult[] = [];

  for (const s of storey.shapes) {
    const sign = s.subtract ? -1 : 1;
    const a = sign * polygonArea(s.points);
    if (s.kind === 'outline') {
      addRS(t.bgf, s.umschliessung, a);
      addRS(t.bri, s.umschliessung, sign * outlineVolume(s, storey, project));
    } else {
      t.nutzung[s.nutzung] += a;
      const bereich = nutzungInfo(s.nutzung).bereich;
      addRS(bereich === 'NUF' ? t.nuf : bereich === 'TF' ? t.tf : t.vf, s.umschliessung, a);
      addRS(t.nrf, s.umschliessung, a);
      const f = woflFaktor(s.wofl, project.settings);
      const woflArea = a * f;
      t.wofl += woflArea;
      rooms.push({
        shapeId: s.id,
        storeyId: storey.id,
        storeyName: storey.name,
        nummer: s.nummer,
        name: s.name,
        nutzung: s.nutzung,
        umschliessung: s.umschliessung,
        subtract: s.subtract,
        area: a,
        woflKategorie: s.wofl.kategorie,
        woflFaktor: f,
        woflArea,
        wohnung: s.wofl.wohnung.trim(),
      });
    }
  }

  t.kgf = { R: t.bgf.R - t.nrf.R, S: t.bgf.S - t.nrf.S, total: t.bgf.total - t.nrf.total };
  return { storeyId: storey.id, name: storey.name, hoehe: storey.hoehe, rooms, ...t };
}

function accumulate(target: AreaTotals, s: AreaTotals) {
  for (const k of ['bgf', 'bri', 'nuf', 'tf', 'vf', 'nrf', 'kgf'] as const) {
    target[k].R += s[k].R;
    target[k].S += s[k].S;
    target[k].total += s[k].total;
  }
  for (const k of Object.keys(target.nutzung) as Nutzungsgruppe[]) target.nutzung[k] += s.nutzung[k];
  target.wofl += s.wofl;
}

export function computeProject(project: Project): ProjectResult {
  const storeys = project.storeys.map((s) => computeStorey(s, project));
  const total = emptyTotals();
  for (const s of storeys) accumulate(total, s);

  const map = new Map<string, WohnungResult>();
  for (const st of storeys) {
    for (const r of st.rooms) {
      if (r.woflKategorie === 'keine') continue;
      const key = r.wohnung || '(ohne Zuordnung)';
      let w = map.get(key);
      if (!w) {
        w = { wohnung: key, wofl: 0, grundflaeche: 0, rooms: [] };
        map.set(key, w);
      }
      w.wofl += r.woflArea;
      w.grundflaeche += r.area;
      w.rooms.push(r);
    }
  }
  const wohnungen = [...map.values()].sort((a, b) => a.wohnung.localeCompare(b.wohnung, 'de', { numeric: true }));
  return { storeys, total, wohnungen };
}
