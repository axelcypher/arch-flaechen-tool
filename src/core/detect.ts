import type { Point } from './geometry';
import { distance, pointInPolygon, polygonArea, projectOnSegment, signedArea } from './geometry';
import type { SegmentGrid } from './spatial';

/**
 * Raumerkennung per Klick.
 *
 * Vorgehen:
 *  1. Um den Klickpunkt wird ein Fenster gerastert (Linien aus DXF/vorhandenen Flächen,
 *     optional ein Rasterplan als Pixelmaske).
 *  2. Freiraum wird um den halben "Lückenschluss" erodiert – Türöffnungen bis zu dieser Breite
 *     schließen sich dadurch, schmale Räume (breiter als die Lücke) bleiben erhalten.
 *  3. Flood-Fill ab dem Klickpunkt; berührt die Füllung den Fensterrand, wird das Fenster vergrößert.
 *  4. Die Fläche wird wieder um denselben Betrag dilatiert (morphologisches Öffnen), sodass sie an den
 *     Wandlinien endet und Türöffnungen bündig mit der Wandflucht geschlossen sind.
 *  5. Außenkontur verfolgen, vereinfachen (Douglas-Peucker) und Kanten auf vorhandene Linien
 *     (DXF, Flächen) bzw. auf exakte Achsrichtungen einpassen. Ecken = Schnittpunkte der Kanten.
 */

export interface DetectWindow {
  minX: number;
  minY: number;
  /** Meter pro Pixel */
  res: number;
  w: number;
  h: number;
}

export interface DetectOptions {
  click: Point;
  /** Linienquellen für Hindernisse und Kanteneinpassung (Weltkoordinaten) */
  grids: SegmentGrid[];
  /** zusätzliche Hindernismaske (z. B. gerasterter Plan); 1 = belegt */
  rasterMask?: (win: DetectWindow) => Uint8Array | null;
  /** größte Öffnung, die geschlossen wird (m), z. B. Türbreite */
  gap: number;
  /**
   * Linien der Rastermaske, die dünner als dieser Wert (m) sind – Türaufschläge, Möbel, Schraffuren –
   * werden bevorzugt ignoriert. Ist der Raum ohne sie nicht geschlossen oder deutlich größer,
   * wird automatisch mit allen Linien gerechnet. 0 = aus.
   */
  ignoreThinLines?: number;
  /**
   * Feinjustierung einer nicht an Vektorlinien eingepassten Kante (Rasterpläne):
   * liefert die Verschiebung in m entlang der nach außen zeigenden Normalen oder null.
   */
  refineEdge?: (a: Point, b: Point, outward: Point) => number | null;
  /** Startgröße des Fensters in m */
  initialSize?: number;
  maxSize?: number;
  maxPixels?: number;
}

export type DetectResult = { ok: true; points: Point[] } | { ok: false; error: string };

export function detectRegion(o: DetectOptions): DetectResult {
  const maxSize = o.maxSize ?? 240;
  const maxPx = o.maxPixels ?? 2400;
  let size = o.initialSize ?? 24;
  let lastError = 'Kein geschlossener Bereich gefunden. Lückenschluss erhöhen oder Umrisslinien prüfen.';

  while (size <= maxSize * 1.0001) {
    // feine Auflösung, aber so grob, dass die Lücke mindestens einige Pixel breit ist
    const res = Math.max(size / maxPx, 0.005);
    const w = Math.ceil(size / res);
    const win: DetectWindow = { minX: o.click.x - (w * res) / 2, minY: o.click.y - (w * res) / 2, res, w, h: w };
    const r = runWindow(o, win);
    if (r.kind === 'ok') return { ok: true, points: r.points };
    if (r.kind === 'error') return { ok: false, error: r.error };
    lastError = r.error ?? lastError;
    size *= 2;
  }
  return { ok: false, error: lastError };
}

type WindowResult = { kind: 'ok'; points: Point[] } | { kind: 'error'; error: string } | { kind: 'grow'; error?: string };

interface FillResult {
  status: 'ok' | 'border' | 'blocked' | 'narrow' | 'small';
  region?: Uint8Array;
  count: number;
}

function runWindow(o: DetectOptions, win: DetectWindow): WindowResult {
  const { w, h, res } = win;
  const lines = new Uint8Array(w * h);
  let vectorLines = false;

  // 1. Linien rastern
  const pad = res * 2;
  for (const g of o.grids) {
    for (const i of g.query(win.minX - pad, win.minY - pad, win.minX + w * res + pad, win.minY + h * res + pad)) {
      const [x1, y1, x2, y2] = g.seg(i);
      drawLine(lines, win, x1, y1, x2, y2);
      vectorLines = true;
    }
  }
  const raster = o.rasterMask?.(win) ?? null;
  const gapPx = Math.max(0, Math.floor(o.gap / 2 / res));

  const combine = (rm: Uint8Array | null) => {
    if (!rm) return lines;
    const b = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) b[i] = lines[i] | rm[i];
    return b;
  };
  const full = combine(raster);
  const thinPx = raster && o.ignoreThinLines ? Math.floor(o.ignoreThinLines / 2 / res) : 0;
  const thick = thinPx > 0 ? combine(openMask(raster!, w, h, thinPx)) : null;

  const click: [number, number] = [Math.floor((o.click.x - win.minX) / res), Math.floor((o.click.y - win.minY) / res)];
  const fFull = fillRegion(full, w, h, gapPx, click);
  let chosen = fFull;
  let blocked = full;
  if (thick) {
    const fThick = fillRegion(thick, w, h, gapPx, click);
    // ohne dünne Linien nur übernehmen, wenn geschlossen und nicht wesentlich größer (Türaufschläge ≈ 1 m²)
    const limit = Math.max(3 / (res * res), fFull.count * 0.15);
    if (fThick.status === 'ok' && (fFull.status !== 'ok' || fThick.count - fFull.count <= limit)) {
      chosen = fThick;
      blocked = thick;
    }
  }

  switch (chosen.status) {
    case 'border':
      return { kind: 'grow' };
    case 'blocked':
      return { kind: 'error', error: 'Der Klickpunkt liegt auf einer Linie. Bitte in die Mitte des Raums klicken.' };
    case 'narrow':
      return { kind: 'error', error: 'Der Bereich ist schmaler als der Lückenschluss. Lückenschluss verringern.' };
    case 'small':
      return { kind: 'error', error: 'Der erkannte Bereich ist zu klein.' };
  }
  const region = chosen.region!;

  // 4. Dilatation zurück an die Wand; bei Vektorlinien zusätzlich bis zur Linienmitte
  const grow = gapPx + (vectorLines ? 1 : 0);
  let filled = region;
  if (grow > 0) {
    const d = chessboardDistance(region, w, h);
    filled = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) filled[i] = d[i] <= grow && (vectorLines || !blocked[i]) ? 1 : 0;
  }

  // 5. Kontur, Vereinfachung, Einpassung
  const contour = traceOuterContour(filled, w, h);
  if (contour.length < 3) return { kind: 'error', error: 'Kontur konnte nicht ermittelt werden.' };
  const world = contour.map(([px, py]) => ({ x: win.minX + px * res, y: win.minY + py * res }));
  const simple = simplifyClosed(world, res * 1.6);
  const fitted = fitEdges(simple, o.grids, Math.max(res * 2.5, 0.02), res, o.refineEdge);
  const clean = cleanupPolygon(fitted);
  if (clean.length < 3 || polygonArea(clean) < 0.05) return { kind: 'error', error: 'Der erkannte Bereich ist zu klein.' };
  return { kind: 'ok', points: orientClockwise(clean.map((p) => ({ x: round4(p.x), y: round4(p.y) }))) };
}

/** Erodiert den Freiraum um gapPx und füllt ab dem Klickpunkt (4-Nachbarschaft). */
function fillRegion(blocked: Uint8Array, w: number, h: number, gapPx: number, click: [number, number]): FillResult {
  const free = new Uint8Array(w * h);
  if (gapPx > 0) {
    const d = chessboardDistance(blocked, w, h);
    for (let i = 0; i < w * h; i++) free[i] = d[i] > gapPx ? 1 : 0;
  } else {
    for (let i = 0; i < w * h; i++) free[i] = blocked[i] ? 0 : 1;
  }
  let [sx, sy] = click;
  if (!free[sy * w + sx]) {
    const found = nearestFree(free, w, h, sx, sy, gapPx + 3);
    if (!found) return { status: blocked[sy * w + sx] ? 'blocked' : 'narrow', count: 0 };
    [sx, sy] = found;
  }
  const region = new Uint8Array(w * h);
  const stack: number[] = [sy * w + sx];
  region[sy * w + sx] = 1;
  let count = 0;
  while (stack.length) {
    const i = stack.pop()!;
    count++;
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return { status: 'border', count };
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (free[j] && !region[j]) {
        region[j] = 1;
        stack.push(j);
      }
    }
  }
  if (count < 4) return { status: 'small', count };
  return { status: 'ok', region, count };
}

/** Morphologisches Öffnen: entfernt belegte Strukturen, die dünner als 2·r+1 Pixel sind. */
export function openMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
  const dFree = chessboardDistance(inv, w, h);
  const eroded = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) eroded[i] = dFree[i] > r ? 1 : 0;
  const d = chessboardDistance(eroded, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = d[i] <= r ? 1 : 0;
  return out;
}

/* ---------- Rasterisierung ---------- */

export function drawLine(mask: Uint8Array, win: DetectWindow, x1: number, y1: number, x2: number, y2: number) {
  const { w, h, res } = win;
  const fx1 = (x1 - win.minX) / res;
  const fy1 = (y1 - win.minY) / res;
  const fx2 = (x2 - win.minX) / res;
  const fy2 = (y2 - win.minY) / res;
  const len = Math.max(Math.abs(fx2 - fx1), Math.abs(fy2 - fy1));
  const steps = Math.max(1, Math.ceil(len * 2));
  // Abtastung mit halber Pixelschrittweite ergibt eine geschlossene (4-verbundene) Linie
  let px = -1;
  let py = -1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.floor(fx1 + (fx2 - fx1) * t);
    const y = Math.floor(fy1 + (fy2 - fy1) * t);
    if (x === px && y === py) continue;
    // diagonale Sprünge schließen, damit keine Füllung "durchsickert"
    if (px >= 0 && x !== px && y !== py) set(mask, w, h, x, py);
    set(mask, w, h, x, y);
    px = x;
    py = y;
  }
}

function set(mask: Uint8Array, w: number, h: number, x: number, y: number) {
  if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
}

/** Schachbrett-Distanz jedes Pixels zum nächsten gesetzten Pixel (zwei Durchläufe). */
export function chessboardDistance(src: Uint8Array, w: number, h: number): Uint16Array {
  const INF = 65000;
  const d = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = src[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 1);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 1);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 1);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 1);
      }
      d[i] = v;
    }
  }
  return d;
}

function nearestFree(free: Uint8Array, w: number, h: number, sx: number, sy: number, maxR: number): [number, number] | null {
  for (let r = 1; r <= maxR; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h || !free[y * w + x]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Verfolgt die Außenkontur entlang der Pixelkanten (Fläche liegt rechts in Laufrichtung, y nach unten).
 * Liefert nur Eckpunkte (Richtungswechsel) in Pixelkoordinaten.
 */
export function traceOuterContour(mask: Uint8Array, w: number, h: number): [number, number][] {
  let start = -1;
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const DIRS: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]; // O, S, W, N
  // Pixel links/rechts der Kante P → P+d
  const pixelSide = (px: number, py: number, d: number, right: boolean): [number, number] => {
    const [dx, dy] = DIRS[d];
    const [nx, ny] = DIRS[(d + (right ? 1 : 3)) % 4];
    return [Math.min(px, px + dx, px + nx), Math.min(py, py + dy, py + ny)];
  };

  const sx = start % w;
  const sy = (start - sx) / w;
  let x = sx;
  let y = sy;
  let d = 0;
  const out: [number, number][] = [];
  const limit = 4 * (w + h) * 50;
  for (let step = 0; step < limit; step++) {
    const [lx, ly] = pixelSide(x, y, d, false);
    const [rx, ry] = pixelSide(x, y, d, true);
    let nd: number;
    if (inside(lx, ly)) nd = (d + 3) % 4; // links abbiegen
    else if (inside(rx, ry)) nd = d; // geradeaus
    else nd = (d + 1) % 4; // rechts abbiegen
    if (nd !== d || step === 0) out.push([x, y]);
    d = nd;
    x += DIRS[d][0];
    y += DIRS[d][1];
    if (x === sx && y === sy) break;
  }
  // Startpunkt kann doppelt/kollinear sein – bereinigen
  return dedupeCollinear(out);
}

function dedupeCollinear(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) out.push(b);
  }
  return out;
}

/* ---------- Vereinfachung ---------- */

function simplifyOpen(pts: Point[], tol: number): Point[] {
  if (pts.length <= 2) return pts;
  let maxD = -1;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = projectOnSegment(pts[i], a, b).dist;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [a, b];
  const l = simplifyOpen(pts.slice(0, idx + 1), tol);
  const r = simplifyOpen(pts.slice(idx), tol);
  return [...l.slice(0, -1), ...r];
}

/** Douglas-Peucker für geschlossene Polygone (Aufteilung an zwei weit entfernten Punkten). */
export function simplifyClosed(pts: Point[], tol: number): Point[] {
  if (pts.length <= 4) return pts;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = distance(pts[0], pts[i]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), tol);
  const b = simplifyOpen([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/* ---------- Kanteneinpassung ---------- */

interface Line {
  /** Punkt auf der Geraden */
  p: Point;
  /** normierte Richtung */
  d: Point;
  fitted: boolean;
}

function lineThrough(a: Point, b: Point): Line {
  const len = distance(a, b) || 1;
  return { p: a, d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, fitted: false };
}

function distToLine(q: Point, l: Line) {
  return Math.abs((q.x - l.p.x) * l.d.y - (q.y - l.p.y) * l.d.x);
}

function angleBetween(u: Point, v: Point) {
  const c = Math.abs(u.x * v.x + u.y * v.y);
  return Math.acos(Math.min(1, c));
}

export function fitEdges(pts: Point[], grids: SegmentGrid[], tol: number, res: number, refine?: DetectOptions['refineEdge']): Point[] {
  const n = pts.length;
  const maxAngle = (3 * Math.PI) / 180;
  const lines: Line[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const raw = lineThrough(a, b);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let best: Line | null = null;
    let bestScore = Infinity;
    if (distance(a, b) > res * 2) {
      for (const g of grids) {
        const minX = Math.min(a.x, b.x) - tol;
        const maxX = Math.max(a.x, b.x) + tol;
        const minY = Math.min(a.y, b.y) - tol;
        const maxY = Math.max(a.y, b.y) + tol;
        for (const idx of g.query(minX, minY, maxX, maxY)) {
          const [x1, y1, x2, y2] = g.seg(idx);
          const len = Math.hypot(x2 - x1, y2 - y1);
          if (len < 1e-6) continue;
          const cand: Line = { p: { x: x1, y: y1 }, d: { x: (x2 - x1) / len, y: (y2 - y1) / len }, fitted: true };
          if (angleBetween(cand.d, raw.d) > maxAngle) continue;
          const da = distToLine(a, cand);
          const db = distToLine(b, cand);
          if (da > tol || db > tol) continue;
          // Kante muss das Segment zumindest teilweise überlappen
          const pr = projectOnSegment(mid, { x: x1, y: y1 }, { x: x2, y: y2 });
          const proj = (q: Point) => (q.x - x1) * cand.d.x + (q.y - y1) * cand.d.y;
          const ta = proj(a);
          const tb = proj(b);
          if (Math.max(ta, tb) < -tol || Math.min(ta, tb) > len + tol) continue;
          const score = da + db + pr.dist * 0.1;
          if (score < bestScore) {
            bestScore = score;
            best = cand;
          }
        }
      }
    }
    if (!best) {
      // nahezu achsparallel → exakt achsparallel
      const ax = Math.abs(raw.d.x);
      const ay = Math.abs(raw.d.y);
      if (ay < Math.sin((2 * Math.PI) / 180)) best = { p: { x: mid.x, y: mid.y }, d: { x: 1, y: 0 }, fitted: false };
      else if (ax < Math.sin((2 * Math.PI) / 180)) best = { p: { x: mid.x, y: mid.y }, d: { x: 0, y: 1 }, fitted: false };
      else best = raw;
      if (refine && distance(a, b) > res * 4) {
        // Normale nach außen bestimmen
        let nx = best.d.y;
        let ny = -best.d.x;
        if (pointInPolygon({ x: mid.x + nx * res, y: mid.y + ny * res }, pts)) {
          nx = -nx;
          ny = -ny;
        }
        const shift = refine(a, b, { x: nx, y: ny });
        if (shift !== null && Math.abs(shift) <= res * 3) best = { ...best, p: { x: best.p.x + nx * shift, y: best.p.y + ny * shift } };
      }
    }
    lines.push(best);
  }

  // kollineare Nachbarkanten zusammenfassen
  const keep: { line: Line; orig: number }[] = [];
  for (let i = 0; i < n; i++) {
    const cur = lines[i];
    const prev = keep[keep.length - 1];
    if (prev && angleBetween(prev.line.d, cur.d) < (1 * Math.PI) / 180 && distToLine(cur.p, prev.line) < tol) continue;
    keep.push({ line: cur, orig: i });
  }
  if (keep.length > 2) {
    const f = keep[0];
    const l = keep[keep.length - 1];
    if (angleBetween(f.line.d, l.line.d) < (1 * Math.PI) / 180 && distToLine(f.line.p, l.line) < tol) {
      keep.shift();
      keep[keep.length - 1] = l;
      // der Eckpunkt vor der ersten gemeinsamen Kante liegt nun bei l.orig
    }
  }
  if (keep.length < 3) return pts;

  const out: Point[] = [];
  const m = keep.length;
  for (let k = 0; k < m; k++) {
    const L1 = keep[(k - 1 + m) % m].line;
    const L2 = keep[k].line;
    const origVertex = pts[keep[k].orig];
    const x = intersect(L1, L2);
    if (!x || distance(x, origVertex) > tol * 6) out.push(origVertex);
    else out.push(x);
  }
  return out;
}

function intersect(l1: Line, l2: Line): Point | null {
  const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
  return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
}

function cleanupPolygon(pts: Point[]): Point[] {
  let out = pts.filter((p, i) => distance(p, pts[(i + 1) % pts.length]) > 1e-4);
  // kollineare Punkte entfernen
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-6) {
        out = out.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function orientClockwise(pts: Point[]): Point[] {
  // im y-nach-unten-System entspricht positive Fläche dem Uhrzeigersinn auf dem Bildschirm
  return signedArea(pts) < 0 ? [...pts].reverse() : pts;
}

function round4(v: number) {
  return Math.round(v * 1e4) / 1e4;
}
