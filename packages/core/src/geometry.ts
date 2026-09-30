/**
 * Reine 2D-Geometrie. Einheit ist durchgehend Meter.
 * Keine Abhängigkeiten zu UI oder Plattform – damit testbar und im Web wie in Tauri nutzbar.
 */

export interface Point {
  x: number;
  y: number;
}

export const EPS = 1e-9;

/** Vorzeichenbehaftete Fläche (Gaußsche Trapezformel / Shoelace). */
export function signedArea(pts: readonly Point[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonArea(pts: readonly Point[]): number {
  return Math.abs(signedArea(pts));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function perimeter(pts: readonly Point[]): number {
  const n = pts.length;
  if (n < 2) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += distance(pts[i], pts[(i + 1) % n]);
  return s;
}

/** Flächenschwerpunkt; bei entarteten Polygonen der Mittelwert der Punkte. */
export function centroid(pts: readonly Point[]): Point {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  const a = signedArea(pts);
  if (Math.abs(a) < EPS) {
    let x = 0;
    let y = 0;
    for (const p of pts) {
      x += p.x;
      y += p.y;
    }
    return { x: x / n, y: y / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Ray-Casting. Punkte auf dem Rand gelten nicht zwingend als innen. */
export function pointInPolygon(p: Point, pts: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export interface SegmentProjection {
  dist: number;
  t: number;
  point: Point;
}

export function projectOnSegment(p: Point, a: Point, b: Point): SegmentProjection {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 < EPS ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { dist: distance(p, point), t, point };
}

/** Kürzester Abstand eines Punktes zum Polygonrand. */
export function distanceToEdges(p: Point, pts: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = projectOnSegment(p, pts[i], pts[(i + 1) % pts.length]).dist;
    if (d < best) best = d;
  }
  return best;
}

/**
 * Guter Beschriftungspunkt im Inneren des Polygons (vereinfachtes "pole of inaccessibility").
 * Für konvexe Formen ist das praktisch der Schwerpunkt, für L-/U-Formen landet die
 * Beschriftung trotzdem innerhalb der Fläche. Optionale "holes" (z. B. Räume innerhalb
 * eines BGF-Umrisses) werden gemieden.
 */
export function labelPoint(pts: readonly Point[], holes: readonly (readonly Point[])[] = []): Point {
  if (pts.length < 3) return centroid(pts);
  const c = centroid(pts);
  const inside = (q: Point) => pointInPolygon(q, pts) && !holes.some((h) => pointInPolygon(q, h));
  const clearance = (q: Point) => holes.reduce((d, h) => Math.min(d, distanceToEdges(q, h)), distanceToEdges(q, pts));
  const b = bounds(pts);
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  if (size < EPS) return c;

  let best = c;
  let bestD = inside(c) ? clearance(c) : -Infinity;
  let step = size / 16;
  let cx = (b.minX + b.maxX) / 2;
  let cy = (b.minY + b.maxY) / 2;
  let half = size / 2;
  for (let iter = 0; iter < 4; iter++) {
    for (let x = cx - half; x <= cx + half + EPS; x += step) {
      for (let y = cy - half; y <= cy + half + EPS; y += step) {
        const q = { x, y };
        if (!inside(q)) continue;
        const d = clearance(q);
        // leichte Bevorzugung des Schwerpunkts für ruhigere Beschriftung
        if (d > bestD * 1.05) {
          bestD = d;
          best = q;
        }
      }
    }
    cx = best.x;
    cy = best.y;
    half = step * 2;
    step = step / 4;
  }
  return best;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(pts: readonly Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function snapToGrid(p: Point, step: number): Point {
  if (!(step > 0)) return p;
  return { x: roundTo(p.x, step), y: roundTo(p.y, step) };
}

/** Rundet auf ein Vielfaches von step und beseitigt Fließkomma-Rauschen. */
export function roundTo(v: number, step: number): number {
  const r = Math.round(v / step) * step;
  return Math.round(r * 1e6) / 1e6;
}

export function rectPoints(a: Point, b: Point): Point[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}

/** Beschränkt p relativ zu origin auf die nächstliegende horizontale oder vertikale Richtung. */
export function orthoConstrain(origin: Point, p: Point): Point {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: origin.y } : { x: origin.x, y: p.y };
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/** Prüft auf echte Kreuzungen nicht benachbarter Kanten (für Warnhinweise). */
export function isSelfIntersecting(pts: readonly Point[]): boolean {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // benachbart über den Schluss
      if (segmentsIntersect(a, b, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function translate(pts: readonly Point[], dx: number, dy: number): Point[] {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}
