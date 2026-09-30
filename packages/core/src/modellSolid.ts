import { modellRoofParams } from './calc';
import type { Point } from './geometry';
import type { OutlineShape, Project, Storey } from './model';
import type { Point3, SolidFaces } from './roof';
import { clipHalfPlane } from './roof';
import { meshRoofHeightAt } from './roofMesh';

/**
 * Körper eines Umrisses mit Dach aus dem Gebäudemodell (für die 3D-Ansicht): Fußboden (z = 0) bis zur
 * Dachhaut, begrenzt auf die Geschosshöhe dort, wo das Geschoss darüber BGF hat.
 */
export function modellSolidFaces(project: Project, storey: Storey | undefined, s: OutlineShape, floorZ: number, n = 60): SolidFaces {
  const h = s.hoehe ?? storey?.hoehe ?? 3;
  const cap = storey ? modellRoofParams(project, storey, s).cap : Infinity;
  const capAt = typeof cap === 'function' ? cap : () => cap;
  const height = (p: Point) => {
    const v = project.dachModell ? meshRoofHeightAt(project.dachModell, s.points, floorZ, p) : NaN;
    return Math.min(Number.isNaN(v) ? h : Math.max(v, 0), capAt(p));
  };
  return heightFieldSolid(s.points, height, n);
}

/**
 * Höhenfeld über einem Grundriss als geschlossener Körper. Das Raster wird exakt am Umriss beschnitten
 * (keine Rasterecken außerhalb, keine Treppen am Rand), die Wandoberkanten laufen durch dieselben
 * Punkte wie die Ränder der Dachfläche – so entstehen weder Zacken noch Spalten.
 */
export function heightFieldSolid(pts: Point[], height: (p: Point) => number, n = 60): SolidFaces {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  const dx = (x1 - x0) / n || 1;
  const dy = (y1 - y0) / n || 1;

  const cache = new Map<string, number>();
  const z = (p: Point) => {
    const k = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    let v = cache.get(k);
    if (v === undefined) cache.set(k, (v = height(p)));
    return v;
  };

  const tops: Point3[][] = [];
  for (let i = 0; i < n; i++) {
    const cx0 = x0 + i * dx;
    const cx1 = i === n - 1 ? x1 : x0 + (i + 1) * dx;
    // Spalte vorab beschneiden, dann je Zelle nur noch in y
    let col = clipHalfPlane(pts, [-1, 0, cx0]);
    if (col.length >= 3) col = clipHalfPlane(col, [1, 0, -cx1]);
    if (col.length < 3) continue;
    for (let j = 0; j < n; j++) {
      const cy0 = y0 + j * dy;
      const cy1 = j === n - 1 ? y1 : y0 + (j + 1) * dy;
      let cell = clipHalfPlane(col, [0, -1, cy0]);
      if (cell.length >= 3) cell = clipHalfPlane(cell, [0, 1, -cy1]);
      if (cell.length < 3) continue;
      const clean = dedupe(cell);
      if (clean.length < 3 || Math.abs(area(clean)) < 1e-10) continue;
      tops.push(clean.map((p) => ({ x: p.x, y: p.y, z: z(p) })));
    }
  }

  // Wände: Oberkante durch alle Schnittpunkte der Kante mit den Rasterlinien
  const sides: Point3[][] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    const ts = [0, 1];
    for (let i = 1; i < n; i++) {
      const gx = x0 + i * dx;
      if ((a.x - gx) * (b.x - gx) < 0) ts.push((gx - a.x) / (b.x - a.x));
      const gy = y0 + i * dy;
      if ((a.y - gy) * (b.y - gy) < 0) ts.push((gy - a.y) / (b.y - a.y));
    }
    ts.sort((u, v) => u - v);
    const top = ts.map((t) => {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      return { ...p, z: z(p) };
    });
    // in schmale Vierecke zerlegen (Oberkante kann beliebig verlaufen)
    for (let m = 0; m + 1 < top.length; m++) {
      const p = top[m];
      const q = top[m + 1];
      if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-9) continue;
      sides.push([{ x: p.x, y: p.y, z: 0 }, p, q, { x: q.x, y: q.y, z: 0 }]);
    }
  }
  return { tops, sides, bottom: pts.map((p) => ({ x: p.x, y: p.y, z: 0 })) };
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q.x - p.x) > 1e-9 || Math.abs(q.y - p.y) > 1e-9) out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) < 1e-9 && Math.abs(out[0].y - out[out.length - 1].y) < 1e-9) out.pop();
  return out;
}

function area(pts: Point[]) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return s / 2;
}
