import { cleanupPolygon, fitEdges, simplifyClosed, traceOuterContour } from './detect';
import type { Point } from './geometry';
import { polygonArea, signedArea } from './geometry';
import { clipHalfPlane } from './roof';
import type { IfcExtract, IfcMeshPart } from './ifcData';
import type { DxfPolyline, Nutzungsgruppe, OutlineShape, Storey, VectorBackground } from './model';
import { createOutline, createProject, createRoom, createStorey } from './model';
import { modellRoofParams } from './calc';
import type { DachModell } from './roofMesh';
import { meshRoofStats } from './roofMesh';
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
  'IFCWINDOW',
  'IFCDOOR',
]);
/** nur als Teil einer Vorhangfassade (sonst z. B. Sparren im Dachüberstand) */
const CURTAIN_PARTS = new Set(['IFCPLATE', 'IFCMEMBER']);
const isOutlinePart = (e: IfcMeshPart) => OUTLINE_TYPES.has(e.type) || (CURTAIN_PARTS.has(e.type) && e.parentType === 'IFCCURTAINWALL');

export function buildFromIfc(x: IfcExtract, o: IfcImportOptions): IfcImportResult {
  const report: string[] = [];
  const order = x.storeys.map((s, i) => ({ ...s, i })).sort((a, b) => a.elevation - b.elevation);
  const storeys: Storey[] = [];
  const storeyByIfcIndex = new Map<number, Storey>();

  order.forEach((s, k) => {
    const next = order[k + 1];
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
    for (const sp of x.spaces) {
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
        room.wofl =
          hc && hc.a2 < 0.995
            ? { kategorie: 'individuell', faktor: round(hc.a2 + 0.5 * hc.a12, 4), wohnung: st.name }
            : { kategorie: 'voll', wohnung: st.name };
      }
      if (notes.length) room.bemerkung = notes.join('; ');
      st.shapes.push(room);
      n++;
    }
    report.push(`${n} Räume aus IFC-Zonen übernommen.`);
    if (putz) report.push(`${putz} Räume mit Putzabzug aus Archicad (Nettofläche aus Rohbaumaßen) übernommen.`);
  }

  // BGF-Umrisse
  if (o.outlines) {
    order.forEach((s) => {
      const st = storeyFor(s.i);
      const parts = x.elements.filter((e) => e.storey === s.i && isOutlinePart(e));
      const spaceTris = x.spaces.filter((sp) => sp.storey === s.i).map((sp) => sp.tris);
      const outlines = outlinesFromParts(parts.map((p) => p.tris).concat(spaceTris));
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
    const roofParts = x.elements.filter((e) => e.type === 'IFCROOF' || (e.type === 'IFCSLAB' && e.predefinedType === 'ROOF') || (e.type === 'IFCCOVERING' && e.predefinedType === 'ROOFING'));
    const tris = upwardTriangles(roofParts);
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
        }
      });
      // Geschosse ohne BGF (z. B. Spitzboden/Dachspitze als eigenes Geschoss)
      for (const st of storeys) {
        if (!st.shapes.some((s) => s.kind === 'outline')) {
          report.push(`${st.name}: ohne BGF-Umriss – der Rauminhalt darüber (z. B. Dachspitze) wird dem Geschoss darunter bis zur Dachhaut zugerechnet.`);
        }
      }
      report.push(`Dach aus ${roofParts.length} Dachbauteilen übernommen (BRI bis zur Dachhaut).`);
    } else report.push('Keine Dachbauteile (IfcRoof, IfcSlab.ROOF) gefunden – Dachform bei Bedarf manuell wählen.');
  }

  return { storeys, dachModell, report };
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

export function outlinesFromParts(parts: Float32Array[]): Point[][] {
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
    if (fitted.length >= 3) result.push(orientCw(fitted.map((p) => ({ x: round(p.x, 4), y: round(p.y, 4) }))));
  }
  return result.sort((a, b) => polygonArea(b) - polygonArea(a));
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
