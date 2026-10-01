import pc from 'polygon-clipping';
import type { ProjectResult } from '@core/calc';
import { computeProject, modellRoofParams, outlineVolume } from '@core/calc';
import { fmt2 } from '@core/format';
import type { Point } from '@core/geometry';
import { distanceToEdges, perimeter, pointInPolygon, polygonArea } from '@core/geometry';
import type { OutlineShape, Project, RoomShape, Storey } from '@core/model';
import { roomArea, storeyElevations } from '@core/model';
import { heightFieldSolid, modellSolidFaces } from '@core/modellSolid';
import { nutzungInfo, woflFaktor } from '@core/norms';
import type { Point3, SolidFaces } from '@core/roof';
import { DACH_TYPEN, solidFaces } from '@core/roof';
import { meshRoofHeightAt } from '@core/roofMesh';
import type { MengenBezug } from './mengen';

/**
 * Mengennachweis: Jede Menge der Kostenermittlung ist die Summe einzelner Teile (Umrisse, Räume, Wand- und
 * Dachflächen). Dieselben Teile zeigt die Ansicht „Mengen prüfen“ im Grundriss bzw. im 3D-Modell – was
 * dort markiert ist, ist genau das, was gerechnet wird.
 */

/** Fläche im Grundriss eines Geschosses */
export interface PlanFlaeche {
  storeyId: string;
  points: Point[];
  loecher?: Point[][];
}

/** ebene Fläche im Raum (z = Höhe über ±0,00) */
export interface Flaeche3 {
  aussen: Point3[];
  loecher?: Point3[][];
  /** Index des Geschosses in project.storeys (zum Auseinanderziehen) */
  geschoss: number;
}

export interface Teil {
  id: string;
  /** Name des Geschosses; leer bei Angaben ohne Geschoss (Grundstück) */
  geschoss: string;
  bezeichnung: string;
  /** Rechenansatz, z. B. „135,00 m² × 3,45 m“ */
  ansatz?: string;
  /** Beitrag zur Menge, Abzüge negativ */
  wert: number;
  plan?: PlanFlaeche[];
  raum?: Flaeche3[];
}

export interface MengeNachweis {
  bezug: MengenBezug;
  teile: Teil[];
  /** Summe der Teile = abgeleitete Menge */
  summe: number;
  /** übliche Darstellung: Grundrisse oder 3D-Modell */
  ansicht: 'plan' | 'raum';
  /** im Grundriss nur die Kanten zeigen (Wände) statt gefüllter Flächen */
  kanten?: boolean;
  /** Lageplan-Flächen als Hintergrund zeigen */
  lageplan?: boolean;
  hinweis?: string;
}

export interface GeschossInfo {
  id: string;
  name: string;
  /** OK Fußboden über ±0,00 */
  hoehe: number;
}

export interface Nachweis {
  mengen: Record<MengenBezug, MengeNachweis>;
  /** Hülle aller BGF-Umrisse (ohne Abzugsflächen) als Bezug für die 3D-Ansicht */
  koerper: Flaeche3[];
  geschosse: GeschossInfo[];
}

/** Höhe [m], ab der ein Geschoss als „über“ einer Dachfläche liegend gilt (Toleranz für Deckenaufbauten) */
const UEBERDECKT_TOLERANZ = 0.5;
/** Versatz [m] zwischen den Umrissen übereinanderliegender Geschosse (unterschiedliche Wandstärken), bis zu dem ein Streifen nicht als Dachfläche zählt */
const VERSATZ = 0.25;
/** Raster des Höhenfelds bei Dächern aus dem Gebäudemodell */
const RASTER = 40;

/** Fläche eines ebenen 3D-Polygons (Newell) */
export function flaeche3(poly: Point3[]): number {
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

const inhalt = (f: Flaeche3) => flaeche3(f.aussen) - (f.loecher ?? []).reduce((a, l) => a + flaeche3(l), 0);
const heben = (poly: Point3[], dz: number): Point3[] => poly.map((p) => ({ x: p.x, y: p.y, z: p.z + dz }));
const ring = (pts: Point[]): [number, number][] => pts.map((p) => [p.x, p.y]);
const umrissName = (s: OutlineShape) => `${s.name || 'BGF-Umriss'} (${s.umschliessung})${s.subtract ? ' – Abzug' : ''}`;
const raumName = (r: RoomShape) => `${[r.nummer, r.name].filter(Boolean).join(' ') || 'Raum'}${r.subtract ? ' – Abzug' : ''}`;

/** Körper des Rauminhalts – dieselbe Geometrie, aus der der Flächenrechner den BRI ermittelt */
function koerperVon(project: Project, storey: Storey, s: OutlineShape, floorZ: number): SolidFaces {
  if (s.dach?.typ === 'modell' && project.dachModell) return modellSolidFaces(project, storey, s, floorZ, RASTER);
  return solidFaces(s.points, s.dach, s.hoehe ?? storey.hoehe);
}

/**
 * Hülle für Außenwand und Dach. Bei einem Dach aus dem Gebäudemodell reicht der Körper des Rauminhalts überall
 * dort bis zur Dachhaut, wo das Geschoss darüber keine BGF hat – auch in schmalen Randstreifen, wenn das
 * Geschoss darüber etwas kleiner gezeichnet ist. Für Wand- und Dachflächen endet ein Geschoss deshalb
 * spätestens an seiner Geschosshöhe, sobald über ihm ein weiteres Geschoss mit BGF liegt.
 */
function huelleVon(project: Project, storey: Storey, s: OutlineShape, floorZ: number, geschossDarueber: boolean): SolidFaces | null {
  const modell = project.dachModell;
  if (s.dach?.typ !== 'modell' || !modell) return null;
  const h = s.hoehe ?? storey.hoehe;
  const cap = modellRoofParams(project, storey, s).cap;
  const capAt = typeof cap === 'function' ? cap : () => cap;
  const grenze = geschossDarueber ? h : Infinity;
  return heightFieldSolid(
    s.points,
    (p) => {
      const v = meshRoofHeightAt(modell, s.points, floorZ, p);
      return Math.min(Number.isNaN(v) ? h : Math.max(v, 0), capAt(p), grenze);
    },
    RASTER,
  );
}

function dachText(s: OutlineShape): string {
  if (!s.dach) return 'oberer Abschluss, eben';
  if (s.dach.typ === 'modell') return 'Dachhaut aus dem Gebäudemodell';
  const label = DACH_TYPEN.find((d) => d.id === s.dach!.typ)?.label ?? 'Dach';
  return s.dach.neigung ? `${label}, ${fmt2(s.dach.neigung).replace(/,00$/, '')}°` : label;
}

function berechneNachweis(project: Project, result: ProjectResult): Nachweis {
  const elev = storeyElevations(project);
  const storeys = project.storeys.map((s, i) => ({ s, i, e: elev[i] }));
  const reihenfolge = [...storeys].sort((a, b) => a.e - b.e);
  const bgfVon = (id: string) => result.storeys.find((x) => x.storeyId === id)?.bgf.total ?? 0;
  const umrisse = (s: Storey) => s.shapes.filter((x): x is OutlineShape => x.kind === 'outline' && x.points.length >= 3);
  const raeume = (s: Storey) => s.shapes.filter((x): x is RoomShape => x.kind === 'room' && x.points.length >= 3);

  const mengen = {} as Record<MengenBezug, MengeNachweis>;
  const neu = (bezug: MengenBezug, ansicht: 'plan' | 'raum', extra: Partial<MengeNachweis> = {}): MengeNachweis =>
    (mengen[bezug] = { bezug, teile: [], summe: 0, ansicht, ...extra });

  /* ---------- Grundflächen und Rauminhalt (DIN 277) ---------- */
  const bgf = neu('bgf', 'plan');
  const bri = neu('bri', 'raum');
  const koerper: Flaeche3[] = [];
  const huelleJe = new Map<string, SolidFaces>();
  for (const { s, i, e } of storeys) {
    const geschossDarueber = storeys.some((x) => x.i !== i && x.e >= e + s.hoehe - UEBERDECKT_TOLERANZ && bgfVon(x.s.id) > 0);
    for (const u of umrisse(s)) {
      const sign = u.subtract ? -1 : 1;
      const a = polygonArea(u.points);
      const plan = [{ storeyId: s.id, points: u.points }];
      bgf.teile.push({ id: `bgf-${u.id}`, geschoss: s.name, bezeichnung: umrissName(u), wert: sign * a, plan });
      const f = koerperVon(project, s, u, e);
      const huelle = huelleVon(project, s, u, e, geschossDarueber) ?? f;
      huelleJe.set(u.id, huelle);
      const flaechen: Flaeche3[] = [...f.tops, ...f.sides, f.bottom].map((p) => ({ aussen: heben(p, e), geschoss: i }));
      if (!u.subtract) koerper.push(...[...huelle.tops, ...huelle.sides, huelle.bottom].map((p) => ({ aussen: heben(p, e), geschoss: i })));
      const h = u.hoehe ?? s.hoehe;
      bri.teile.push({
        id: `bri-${u.id}`,
        geschoss: s.name,
        bezeichnung: umrissName(u),
        ansatz: u.dach ? `${fmt2(a)} m², bis zur Dachhaut (${dachText(u)})` : `${fmt2(a)} m² × ${fmt2(h)} m`,
        wert: sign * outlineVolume(u, s, project),
        plan,
        raum: flaechen,
      });
    }
  }

  const nrf = neu('nrf', 'plan');
  const nuf = neu('nuf', 'plan');
  const tf = neu('tf', 'plan');
  const vf = neu('vf', 'plan');
  const wofl = neu('wofl', 'plan');
  for (const { s } of storeys) {
    for (const r of raeume(s)) {
      const sign = r.subtract ? -1 : 1;
      const a = sign * roomArea(r);
      const info = nutzungInfo(r.nutzung);
      const plan = [{ storeyId: s.id, points: r.points }];
      const teil: Teil = {
        id: r.id,
        geschoss: s.name,
        bezeichnung: `${raumName(r)} · ${info.kurz}`,
        ansatz: r.putzabzug ? `${fmt2(polygonArea(r.points))} m² − ${fmt2(r.putzabzug).replace(/,00$/, '')} % Putz` : undefined,
        wert: a,
        plan,
      };
      nrf.teile.push({ ...teil, id: `nrf-${r.id}` });
      const bereich = info.bereich === 'NUF' ? nuf : info.bereich === 'TF' ? tf : vf;
      bereich.teile.push({ ...teil, id: `${bereich.bezug}-${r.id}` });
      if (r.wofl.kategorie !== 'keine') {
        const f = woflFaktor(r.wofl, project.settings);
        wofl.teile.push({
          id: `wofl-${r.id}`,
          geschoss: s.name,
          bezeichnung: `${raumName(r)}${r.wofl.wohnung.trim() ? ` · ${r.wofl.wohnung.trim()}` : ''}`,
          ansatz: `${fmt2(a)} m² × ${Math.round(f * 100)} %`,
          wert: a * f,
          plan,
        });
      }
    }
  }

  /* ---------- Gründung, Baugrube, Decken ---------- */
  const unterstes = reihenfolge.find((x) => bgfVon(x.s.id) > 0) ?? reihenfolge[0];
  const tiefe = unterstes && unterstes.e < -0.2 ? -unterstes.e : 0;
  const grf = neu('grf', 'plan');
  const bgi = neu('bgi', 'plan');
  const def = neu('def', 'plan');
  for (const x of reihenfolge) {
    for (const u of umrisse(x.s)) {
      const a = (u.subtract ? -1 : 1) * polygonArea(u.points);
      const teil = { geschoss: x.s.name, bezeichnung: umrissName(u), plan: [{ storeyId: x.s.id, points: u.points }] };
      if (x === unterstes) {
        grf.teile.push({ ...teil, id: `grf-${u.id}`, wert: a });
        if (tiefe > 0) bgi.teile.push({ ...teil, id: `bgi-${u.id}`, ansatz: `${fmt2(a)} m² × ${fmt2(tiefe)} m`, wert: a * tiefe });
      } else def.teile.push({ ...teil, id: `def-${u.id}`, wert: a });
    }
  }
  if (unterstes) grf.hinweis = `Unterstes Geschoss mit BGF: ${unterstes.s.name}.`;
  bgi.hinweis =
    tiefe > 0
      ? `Gründungsfläche × Tiefe des Fußbodens von ${unterstes!.s.name} unter ±0,00 (${fmt2(tiefe)} m) – ohne Arbeitsraum und Böschung.`
      : 'Das unterste Geschoss liegt nicht unter ±0,00 – keine Baugrube abgeleitet.';
  if (unterstes) def.hinweis = `Alle Geschosse über ${unterstes.s.name}.`;

  /* ---------- Außenwände und Dach ---------- */
  // Grundriss „umschlossen“ (R, ohne Abzugsflächen) je Geschoss
  const rUmrisse = (s: Storey) => umrisse(s).filter((u) => !u.subtract && u.umschliessung === 'R');
  const innen = (s: Storey, p: Point) =>
    rUmrisse(s).some((u) => pointInPolygon(p, u.points)) && !umrisse(s).some((u) => u.subtract && pointInPolygon(p, u.points));

  const awf = neu('awf', 'raum', { kanten: true });
  const daf = neu('daf', 'raum');
  for (const { s, i, e } of storeys) {
    const geschossDarueber = storeys.some((x) => x.i !== i && x.e >= e + s.hoehe - UEBERDECKT_TOLERANZ && bgfVon(x.s.id) > 0);
    // was liegt über einer ebenen Fläche in Höhe z? R-Umrisse aller Geschosse, deren Fußboden dort oder darüber liegt
    const darueber = (z: number) => storeys.filter((x) => x.i !== i && x.e >= z - UEBERDECKT_TOLERANZ).flatMap((x) => rUmrisse(x.s).map((u) => u.points));

    for (const u of rUmrisse(s)) {
      const f = huelleJe.get(u.id)!;
      const plan = [{ storeyId: s.id, points: u.points }];

      // Außenwand: senkrechte Flächen, auf deren einer Seite kein umschlossener Grundriss liegt
      const waende: Flaeche3[] = [];
      let innenliegend = 0;
      const h = u.hoehe ?? s.hoehe;
      if (!u.dach) {
        // ebener Abschluss: jede Kante abschnittsweise – wo ein anderer Umriss anliegt, bleibt nur der Teil über dessen Höhe
        const andere = rUmrisse(s).filter((v) => v !== u);
        for (let k = 0; k < u.points.length; k++) {
          const a = u.points[k];
          const b = u.points[(k + 1) % u.points.length];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 1e-9) continue;
          const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
          // Teilungspunkte: Ecken anderer Umrisse, die auf dieser Kante liegen
          const ts = [0, len];
          for (const v of andere) {
            for (const p of v.points) {
              const t = (p.x - a.x) * d.x + (p.y - a.y) * d.y;
              const quer = Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x);
              if (quer < 1e-6 && t > 1e-6 && t < len - 1e-6) ts.push(t);
            }
          }
          ts.sort((x, y) => x - y);
          for (let j = 0; j + 1 < ts.length; j++) {
            const [t0, t1] = [ts[j], ts[j + 1]];
            if (t1 - t0 < 1e-6) continue;
            const m = { x: a.x + d.x * ((t0 + t1) / 2), y: a.y + d.y * ((t0 + t1) / 2) };
            const seiten = [
              { x: m.x - d.y * 0.05, y: m.y + d.x * 0.05 },
              { x: m.x + d.y * 0.05, y: m.y - d.x * 0.05 },
            ];
            let ab = 0;
            if (seiten.every((q) => innen(s, q))) {
              // Höhe des anliegenden Körpers (mit Dach: mindestens so hoch wie diese Wand)
              const nachbar = andere.find((v) => seiten.some((q) => pointInPolygon(q, v.points)));
              ab = Math.min(h, nachbar && !nachbar.dach ? (nachbar.hoehe ?? s.hoehe) : h);
              innenliegend++;
            }
            if (h - ab < 1e-9) continue;
            const p0 = { x: a.x + d.x * t0, y: a.y + d.y * t0 };
            const p1 = { x: a.x + d.x * t1, y: a.y + d.y * t1 };
            waende.push({
              aussen: [
                { ...p0, z: e + ab },
                { ...p0, z: e + h },
                { ...p1, z: e + h },
                { ...p1, z: e + ab },
              ],
              geschoss: i,
            });
          }
        }
      } else {
        // mit Dach: Wandflächen des Körpers; eine Fläche zwischen zwei umschlossenen Grundrissen zählt nicht
        for (const w of f.sides) {
          const fuss = w.filter((p) => Math.abs(p.z) < 1e-9);
          if (fuss.length >= 2) {
            const a = fuss[0];
            const b = fuss[fuss.length - 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len > 1e-9) {
              const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              const n = { x: (-(b.y - a.y) / len) * 0.05, y: ((b.x - a.x) / len) * 0.05 };
              if (innen(s, { x: m.x + n.x, y: m.y + n.y }) && innen(s, { x: m.x - n.x, y: m.y - n.y })) {
                innenliegend++;
                continue;
              }
            }
          }
          waende.push({ aussen: heben(w, e), geschoss: i });
        }
      }
      const wandflaeche = waende.reduce((a, w) => a + inhalt(w), 0);
      if (wandflaeche > 1e-9) {
        const prisma = !u.dach && !innenliegend;
        awf.teile.push({
          id: `awf-${u.id}`,
          geschoss: s.name,
          bezeichnung: umrissName(u),
          ansatz: prisma
            ? `Umfang ${fmt2(perimeter(u.points))} m × ${fmt2(h)} m`
            : `${!u.dach ? `Höhe ${fmt2(h)} m` : u.dach.typ === 'modell' && geschossDarueber ? `Außenwände bis zur Geschosshöhe (${fmt2(h)} m), niedrigere Dachhaut berücksichtigt` : 'Außenwände bis zur Dachhaut'}${innenliegend ? `, ohne ${innenliegend} ${innenliegend > 1 ? 'Abschnitte' : 'Abschnitt'} an anderen Umrissen` : ''}`,
          wert: wandflaeche,
          plan,
          raum: waende,
        });
      }

      // Dach: Oberseiten des Körpers, soweit kein Geschoss darüber liegt
      const dach: Flaeche3[] = [];
      let ueberbaut = false;
      for (const t of f.tops) {
        const eben = t.every((p) => Math.abs(p.z - t[0].z) < 1e-6);
        const oben = eben ? darueber(e + t[0].z) : [];
        if (!oben.length) {
          dach.push({ aussen: heben(t, e), geschoss: i });
          continue;
        }
        const z = e + t[0].z;
        const flach = t.map((p) => ({ x: p.x, y: p.y }));
        if (polygonArea(flach) < 1) {
          // kleine Zellen (Dach aus Modell): nach dem Schwerpunkt entscheiden
          const c = { x: flach.reduce((a, p) => a + p.x, 0) / flach.length, y: flach.reduce((a, p) => a + p.y, 0) / flach.length };
          if (oben.some((q) => pointInPolygon(c, q) || distanceToEdges(c, q) <= VERSATZ)) ueberbaut = true;
          else dach.push({ aussen: heben(t, e), geschoss: i });
          continue;
        }
        try {
          const rest = pc.difference([ring(flach)], ...oben.map((q) => [ring(q)]));
          const vorher = dach.length;
          for (const poly of rest) {
            const [aussen, ...loecher] = poly.map((r) => r.slice(0, -1).map(([x, y]) => ({ x, y, z })));
            const fl: Flaeche3 = { aussen, loecher: loecher.length ? loecher : undefined, geschoss: i };
            const a = inhalt(fl);
            const umfang = perimeter(aussen);
            if (a < 1e-6 || (2 * a) / umfang < VERSATZ) continue;
            dach.push(fl);
          }
          const frei = dach.slice(vorher).reduce((a, d) => a + inhalt(d), 0);
          if (frei < polygonArea(flach) - 1e-6) ueberbaut = true;
        } catch {
          dach.push({ aussen: heben(t, e), geschoss: i });
        }
      }
      const dachflaeche = dach.reduce((a, d) => a + inhalt(d), 0);
      if (dachflaeche > 1e-9) {
        daf.teile.push({
          id: `daf-${u.id}`,
          geschoss: s.name,
          bezeichnung: umrissName(u),
          ansatz: `${dachText(u)}${ueberbaut ? ', abzüglich überbauter Fläche' : ''}`,
          wert: dachflaeche,
          plan,
          raum: dach,
        });
      }
    }
  }
  awf.hinweis =
    'Senkrechte Außenflächen der umschlossenen BGF-Körper (R), einschließlich Öffnungen und erdberührter Wände: bis zur Geschosshöhe, im obersten Geschoss bis zur Dachhaut. Wände zwischen aneinanderliegenden Umrissen zählen nicht.';
  daf.hinweis =
    'Oberseiten der umschlossenen BGF-Körper (R), geneigte Flächen in wahrer Größe; ebene Flächen nur, soweit kein Geschoss darüber liegt (Versätze bis 25 cm zwischen den Geschossen zählen nicht). Ohne Dachüberstände.';

  /* ---------- Innenwände ---------- */
  const iwf = neu('iwf', 'plan', { kanten: true });
  for (const { s } of storeys) {
    const rr = raeume(s).filter((r) => !r.subtract);
    const raumumfang = rr.reduce((a, r) => a + perimeter(r.points), 0);
    if (raumumfang <= 0) continue;
    const aussen = rUmrisse(s).reduce((a, u) => a + perimeter(u.points), 0);
    iwf.teile.push({
      id: `iwf-${s.id}`,
      geschoss: s.name,
      bezeichnung: `${rr.length} ${rr.length === 1 ? 'Raum' : 'Räume'}`,
      ansatz: `(Σ Raumumfänge ${fmt2(raumumfang)} m − Außenumfang ${fmt2(aussen)} m) / 2 × ${fmt2(s.hoehe)} m`,
      wert: (Math.max(0, raumumfang - aussen) / 2) * s.hoehe,
      plan: rr.map((r) => ({ storeyId: s.id, points: r.points })),
    });
  }
  iwf.hinweis = 'Grobe Näherung aus den Raumumrissen: Jede Innenwand liegt an zwei Räumen, die Außenwand nur an einem. Nur für Geschosse mit erfassten Räumen.';

  /* ---------- Grundstück und Außenanlagen ---------- */
  const fbgWert = project.meta.grundstueck.flaeche ?? 0;
  const fbg = neu('fbg', 'plan', { lageplan: true });
  const auf = neu('auf', 'plan', { lageplan: true });
  if (fbgWert > 0) {
    fbg.teile.push({ id: 'fbg', geschoss: '', bezeichnung: 'Grundstücksfläche laut Projektdaten', wert: fbgWert });
    auf.teile.push({ id: 'auf-fbg', geschoss: '', bezeichnung: 'Grundstücksfläche laut Projektdaten', wert: fbgWert });
    // überbaute Fläche: Geschoss mit der größten BGF ab Geländehöhe (sonst das unterste)
    const oberirdisch = reihenfolge.filter((x) => x.e >= -0.5 && bgfVon(x.s.id) > 0);
    const groesstes = oberirdisch.length ? oberirdisch.reduce((a, x) => (bgfVon(x.s.id) > bgfVon(a.s.id) ? x : a)) : unterstes;
    if (groesstes) {
      for (const u of umrisse(groesstes.s)) {
        auf.teile.push({
          id: `auf-${u.id}`,
          geschoss: groesstes.s.name,
          bezeichnung: `überbaut: ${umrissName(u)}`,
          wert: -(u.subtract ? -1 : 1) * polygonArea(u.points),
          plan: [{ storeyId: groesstes.s.id, points: u.points }],
        });
      }
      auf.hinweis = `Grundstücksfläche abzüglich der überbauten Fläche (${groesstes.s.name}: Geschoss mit der größten BGF ab Geländehöhe).`;
    }
  } else {
    fbg.hinweis = 'Die Grundstücksfläche fehlt in den Projektdaten.';
    auf.hinweis = 'Ohne Grundstücksfläche in den Projektdaten lässt sich die Außenanlagenfläche nicht ableiten.';
  }
  fbg.hinweis = fbg.hinweis ?? 'Die Grundstücksfläche stammt aus den Projektdaten (Flächenrechner) – sie hat keine eigene Geometrie.';

  /* ---------- Wohneinheiten ---------- */
  const we = neu('we', 'plan');
  const raumPlan = new Map<string, PlanFlaeche>();
  for (const { s } of storeys) for (const r of raeume(s)) raumPlan.set(r.id, { storeyId: s.id, points: r.points });
  for (const w of result.wohnungen) {
    if (!w.wohnung.trim()) continue;
    we.teile.push({
      id: `we-${w.wohnung}`,
      geschoss: [...new Set(w.rooms.map((r) => r.storeyName))].join(', '),
      bezeichnung: w.wohnung,
      ansatz: `${w.rooms.length} ${w.rooms.length === 1 ? 'Raum' : 'Räume'}, ${fmt2(w.wofl)} m² Wohnfläche`,
      wert: 1,
      plan: w.rooms.map((r) => raumPlan.get(r.shapeId)).filter((x): x is PlanFlaeche => !!x),
    });
  }
  we.hinweis = 'Wohnungen laut Zuordnung der Räume (WoFlV); Räume mit Wohnfläche ohne Zuordnung zählen zusammen als eine Einheit.';

  for (const m of Object.values(mengen)) m.summe = m.teile.reduce((a, t) => a + t.wert, 0);
  if (auf.summe < 0) {
    auf.summe = 0;
    auf.hinweis = 'Die überbaute Fläche ist größer als die Grundstücksfläche – bitte die Projektdaten prüfen.';
  }

  return { mengen, koerper, geschosse: storeys.map(({ s, e }) => ({ id: s.id, name: s.name, hoehe: e })) };
}

let zuletzt: { schluessel: unknown[]; nachweis: Nachweis } | null = null;

/**
 * Mengennachweis des Projekts. Das Ergebnis hängt nur von Gebäude und Grundstück ab und wird wiederverwendet,
 * solange sich daran nichts ändert (Kennwerte und Positionen ändern die Mengen nicht).
 */
export function mengenNachweis(project: Project, result?: ProjectResult): Nachweis {
  const schluessel = [project.storeys, project.dachModell, project.settings, project.meta.grundstueck.flaeche];
  if (zuletzt && zuletzt.schluessel.every((x, i) => x === schluessel[i])) return zuletzt.nachweis;
  const nachweis = berechneNachweis(project, result ?? computeProject(project));
  zuletzt = { schluessel, nachweis };
  return nachweis;
}
