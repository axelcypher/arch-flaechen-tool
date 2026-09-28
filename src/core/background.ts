import type { Bounds, Point } from './geometry';
import type { Background, VectorBackground } from './model';
import { SegmentGrid } from './spatial';

/** Faktor lokal → Meter (Raster: m/px, Vektor: m/DXF-Einheit). */
export function bgScale(bg: Background): number {
  return bg.type === 'raster' ? bg.metersPerPixel : bg.scale;
}

export function withScale(bg: Background, scale: number): Background {
  return bg.type === 'raster' ? { ...bg, metersPerPixel: scale } : { ...bg, scale };
}

export function bgToWorld(bg: Background, lx: number, ly: number): Point {
  const s = bgScale(bg);
  return { x: bg.x + lx * s, y: bg.y + ly * s };
}

/**
 * Skaliert den Plan um factor, wobei der Weltpunkt anchor an seiner Stelle bleibt
 * (Kalibrierung über eine bekannte Strecke).
 */
export function scaleAround(bg: Background, factor: number, anchor: Point): Background {
  const s = bgScale(bg);
  const next = withScale(bg, s * factor);
  return { ...next, x: anchor.x - (anchor.x - bg.x) * factor, y: anchor.y - (anchor.y - bg.y) * factor };
}

const localBoundsCache = new WeakMap<VectorBackground['polylines'], Bounds>();

function vectorLocalBounds(bg: VectorBackground): Bounds {
  let b = localBoundsCache.get(bg.polylines);
  if (b) return b;
  b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const pl of bg.polylines) {
    for (let i = 0; i < pl.pts.length; i += 2) {
      const x = pl.pts[i];
      const y = pl.pts[i + 1];
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  if (!Number.isFinite(b.minX)) b = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  localBoundsCache.set(bg.polylines, b);
  return b;
}

export function bgWorldBounds(bg: Background): Bounds {
  if (bg.type === 'raster') {
    return { minX: bg.x, minY: bg.y, maxX: bg.x + bg.widthPx * bg.metersPerPixel, maxY: bg.y + bg.heightPx * bg.metersPerPixel };
  }
  const b = vectorLocalBounds(bg);
  const a = bgToWorld(bg, b.minX, b.minY);
  const c = bgToWorld(bg, b.maxX, b.maxY);
  return { minX: a.x, minY: a.y, maxX: c.x, maxY: c.y };
}

export interface VectorSegmentOptions {
  /** aus Bögen/Kreisen entstandene Linien (z. B. Türaufschläge) auslassen */
  skipArcs?: boolean;
}

const gridCache = new WeakMap<VectorBackground, Map<string, SegmentGrid>>();

/**
 * Segmentverzeichnis der sichtbaren DXF-Layer in Weltkoordinaten.
 * Wird je Hintergrund-Objekt zwischengespeichert (Objekte sind unveränderlich).
 */
export function vectorSegmentGrid(bg: VectorBackground, opts: VectorSegmentOptions = {}): SegmentGrid {
  const key = opts.skipArcs ? 'noarcs' : 'all';
  let m = gridCache.get(bg);
  if (!m) gridCache.set(bg, (m = new Map()));
  const cached = m.get(key);
  if (cached) return cached;

  const segs: number[] = [];
  const s = bg.scale;
  for (const pl of bg.polylines) {
    if (!bg.layers[pl.layer]?.visible) continue;
    if (opts.skipArcs && pl.arc) continue;
    const p = pl.pts;
    const n = p.length / 2;
    const count = pl.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % n;
      segs.push(bg.x + p[i * 2] * s, bg.y + p[i * 2 + 1] * s, bg.x + p[j * 2] * s, bg.y + p[j * 2 + 1] * s);
    }
  }
  const grid = new SegmentGrid(segs);
  m.set(key, grid);
  return grid;
}
