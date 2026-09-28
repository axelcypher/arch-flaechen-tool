import type { Point } from './geometry';
import { bounds, pointInPolygon, polygonArea } from './geometry';

/**
 * Dach aus einem Gebäudemodell (IFC): Die nach oben zeigenden Dreiecke der Dachbauteile bilden die
 * Dachhaut. Über einem Umriss wird die Höhe der Dachhaut auf einem feinen Raster (z-Puffer, jeweils
 * höchster Wert) ermittelt und über die exakte Umrissfläche gemittelt.
 */

export interface DachModell {
  name: string;
  /** Dreiecke der Dachoberseite: je 9 Werte (x, y, z) in Grundrisskoordinaten, z = absolute Höhe in m */
  triangles: number[];
}

export interface HeightField {
  minX: number;
  minY: number;
  res: number;
  w: number;
  h: number;
  /** absolute Höhe der Dachhaut je Zelle, NaN = kein Dach */
  z: Float32Array;
}

const fieldCache = new WeakMap<DachModell, Map<string, HeightField>>();

export function roofHeightField(m: DachModell, pts: Point[], res = 0.05): HeightField {
  const b = bounds(pts);
  const key = `${b.minX},${b.minY},${b.maxX},${b.maxY},${res}`;
  let cache = fieldCache.get(m);
  if (!cache) fieldCache.set(m, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;

  const w = Math.max(1, Math.ceil((b.maxX - b.minX) / res));
  const h = Math.max(1, Math.ceil((b.maxY - b.minY) / res));
  const z = new Float32Array(w * h).fill(NaN);
  const t = m.triangles;
  for (let i = 0; i + 8 < t.length; i += 9) {
    const ax = (t[i] - b.minX) / res - 0.5;
    const ay = (t[i + 1] - b.minY) / res - 0.5;
    const bx = (t[i + 3] - b.minX) / res - 0.5;
    const by = (t[i + 4] - b.minY) / res - 0.5;
    const cx = (t[i + 6] - b.minX) / res - 0.5;
    const cy = (t[i + 7] - b.minY) / res - 0.5;
    const az = t[i + 2];
    const bz = t[i + 5];
    const cz = t[i + 8];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const zz = l1 * az + l2 * bz + l3 * cz;
        const k = py * w + px;
        if (!(z[k] >= zz)) z[k] = zz;
      }
    }
  }
  const field = { minX: b.minX, minY: b.minY, res, w, h, z };
  cache.set(key, field);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return field;
}

export interface MeshRoofStats {
  volumen: number;
  firsthoehe: number;
  /** Anteil der Umrissfläche, über dem Dachhaut gefunden wurde */
  abdeckung: number;
}

/**
 * Rauminhalt über einem Umriss vom Fußboden (floorZ) bis zur Dachhaut.
 * Ohne Dach über einem Punkt gilt fallbackHoehe; die Höhe wird auf maxHoehe begrenzt
 * (für Geschosse unterhalb des obersten).
 */
export function meshRoofStats(m: DachModell, pts: Point[], floorZ: number, fallbackHoehe: number, maxHoehe = Infinity): MeshRoofStats {
  const f = roofHeightField(m, pts);
  let sum = 0;
  let n = 0;
  let covered = 0;
  let maxH = 0;
  for (let py = 0; py < f.h; py++) {
    for (let px = 0; px < f.w; px++) {
      const p = { x: f.minX + (px + 0.5) * f.res, y: f.minY + (py + 0.5) * f.res };
      if (!pointInPolygon(p, pts)) continue;
      const zz = f.z[py * f.w + px];
      let hh: number;
      if (Number.isNaN(zz)) hh = fallbackHoehe;
      else {
        hh = Math.min(Math.max(zz - floorZ, 0), maxHoehe);
        covered++;
      }
      sum += hh;
      maxH = Math.max(maxH, hh);
      n++;
    }
  }
  const area = polygonArea(pts);
  if (n === 0) return { volumen: area * fallbackHoehe, firsthoehe: fallbackHoehe, abdeckung: 0 };
  return { volumen: area * (sum / n), firsthoehe: maxH, abdeckung: covered / n };
}

/** Höhe der Dachhaut über floorZ an einem Punkt (NaN, wenn kein Dach) */
export function meshRoofHeightAt(m: DachModell, pts: Point[], floorZ: number, p: Point): number {
  const f = roofHeightField(m, pts);
  // Punkte auf dem Rand (z. B. Außenkanten) der nächstgelegenen Zelle zuordnen
  const px = Math.min(f.w - 1, Math.max(0, Math.floor((p.x - f.minX) / f.res)));
  const py = Math.min(f.h - 1, Math.max(0, Math.floor((p.y - f.minY) / f.res)));
  return f.z[py * f.w + px] - floorZ;
}
