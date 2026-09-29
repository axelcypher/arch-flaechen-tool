import { cleanupPolygon, fitEdges, simplifyClosed, traceOuterContour } from './detect';
import type { Point } from './geometry';
import { distanceToEdges, pointInPolygon, polygonArea, signedArea } from './geometry';
import { nutzungAusText, versiegelungAusText } from './lageplan';
import { clipHalfPlane } from './roof';
import type { IfcExtract, IfcMeshPart } from './ifcData';
import type { DxfPolyline, FlaecheShape, Nutzungsgruppe, OutlineShape, Storey, VectorBackground } from './model';
import { createFlaeche, createOutline, createProject, createRoom, createStorey } from './model';
import { modellRoofParams } from './calc';
import type { DachModell } from './roofMesh';
import { meshRoofStats } from './roofMesh';
import { dachAusModell } from './roofFit';
import { woflArt } from './norms';
import { SegmentGrid } from './spatial';

/**
 * Baut aus IFC-Rohdaten Geschosse, Räume (aus IfcSpace/Archicad-Zonen), BGF-Umrisse
 * (Außenkontur der Bauteile je Geschoss) und das Dach-Höhenfeld für den BRI.
 */

export interface IfcImportOptions {
  rooms: boolean;
  outlines: boolean;
  roof: boolean;
  /** alle Räume als Wohnfläche (100 %) anrechnen, Wohnung = Geschossname */
  wohnflaeche: boolean;
  /** Geschossschnitt als Vektorplan hinterlegen (Schnitthöhe über Fußboden in m, 0/undefiniert = aus) */
  planSchnitthoehe?: number;
  /** Dachform und Gauben aus dem Modell ableiten (für BRI-Formeln); sonst Dach als Höhenfeld */
  dachform?: boolean;
}

export interface IfcImportResult {
  storeys: Storey[];
  dachModell?: DachModell;
  report: string[];
}

/** Bauteile, deren Grundriss die BGF-Außenkontur bildet */
const OUTLINE_TYPES = new Set([
  'IFCWALL',
  'IFCWALLSTANDARDCASE',
  'IFCWALLELEMENTEDCASE',
  'IFCCOLUMN',
  'IFCCURTAINWALL',
]);
/** Öffnungen: schließen nur Wandlücken (z. B. raumhohe Fenster), bilden aber nie die Außenkante */
const OPENING_TYPES = new Set(['IFCWINDOW', 'IFCDOOR']);
/** nur als Teil einer Vorhangfassade (sonst z. B. Sparren im Dachüberstand) */
const CURTAIN_PARTS = new Set(['IFCPLATE', 'IFCMEMBER']);
/** Bauteile, die nach ihrem Namen eine Gaube sind */
const GAUBE_NAME = /gaube|dormer/i;
const istGaube = (e: IfcMeshPart) => GAUBE_NAME.test(e.name) || GAUBE_NAME.test(e.predefinedType);
/** Dachbauteile; Gauben als Bibliotheksobjekt (z. B. Archicad → IfcBuildingElementProxy „Gaube“) gehören dazu */
const isRoofPart = (e: IfcMeshPart) =>
  e.type === 'IFCROOF' || (e.type === 'IFCSLAB' && e.predefinedType === 'ROOF') || (e.type === 'IFCCOVERING' && e.predefinedType === 'ROOFING') || istGaube(e);
const isOutlinePart = (e: IfcMeshPart) => OUTLINE_TYPES.has(e.type) || (CURTAIN_PARTS.has(e.type) && e.parentType === 'IFCCURTAINWALL');

/** Geschoss, in dem der Lageplan gezeichnet ist (Archicad: eigenes Geschoss, meist auf Höhe des UG) */
export const LAGEPLAN_NAME = /lageplan/i;

export function buildFromIfc(x: IfcExtract, o: IfcImportOptions): IfcImportResult {
  const report: string[] = [];
  const order = x.storeys.map((s, i) => ({ ...s, i, lageplan: LAGEPLAN_NAME.test(s.name) })).sort((a, b) => a.elevation - b.elevation);
  const storeys: Storey[] = [];
  const storeyByIfcIndex = new Map<number, Storey>();

  order.forEach((s) => {
    if (s.lageplan) {
      // kein Gebäudegeschoss: keine Höhe, keine BGF
      const st = createStorey(s.name, 0);
      st.elevation = round(s.elevation, 3);
      st.lageplan = true;
      storeys.push(st);
      storeyByIfcIndex.set(s.i, st);
      return;
    }
    // nächstes Geschoss mit höherer Kote (Geschosse auf gleicher Höhe und der Lageplan zählen nicht)
    const next = order.find((o) => !o.lageplan && o.elevation > s.elevation + 1e-6);
    let h = next ? next.elevation - s.elevation : NaN;
    if (!next) {
      // oberstes Geschoss: Oberkante der Wände, sonst 3 m
      let top = -Infinity;
      for (const e of x.elements) {
        if (e.storey !== s.i || !e.type.startsWith('IFCWALL')) continue;
        for (let j = 2; j < e.tris.length; j += 3) top = Math.max(top, e.tris[j]);
      }
      h = top - s.elevation > 1.5 ? top - s.elevation : 3;
    }
    const st = createStorey(s.name, round(Math.max(h, 0.1), 3));
    st.elevation = round(s.elevation, 3);
    storeys.push(st);
    storeyByIfcIndex.set(s.i, st);
  });
  if (!storeys.length) {
    const st = createStorey('EG', 3);
    st.elevation = 0;
    storeys.push(st);
    report.push('Keine Geschosse (IfcBuildingStorey) gefunden – alles wurde einem Geschoss zugeordnet.');
  }
  const storeyFor = (i: number) => storeyByIfcIndex.get(i) ?? storeys[0];

  // Geschossschnitt als hinterlegter Plan
  if (o.planSchnitthoehe && o.planSchnitthoehe > 0) {
    let n = 0;
    for (const st of storeys) {
      const cut = (st.elevation ?? 0) + o.planSchnitthoehe;
      const bg = sectionPlan(x.elements, cut, `IFC-Schnitt +${o.planSchnitthoehe.toFixed(2).replace('.', ',')} m`);
      if (bg) {
        st.background = bg;
        n++;
      }
    }
    report.push(`${n} Geschossschnitte (${o.planSchnitthoehe.toFixed(2).replace('.', ',')} m über Fußboden) als Plan hinterlegt – Fang und „Erkennen“ arbeiten darauf.`);
  }

  // Räume
  if (o.rooms) {
    let n = 0;
    let putz = 0;
    let keineWofl = 0;
    for (const sp of x.spaces) {
      if (storeyFor(sp.storey).lageplan) continue; // Zonen im Lageplan werden Lageplan-Flächen
      const pts = footprintFromTriangles(sp.tris);
      if (!pts) {
        report.push(`Raum „${sp.longName || sp.name}“: Grundfläche konnte nicht ermittelt werden.`);
        continue;
      }
      const st = storeyFor(sp.storey);
      const room = createRoom(pts, sp.name, sp.longName || sp.name);
      room.nutzung = guessNutzung(room.name);
      const geo = polygonArea(pts);
      const notes: string[] = [];
      // Archicad-Zonen: Nettofläche mit 3 % Putzabzug bei Rohbaumaßen → übernehmen
      if (sp.netFloorArea !== undefined && geo > 0) {
        const r = sp.netFloorArea / geo;
        if (r > 0.94 && r < 0.998) {
          room.putzabzug = round((1 - r) * 100, 1);
          putz++;
        } else if (Math.abs(r - 1) >= 0.002) notes.push(`IFC-Nettofläche ${fmt(sp.netFloorArea)} m²`);
      }
      // lichte Höhen aus dem Raumkörper (Dachschrägen) für die WoFlV
      const hc = heightClasses(sp.tris);
      if (hc && hc.a2 < 0.995) notes.push(`lichte Höhe ≥ 2 m: ${fmt(hc.a2 * 100, 0)} %, 1–2 m: ${fmt(hc.a12 * 100, 0)} %, < 1 m: ${fmt(hc.a01 * 100, 0)} %`);
      if (o.wohnflaeche) {
        const art = woflArt(room.name, st.name, room.nutzung);
        if (art === 'freisitz') room.wofl = { kategorie: 'freisitz', wohnung: st.name };
        else if (art === 'wohnen')
          room.wofl =
            hc && hc.a2 < 0.995
              ? { kategorie: 'individuell', faktor: round(hc.a2 + 0.5 * hc.a12, 4), wohnung: st.name }
              : { kategorie: 'voll', wohnung: st.name };
        else keineWofl++;
      }
      if (notes.length) room.bemerkung = notes.join('; ');
      st.shapes.push(room);
      n++;
    }
    report.push(`${n} Räume aus IFC-Zonen übernommen.`);
    if (o.wohnflaeche && keineWofl) report.push(`${keineWofl} Räume nicht als Wohnfläche angerechnet (Keller, Technik, Treppenhaus, Garage, Dachboden …) – bei Bedarf im Raum ändern.`);
    if (putz) report.push(`${putz} Räume mit Putzabzug aus Archicad (Nettofläche aus Rohbaumaßen) übernommen.`);
  }

  // BGF-Umrisse
  if (o.outlines) {
    const gebaeude = order.filter((s) => !s.lageplan);
    gebaeude.forEach((s, k) => {
      const st = storeyFor(s.i);
      const parts = x.elements.filter((e) => e.storey === s.i && isOutlinePart(e));
      const openings = x.elements.filter((e) => e.storey === s.i && OPENING_TYPES.has(e.type)).map((e) => e.tris);
      const spaceTris = x.spaces.filter((sp) => sp.storey === s.i).map((sp) => sp.tris);
      const partTris = parts.map((p) => p.tris).concat(spaceTris);
      let outlines = outlinesFromParts(partTris, openings);
      // Dachgeschoss: BGF bis dorthin, wo die Dachhaut die Fußbodenebene schneidet (nicht nur bis zu den Drempel-/Innenwänden)
      const below = k > 0 ? storeyFor(gebaeude[k - 1].i).shapes.filter((x): x is OutlineShape => x.kind === 'outline' && !x.subtract).map((x) => x.points) : [];
      const dach = dachUeberFussboden(x.elements.filter((e) => e.storey === s.i && isRoofPart(e)), s.elevation);
      if (outlines.length && below.length && dach.length && anteilUeberdeckt(outlines, dach) > 0.5) {
        const vorher = outlines.reduce((a, q) => a + polygonArea(q), 0);
        const erweitert = outlinesFromParts(partTris, openings, { flaechen: dach, innerhalb: below });
        const nachher = erweitert.reduce((a, q) => a + polygonArea(q), 0);
        if (nachher > vorher + 0.5) {
          outlines = erweitert;
          report.push(`${st.name}: BGF bis zur Dachhaut erweitert (+${fmt(nachher - vorher)} m² gegenüber den Wänden).`);
        }
      }
      outlines.forEach((pts, k) => {
        const ol: OutlineShape = createOutline(pts, outlines.length > 1 ? `BGF ${k + 1}` : 'BGF');
        st.shapes.unshift(ol);
      });
      if (!outlines.length) report.push(`${st.name}: keine Wände/Stützen gefunden – kein BGF-Umriss erzeugt.`);
    });
  }

  // Dach aus Modell
  let dachModell: DachModell | undefined;
  if (o.roof) {
    const roofParts = x.elements.filter(isRoofPart);
    const tris = upwardTriangles(roofParts);
    // Wände und Fenster zum Vermessen der Gauben
    const waende = o.dachform ? x.elements.filter((e) => e.type.startsWith('IFCWALL') || e.type === 'IFCWINDOW' || istGaube(e)).map((e) => e.tris) : [];
    if (tris.length) {
      dachModell = { name: 'IFC-Dach', triangles: tris };
      const tmp = createProject();
      tmp.storeys = storeys;
      tmp.dachModell = dachModell;
      storeys.forEach((st) => {
        for (const s of st.shapes) {
          if (s.kind !== 'outline') continue;
          const probe: OutlineShape = { ...s, dach: { typ: 'modell', traufhoehe: st.hoehe, neigung: 0 } };
          const r = modellRoofParams(tmp, st, probe);
          const m = meshRoofStats(dachModell!, s.points, r.floorZ, st.hoehe, r.cap);
          const full = polygonArea(s.points) * st.hoehe;
          // nur dort, wo das Dach den Körper tatsächlich begrenzt oder darüber kein Geschoss mit BGF liegt
          if (m.abdeckung > 0.02 && Math.abs(m.volumen - full) > 0.01) s.dach = probe.dach;
          // oberster Abschluss: Dachform und Gauben erkennen, damit der BRI mit Formeln ausgewiesen werden kann
          if (o.dachform && s.dach?.typ === 'modell' && r.cap === Infinity) {
            const e = dachAusModell(dachModell!, s.points, r.floorZ, waende);
            if (e.dach) {
              s.dach = e.dach;
              report.push(`${st.name}: ${e.text} erkannt (Abweichung zum Modell ${(e.abweichung * 100).toFixed(1).replace('.', ',')} %).`);
            } else report.push(`${st.name}: Dachform nicht übernommen (${e.grund}) – BRI bis zur Dachhaut aus dem Modell.`);
          }
        }
      });
      // Geschosse ohne BGF (z. B. Spitzboden/Dachspitze als eigenes Geschoss)
      for (const st of storeys) {
        if (!st.lageplan && !st.shapes.some((s) => s.kind === 'outline')) {
          report.push(`${st.name}: ohne BGF-Umriss – der Rauminhalt darüber (z. B. Dachspitze) wird dem Geschoss darunter bis zur Dachhaut zugerechnet.`);
        }
      }
      report.push(`Dach aus ${roofParts.length} Dachbauteilen übernommen (BRI bis zur Dachhaut).`);
    } else report.push('Keine Dachbauteile (IfcRoof, IfcSlab.ROOF) gefunden – Dachform bei Bedarf manuell wählen.');
  }

  // Lageplan-Flächen: Bauteile und Zonen im Lageplan-Geschoss sowie das IFC-Gelände (IfcSite)
  lageplanFlaechen(x, storeys, storeyFor, report);

  return { storeys, dachModell, report };
}

/* ---------- Lageplan ---------- */

function lageplanFlaechen(x: IfcExtract, storeys: Storey[], storeyFor: (i: number) => Storey, report: string[]) {
  const quellen: { name: string; text: string; tris: ArrayLike<number> }[] = [];
  for (const e of x.elements) {
    const imLageplan = e.storey >= 0 && storeyFor(e.storey).lageplan;
    if (!(imLageplan || e.type === 'IFCSITE')) continue;
    if (e.type.startsWith('IFCFURNISHING') || e.type === 'IFCOPENINGELEMENT') continue;
    quellen.push({ name: e.name || e.type, text: `${e.name} ${e.predefinedType} ${e.type === 'IFCSITE' ? '' : e.type}`, tris: e.tris });
  }
  for (const sp of x.spaces) {
    if (!storeyFor(sp.storey).lageplan) continue;
    quellen.push({ name: sp.longName || sp.name, text: `${sp.name} ${sp.longName}`, tris: sp.tris });
  }
  if (!quellen.length) return;

  let lp = storeys.find((s) => s.lageplan);
  if (!lp) {
    // IFC-Gelände ohne eigenes Lageplan-Geschoss
    lp = createStorey('Lageplan', 0);
    lp.lageplan = true;
    lp.elevation = Math.min(...storeys.map((s) => s.elevation ?? 0));
    storeys.unshift(lp);
  }
  const flaechen: FlaecheShape[] = [];
  for (const q of quellen) {
    const tris = Float32Array.from(q.tris as ArrayLike<number>);
    const hoehe = oberflaechenHoehe(tris);
    for (const pts of outlinesFromParts([tris])) {
      if (polygonArea(pts) < 0.2) continue;
      const nutzung = nutzungAusText(q.text);
      flaechen.push({ ...createFlaeche(pts, q.name), nutzung, versiegelung: versiegelungAusText(q.text, nutzung), ...(hoehe !== undefined ? { hoehe: round(hoehe, 3) } : {}) });
    }
  }
  // Nachbargrundstücke: Flächen ohne Verbindung zum Gebäude (auch über andere Flächen)
  const haus = storeys.filter((s) => !s.lageplan).flatMap((s) => s.shapes.filter((sh) => sh.kind === 'outline' && !sh.subtract).map((sh) => sh.points));
  let nachbarn = 0;
  if (haus.length) {
    const eigen = new Set<number>();
    const queue: Point[][] = [...haus];
    while (queue.length) {
      const a = queue.pop()!;
      flaechen.forEach((f, i) => {
        if (!eigen.has(i) && beruehren(a, f.points)) {
          eigen.add(i);
          queue.push(f.points);
        }
      });
    }
    flaechen.forEach((f, i) => {
      if (!eigen.has(i)) {
        f.nachbar = true;
        nachbarn++;
      }
    });
  }
  lp.shapes.push(...flaechen);
  report.push(
    `${lp.name}: ${flaechen.length} Lageplan-Flächen übernommen${nachbarn ? `, davon ${nachbarn} ohne Verbindung zum Gebäude als Nachbargrundstück markiert` : ''} – Nutzung und Versiegelung aus den Namen vorgeschlagen, bitte im GRZ/GFZ-Tab prüfen.`,
  );
}

/**
 * mittlere Höhe der Oberseite, flächengewichtet: ein Dreieck gehört zur Oberseite, wenn an seinem
 * Schwerpunkt kein anderes Dreieck höher liegt (unabhängig vom Umlaufsinn der Dreiecke)
 */
function oberflaechenHoehe(t: Float32Array): number | undefined {
  const tris: { a: number[]; b: number[]; c: number[]; area: number }[] = [];
  for (let i = 0; i + 8 < t.length; i += 9) {
    const a = [t[i], t[i + 1], t[i + 2]];
    const b = [t[i + 3], t[i + 4], t[i + 5]];
    const c = [t[i + 6], t[i + 7], t[i + 8]];
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    if (area > 1e-9) tris.push({ a, b, c, area });
  }
  const zAt = (tr: (typeof tris)[number], x: number, y: number) => {
    const { a, b, c } = tr;
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den;
    const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den;
    const l3 = 1 - l1 - l2;
    return l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6 ? l1 * a[2] + l2 * b[2] + l3 * c[2] : NaN;
  };
  let sum = 0;
  let w = 0;
  for (const tr of tris) {
    const x = (tr.a[0] + tr.b[0] + tr.c[0]) / 3;
    const y = (tr.a[1] + tr.b[1] + tr.c[1]) / 3;
    const z = (tr.a[2] + tr.b[2] + tr.c[2]) / 3;
    if (tris.some((o) => o !== tr && zAt(o, x, y) > z + 0.01)) continue;
    sum += z * tr.area;
    w += tr.area;
  }
  return w > 0 ? sum / w : undefined;
}

/** berühren oder überlappen sich zwei Polygone (5 cm Toleranz)? */
function beruehren(a: Point[], b: Point[]): boolean {
  const nah = (p: Point, q: Point[]) => pointInPolygon(p, q) || distanceToEdges(p, q) <= 0.05;
  return a.some((p) => nah(p, b)) || b.some((p) => nah(p, a));
}

/* ---------- Raumhöhen ---------- */

/**
 * Flächenanteile nach lichter Höhe, exakt aus den ebenen Deckenflächen des Raumkörpers:
 * jedes Deckendreieck wird an den Höhenlinien 1 m und 2 m über dem Boden geschnitten.
 */
export function heightClasses(tris: Float32Array): { a2: number; a12: number; a01: number } | null {
  let floor = Infinity;
  for (let k = 2; k < tris.length; k += 3) floor = Math.min(floor, tris[k]);
  let total = 0;
  let ge1 = 0;
  let ge2 = 0;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const P = [0, 1, 2].map((j) => ({ x: tris[i + j * 3], y: tris[i + j * 3 + 1], z: tris[i + j * 3 + 2] - floor }));
    // Bodenflächen und senkrechte Flächen auslassen
    if ((P[0].z + P[1].z + P[2].z) / 3 < 0.05) continue;
    const det = (P[1].x - P[0].x) * (P[2].y - P[0].y) - (P[2].x - P[0].x) * (P[1].y - P[0].y);
    if (Math.abs(det) < 1e-9) continue;
    // Ebene z = a·x + b·y + c
    const a = ((P[1].z - P[0].z) * (P[2].y - P[0].y) - (P[2].z - P[0].z) * (P[1].y - P[0].y)) / det;
    const b = ((P[2].z - P[0].z) * (P[1].x - P[0].x) - (P[1].z - P[0].z) * (P[2].x - P[0].x)) / det;
    const c = P[0].z - a * P[0].x - b * P[0].y;
    const poly = P.map((p) => ({ x: p.x, y: p.y }));
    total += polygonArea(poly);
    ge1 += polygonArea(clipHalfPlane(poly, [-a, -b, 1 - c]));
    ge2 += polygonArea(clipHalfPlane(poly, [-a, -b, 2 - c]));
  }
  if (total < 1e-9) return null;
  return { a2: ge2 / total, a12: (ge1 - ge2) / total, a01: (total - ge1) / total };
}

const fmt = (v: number, d = 2) => v.toFixed(d).replace('.', ',');

/* ---------- Grundfläche eines Raums ---------- */

/**
 * Grundfläche aus einem Raumkörper: Randkanten der nach unten zeigenden Bodendreiecke,
 * zu Linienzügen verkettet; der größte ist der Umriss.
 */
export function footprintFromTriangles(t: Float32Array): Point[] | null {
  let minZ = Infinity;
  for (let k = 2; k < t.length; k += 3) minZ = Math.min(minZ, t[k]);
  const key = (x: number, y: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
  const edges = new Map<string, { a: Point; b: Point; ka: string; kb: string; n: number }>();
  for (let i = 0; i + 8 < t.length; i += 9) {
    const z = [t[i + 2], t[i + 5], t[i + 8]];
    if (z.some((v) => Math.abs(v - minZ) > 0.02)) continue;
    const p = [0, 1, 2].map((j) => ({ x: t[i + j * 3], y: t[i + j * 3 + 1] }));
    if (Math.abs(signedArea(p)) < 1e-10) continue;
    for (let j = 0; j < 3; j++) {
      const a = p[j];
      const b = p[(j + 1) % 3];
      const ka = key(a.x, a.y);
      const kb = key(b.x, b.y);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = edges.get(id);
      if (e) e.n++;
      else edges.set(id, { a, b, ka, kb, n: 1 });
    }
  }
  const boundary = [...edges.values()].filter((e) => e.n === 1);
  if (boundary.length < 3) return null;
  // ungerichtet verketten
  const adj = new Map<string, { p: Point; other: string; id: number }[]>();
  boundary.forEach((e, id) => {
    if (!adj.has(e.ka)) adj.set(e.ka, []);
    if (!adj.has(e.kb)) adj.set(e.kb, []);
    adj.get(e.ka)!.push({ p: e.b, other: e.kb, id });
    adj.get(e.kb)!.push({ p: e.a, other: e.ka, id });
  });
  const used = new Set<number>();
  let best: Point[] | null = null;
  let bestA = 0;
  for (let s = 0; s < boundary.length; s++) {
    if (used.has(s)) continue;
    const loop: Point[] = [boundary[s].a];
    used.add(s);
    let cur = boundary[s].kb;
    let curP = boundary[s].b;
    const start = boundary[s].ka;
    for (let guard = 0; guard < boundary.length + 2 && cur !== start; guard++) {
      loop.push(curP);
      const nx = adj.get(cur)?.find((c) => !used.has(c.id));
      if (!nx) break;
      used.add(nx.id);
      cur = nx.other;
      curP = nx.p;
    }
    const a = Math.abs(signedArea(loop));
    if (loop.length >= 3 && a > bestA) {
      bestA = a;
      best = loop;
    }
  }
  if (!best) return null;
  const clean = cleanupPolygon(best.map((p) => ({ x: round(p.x, 4), y: round(p.y, 4) })));
  return clean.length >= 3 ? orientCw(clean) : null;
}

/* ---------- BGF-Umriss aus Bauteilen ---------- */

/**
 * BGF-Außenkontur aus Wänden, Stützen und Raumkörpern.
 * Fenster und Türen (openings) zählen nur dort, wo sie eine Lücke zwischen zwei Wandstücken schließen
 * (raumhohe Öffnungen ohne Sturz); Fensterbänke und Rahmen vor bzw. hinter der Fassade bleiben außen vor,
 * sonst entstehen Zacken in der Umrisslinie.
 */
export function outlinesFromParts(parts: Float32Array[], openings: Float32Array[] = [], erweiterung?: Erweiterung): Point[][] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of parts) {
    for (let k = 0; k < t.length; k += 3) {
      minX = Math.min(minX, t[k]);
      maxX = Math.max(maxX, t[k]);
      minY = Math.min(minY, t[k + 1]);
      maxY = Math.max(maxY, t[k + 1]);
    }
  }
  for (const pl of erweiterung?.innerhalb ?? []) {
    for (const p of pl) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return [];
  const size = Math.max(maxX - minX, maxY - minY);
  const res = Math.max(0.01, size / 2500);
  const pad = 3;
  const w = Math.ceil((maxX - minX) / res) + 2 * pad;
  const h = Math.ceil((maxY - minY) / res) + 2 * pad;
  const ox = minX - pad * res;
  const oy = minY - pad * res;
  const mask = new Uint8Array(w * h);
  const segs: number[] = [];
  for (const t of parts) {
    for (let i = 0; i + 8 < t.length; i += 9) {
      const ax = (t[i] - ox) / res;
      const ay = (t[i + 1] - oy) / res;
      const bx = (t[i + 3] - ox) / res;
      const by = (t[i + 4] - oy) / res;
      const cx = (t[i + 6] - ox) / res;
      const cy = (t[i + 7] - oy) / res;
      fillTriangle(mask, w, h, ax, ay, bx, by, cx, cy);
      // Kanten für die exakte Einpassung (senkrechte Flächen ergeben entartete Dreiecke → auslassen)
      const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area2) > 1e-6) segs.push(t[i], t[i + 1], t[i + 3], t[i + 4], t[i + 3], t[i + 4], t[i + 6], t[i + 7], t[i + 6], t[i + 7], t[i], t[i + 1]);
    }
  }
  if (openings.length) bridgeOpenings(mask, w, h, openings, ox, oy, res);
  if (erweiterung) {
    // Flächen unter der Dachhaut, soweit sie innerhalb des Geschosses darunter liegen
    const tmp = new Uint8Array(w * h);
    for (const pl of erweiterung.flaechen) {
      for (let k = 1; k + 1 < pl.length; k++) {
        const P = (p: Point) => [(p.x - ox) / res, (p.y - oy) / res] as const;
        const [ax, ay] = P(pl[0]);
        const [bx, by] = P(pl[k]);
        const [cx, cy] = P(pl[k + 1]);
        fillTriangle(tmp, w, h, ax, ay, bx, by, cx, cy);
      }
    }
    for (let q = 0; q < w * h; q++) {
      if (!tmp[q] || mask[q]) continue;
      const c = { x: ox + ((q % w) + 0.5) * res, y: oy + (Math.floor(q / w) + 0.5) * res };
      if (erweiterung.innerhalb.some((pl) => pointInPolygon(c, pl))) mask[q] = 1;
    }
    // Kanten des Geschosses darunter zum Einpassen
    for (const pl of erweiterung.innerhalb) for (let i = 0; i < pl.length; i++) segs.push(pl[i].x, pl[i].y, pl[(i + 1) % pl.length].x, pl[(i + 1) % pl.length].y);
  }
  // Löcher füllen: alles, was nicht von außen erreichbar ist, gehört zum Gebäude
  const outside = new Uint8Array(w * h);
  const stack: number[] = [0];
  outside[0] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) {
      if (j >= 0 && !outside[j] && !mask[j]) {
        outside[j] = 1;
        stack.push(j);
      }
    }
  }
  // Zusammenhangskomponenten des Gebäudes
  const label = new Int32Array(w * h).fill(-1);
  const grid = new SegmentGrid(segs);
  const result: Point[][] = [];
  let comp = 0;
  for (let s = 0; s < w * h; s++) {
    if (outside[s] || label[s] >= 0) continue;
    const sub = new Uint8Array(w * h);
    const st = [s];
    label[s] = comp;
    let count = 0;
    while (st.length) {
      const i = st.pop()!;
      sub[i] = 1;
      count++;
      const x = i % w;
      const y = (i - x) / w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j >= 0 && !outside[j] && label[j] < 0) {
          label[j] = comp;
          st.push(j);
        }
      }
    }
    comp++;
    if (count * res * res < 1) continue; // kleiner als 1 m² → ignorieren
    const contour = traceOuterContour(sub, w, h);
    const world = contour.map(([px, py]) => ({ x: ox + px * res, y: oy + py * res }));
    const simple = simplifyClosed(world, res * 1.6);
    const fitted = cleanupPolygon(fitEdges(simple, [grid], Math.max(res * 2.5, 0.02), res));
    const eben = rechtwinklig(fitted);
    if (eben.length >= 3) result.push(orientCw(eben.map((p) => ({ x: round(p.x, 4), y: round(p.y, 4) }))));
  }
  return result.sort((a, b) => polygonArea(b) - polygonArea(a));
}

export interface Erweiterung {
  /** Grundriss der Dachflächen, soweit die Dachhaut über der Fußbodenebene liegt */
  flaechen: Point[][];
  /** Umrisse des Geschosses darunter (Grenze der Erweiterung) */
  innerhalb: Point[][];
}

/** Teile der Dachflächen (Grundriss), deren Dachhaut auf oder über dem Fußboden (absolute Höhe) liegt – 2 cm Toleranz */
export function dachUeberFussboden(roofParts: IfcMeshPart[], floorZ: number): Point[][] {
  const t = upwardTriangles(roofParts);
  const out: Point[][] = [];
  for (let i = 0; i + 8 < t.length; i += 9) {
    const [x1, y1, z1, x2, y2, z2, x3, y3, z3] = t.slice(i, i + 9);
    const det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    if (Math.abs(det) < 1e-9) continue;
    const a = ((z2 - z1) * (y3 - y1) - (z3 - z1) * (y2 - y1)) / det;
    const b = ((z3 - z1) * (x2 - x1) - (z2 - z1) * (x3 - x1)) / det;
    const c = z1 - a * x1 - b * y1;
    // z ≥ floorZ − 0,02  ⇔  (floorZ − 0,02) − (a·x + b·y + c) ≤ 0
    const poly = clipHalfPlane(
      [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
        { x: x3, y: y3 },
      ],
      [-a, -b, floorZ - 0.02 - c],
    );
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

/** Anteil der Umrissfläche, über dem eine der Flächen liegt (Stichproben im 25-cm-Raster) */
function anteilUeberdeckt(outlines: Point[][], flaechen: Point[][]): number {
  let n = 0;
  let hit = 0;
  for (const pl of outlines) {
    const xs = pl.map((p) => p.x);
    const ys = pl.map((p) => p.y);
    for (let x = Math.min(...xs) + 0.125; x < Math.max(...xs); x += 0.25) {
      for (let y = Math.min(...ys) + 0.125; y < Math.max(...ys); y += 0.25) {
        const p = { x, y };
        if (!pointInPolygon(p, pl)) continue;
        n++;
        if (flaechen.some((f) => pointInPolygon(p, f))) hit++;
      }
    }
  }
  return n ? hit / n : 0;
}

/**
 * Kanten, die höchstens tolDeg von der Hauptrichtung (längste Kante) bzw. der Senkrechten dazu abweichen,
 * exakt ausrichten und die Ecken neu schneiden. Modelle haben oft Abweichungen im Millimeterbereich –
 * so wird ein Rechteck auch als Rechteck erkannt (Dachformeln, L × B).
 */
export function rechtwinklig(pts: Point[], tolDeg = 0.5): Point[] {
  const n = pts.length;
  if (n < 3) return pts;
  const dir = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);
  let longest = 0;
  let haupt = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > longest) {
      longest = len;
      haupt = dir(a, b);
    }
  }
  const tol = (tolDeg * Math.PI) / 180;
  // Kante als Gerade: Punkt (Mitte) + Richtung
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    let r = dir(a, b);
    const k = Math.round((r - haupt) / (Math.PI / 2));
    const snapped = haupt + (k * Math.PI) / 2;
    if (Math.abs(r - snapped) <= tol) r = snapped;
    return { p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: { x: Math.cos(r), y: Math.sin(r) } };
  });
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    if (Math.abs(den) < 1e-9) {
      out.push(pts[i]);
      continue;
    }
    const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
    const q = { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
    // nur übernehmen, wenn sich die Ecke dabei kaum verschiebt
    out.push(Math.hypot(q.x - pts[i].x, q.y - pts[i].y) < 0.05 ? q : pts[i]);
  }
  return out;
}

/** größte Öffnungsbreite [m], die eine Öffnung zwischen zwei Wandstücken überbrücken darf */
const MAX_OEFFNUNG = 8;

/**
 * Zellen von Fenstern/Türen nur übernehmen, wenn sie in Zeilen- oder Spaltenrichtung auf beiden Seiten
 * innerhalb von MAX_OEFFNUNG an Wand grenzen – also in der Wandflucht liegen und eine Lücke schließen.
 */
function bridgeOpenings(mask: Uint8Array, w: number, h: number, openings: Float32Array[], ox: number, oy: number, res: number) {
  const open = new Uint8Array(w * h);
  for (const t of openings) {
    for (let i = 0; i + 8 < t.length; i += 9) {
      fillTriangle(open, w, h, (t[i] - ox) / res, (t[i + 1] - oy) / res, (t[i + 3] - ox) / res, (t[i + 4] - oy) / res, (t[i + 6] - ox) / res, (t[i + 7] - oy) / res);
    }
  }
  const reach = Math.ceil(MAX_OEFFNUNG / res);
  const hit = (x: number, y: number, dx: number, dy: number) => {
    for (let k = 1; k <= reach; k++) {
      const xx = x + dx * k;
      const yy = y + dy * k;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false;
      const q = yy * w + xx;
      if (mask[q]) return true;
      if (!open[q]) return false; // Lücke endet außerhalb der Öffnung → keine Wandflucht
    }
    return false;
  };
  const add: number[] = [];
  for (let q = 0; q < w * h; q++) {
    if (!open[q] || mask[q]) continue;
    const x = q % w;
    const y = (q - x) / w;
    if ((hit(x, y, -1, 0) && hit(x, y, 1, 0)) || (hit(x, y, 0, -1) && hit(x, y, 0, 1))) add.push(q);
  }
  for (const q of add) mask[q] = 1;
}

function fillTriangle(mask: Uint8Array, w: number, h: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(den) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const qx = px + 0.5;
      const qy = py + 0.5;
      const l1 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / den;
      const l2 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / den;
      if (l1 >= -1e-9 && l2 >= -1e-9 && 1 - l1 - l2 >= -1e-9) mask[py * w + px] = 1;
    }
  }
}

/* ---------- Dach ---------- */

/** Nicht senkrechte Dreiecke der Dachbauteile (flach als number[]); die Dachhaut ist ihr oberer Rand */
export function upwardTriangles(parts: IfcMeshPart[]): number[] {
  const out: number[] = [];
  for (const p of parts) {
    const t = p.tris;
    for (let i = 0; i + 8 < t.length; i += 9) {
      const ux = t[i + 3] - t[i];
      const uy = t[i + 4] - t[i + 1];
      const uz = t[i + 5] - t[i + 2];
      const vx = t[i + 6] - t[i];
      const vy = t[i + 7] - t[i + 1];
      const vz = t[i + 8] - t[i + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-10) continue;
      // senkrechte Flächen auslassen; Ober- und Unterseiten bleiben – das Höhenfeld nimmt ohnehin den höchsten Wert
      if (Math.abs(nz / len) < 0.05) continue;
      for (let k = 0; k < 9; k++) out.push(round(t[i + k], 4));
    }
  }
  return out;
}

/* ---------- Hilfsfunktionen ---------- */

const NUTZUNG_KEYWORDS: [RegExp, Nutzungsgruppe][] = [
  [/flur|diele|treppe|gang|korridor|aufzug|foyer|windfang|eingang|galerie|podest/i, 'VF'],
  [/technik|heiz|hausanschluss|elektro|lüftung|server|hwr|haustechnik/i, 'TF'],
  [/büro|buero|office|besprech|arbeitszimmer/i, 'NUF2'],
  [/lager|abstell|keller|archiv|garage|fahrrad|müll/i, 'NUF4'],
  [/wc|bad|dusche|sanitär|umkleide|garderobe/i, 'NUF7'],
];

export function guessNutzung(name: string): Nutzungsgruppe {
  for (const [re, n] of NUTZUNG_KEYWORDS) if (re.test(name)) return n;
  return 'NUF1';
}

function orientCw(pts: Point[]): Point[] {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts;
}

function round(v: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(v * f) / f + 0;
}


/* ---------- Geschossschnitt als Vektorplan ---------- */

const SECTION_LAYERS: { name: string; color: string; visible: boolean; match: (e: IfcMeshPart) => boolean }[] = [
  { name: 'Wände', color: '#1f2328', visible: true, match: (e) => e.type.startsWith('IFCWALL') || e.type === 'IFCCURTAINWALL' || e.parentType === 'IFCCURTAINWALL' },
  { name: 'Stützen/Träger', color: '#1f2328', visible: true, match: (e) => e.type === 'IFCCOLUMN' || e.type === 'IFCBEAM' },
  { name: 'Fenster', color: '#1f6fb2', visible: true, match: (e) => e.type === 'IFCWINDOW' },
  { name: 'Türen', color: '#9a5a17', visible: true, match: (e) => e.type === 'IFCDOOR' },
  { name: 'Treppen/Geländer', color: '#5b6068', visible: true, match: (e) => e.type.startsWith('IFCSTAIR') || e.type.startsWith('IFCRAMP') || e.type === 'IFCRAILING' },
  { name: 'Decken/Dach', color: '#8a8f99', visible: true, match: (e) => ['IFCSLAB', 'IFCROOF', 'IFCCOVERING', 'IFCMEMBER', 'IFCPLATE'].includes(e.type) },
  { name: 'Möblierung', color: '#a0a6ad', visible: false, match: (e) => e.type.startsWith('IFCFURNISHING') || e.type === 'IFCFURNITURE' },
  { name: 'Sonstiges', color: '#6b7280', visible: true, match: () => true },
];

/**
 * Horizontalschnitt durch das Modell auf absoluter Höhe cutZ – ergibt einen Grundriss
 * (Wände, Öffnungen, Treppen …) als Vektorplan in Metern, deckungsgleich mit den Projektkoordinaten.
 */
export function sectionPlan(elements: IfcMeshPart[], cutZ: number, name: string): VectorBackground | null {
  const segsByLayer = SECTION_LAYERS.map(() => [] as number[]);
  for (const e of elements) {
    if (e.type === 'IFCSITE') continue;
    const li = SECTION_LAYERS.findIndex((l) => l.match(e));
    const out = segsByLayer[li];
    const t = e.tris;
    for (let i = 0; i + 8 < t.length; i += 9) {
      const z0 = t[i + 2] - cutZ;
      const z1 = t[i + 5] - cutZ;
      const z2 = t[i + 8] - cutZ;
      if ((z0 > 0 && z1 > 0 && z2 > 0) || (z0 < 0 && z1 < 0 && z2 < 0)) continue;
      const pts: number[] = [];
      const edge = (a: number, za: number, b: number, zb: number) => {
        if ((za < 0 && zb >= 0) || (za >= 0 && zb < 0)) {
          const f = za / (za - zb);
          pts.push(t[a] + (t[b] - t[a]) * f, t[a + 1] + (t[b + 1] - t[a + 1]) * f);
        }
      };
      edge(i, z0, i + 3, z1);
      edge(i + 3, z1, i + 6, z2);
      edge(i + 6, z2, i, z0);
      if (pts.length === 4 && Math.hypot(pts[2] - pts[0], pts[3] - pts[1]) > 1e-4) out.push(...pts);
    }
  }
  const polylines: DxfPolyline[] = [];
  segsByLayer.forEach((segs, layer) => {
    for (const pl of chainSegments(segs)) polylines.push({ layer, pts: pl.pts, closed: pl.closed });
  });
  if (!polylines.length) return null;
  const used = new Set(polylines.map((p) => p.layer));
  // nur belegte Layer behalten (Indizes neu vergeben)
  const map = new Map<number, number>();
  const layers = SECTION_LAYERS.filter((_, i) => used.has(i)).map((l, k) => {
    map.set(SECTION_LAYERS.indexOf(l), k);
    return { name: l.name, color: l.color, visible: l.visible };
  });
  for (const p of polylines) p.layer = map.get(p.layer)!;
  return { type: 'vector', source: 'ifc', name, x: 0, y: 0, scale: 1, opacity: 0.85, visible: true, layers, polylines, texts: [] };
}

/** Segmente mit gemeinsamen Endpunkten zu Linienzügen verbinden, kollineare Zwischenpunkte entfernen */
export function chainSegments(segs: number[]): { pts: number[]; closed: boolean }[] {
  const key = (x: number, y: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
  const n = segs.length / 4;
  const seen = new Set<string>();
  const ends = new Map<string, number[]>();
  const valid: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const ka = key(segs[i * 4], segs[i * 4 + 1]);
    const kb = key(segs[i * 4 + 2], segs[i * 4 + 3]);
    const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    valid[i] = ka !== kb && !seen.has(id);
    if (!valid[i]) continue;
    seen.add(id);
    for (const k of [ka, kb]) {
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k)!.push(i);
    }
  }
  const used = new Uint8Array(n);
  const out: { pts: number[]; closed: boolean }[] = [];
  const endpoint = (i: number, first: boolean) => (first ? [segs[i * 4], segs[i * 4 + 1]] : [segs[i * 4 + 2], segs[i * 4 + 3]]);
  for (let s = 0; s < n; s++) {
    if (!valid[s] || used[s]) continue;
    used[s] = 1;
    const line: number[][] = [endpoint(s, true), endpoint(s, false)];
    // in beide Richtungen verlängern
    for (const forward of [true, false]) {
      for (let guard = 0; guard < n; guard++) {
        const tip = forward ? line[line.length - 1] : line[0];
        const cand = ends.get(key(tip[0], tip[1]))?.find((j) => !used[j]);
        if (cand === undefined) break;
        used[cand] = 1;
        const a = endpoint(cand, true);
        const b = endpoint(cand, false);
        const next = key(a[0], a[1]) === key(tip[0], tip[1]) ? b : a;
        if (forward) line.push(next);
        else line.unshift(next);
      }
    }
    let closed = false;
    if (line.length > 3 && key(line[0][0], line[0][1]) === key(line[line.length - 1][0], line[line.length - 1][1])) {
      line.pop();
      closed = true;
    }
    // kollineare Punkte entfernen
    const pts: number[][] = [];
    for (let i = 0; i < line.length; i++) {
      const p = line[i];
      const prev = pts[pts.length - 1];
      const nxt = line[i + 1];
      if (prev && nxt && (!closed || i > 0)) {
        const cross = (p[0] - prev[0]) * (nxt[1] - p[1]) - (p[1] - prev[1]) * (nxt[0] - p[0]);
        if (Math.abs(cross) < 1e-7) continue;
      }
      pts.push(p);
    }
    out.push({ pts: pts.flat().map((v) => Math.round(v * 1e4) / 1e4 + 0), closed });
  }
  return out;
}
