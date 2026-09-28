import DxfParser from 'dxf-parser';
import type { DxfLayer, DxfPolyline, DxfText, VectorBackground } from './model';

/**
 * Wandelt eine DXF-Datei in einen Vektor-Hintergrund um.
 * Unterstützt: LINE, LWPOLYLINE/POLYLINE (inkl. Bögen über "bulge"), CIRCLE, ARC, ELLIPSE, SPLINE (angenähert),
 * SOLID/3DFACE, TEXT/MTEXT sowie Blockreferenzen (INSERT, verschachtelt) und Bemaßungsblöcke.
 * Die y-Achse wird gespiegelt, weil die Zeichenfläche mit y nach unten arbeitet.
 */

/** Meter je Einheit laut $INSUNITS */
const INSUNITS: Record<number, number> = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

export const DXF_UNITS: { label: string; scale: number }[] = [
  { label: 'Millimeter', scale: 0.001 },
  { label: 'Zentimeter', scale: 0.01 },
  { label: 'Dezimeter', scale: 0.1 },
  { label: 'Meter', scale: 1 },
  { label: 'Zoll', scale: 0.0254 },
  { label: 'Fuß', scale: 0.3048 },
];

type M = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: M = [1, 0, 0, 1, 0, 0];

function mul(m: M, n: M): M {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const translate = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const rotate = (rad: number): M => [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
const scale = (sx: number, sy: number): M => [sx, 0, 0, sy, 0, 0];

interface Vec {
  x: number;
  y: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyEntity = any;

export interface DxfImportResult {
  background: VectorBackground;
  /** aus $INSUNITS erkannt (sonst geschätzt) */
  unitDetected: boolean;
  entityCount: number;
}

export function decodeDxfText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  // Ältere DXF-Dateien (vor AutoCAD 2007) sind meist in Windows-1252 kodiert
  if (utf8.includes('�')) return new TextDecoder('windows-1252').decode(buf);
  return utf8;
}

export function importDxf(text: string, name: string): DxfImportResult {
  const parser = new DxfParser();
  let dxf: AnyEntity;
  try {
    dxf = parser.parseSync(text);
  } catch (e) {
    throw new Error(`DXF konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!dxf) throw new Error('DXF konnte nicht gelesen werden.');

  const layerIndex = new Map<string, number>();
  const layers: DxfLayer[] = [];
  const tableLayers: Record<string, AnyEntity> = dxf.tables?.layer?.layers ?? {};
  const layerOf = (name: string | undefined): number => {
    const n = name ?? '0';
    let i = layerIndex.get(n);
    if (i === undefined) {
      const t = tableLayers[n];
      i = layers.length;
      layers.push({ name: n, color: colorToHex(t?.color), visible: t ? t.visible !== false && !t.frozen : true });
      layerIndex.set(n, i);
    }
    return i;
  };

  const polylines: DxfPolyline[] = [];
  const texts: DxfText[] = [];
  const blocks: Record<string, AnyEntity> = dxf.blocks ?? {};
  let count = 0;

  const ap = (m: M, p: Vec): Vec => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

  const emit = (layer: number, pts: Vec[], closed: boolean, m: M, arc = false) => {
    if (pts.length < 2) return;
    const flat: number[] = [];
    for (const p of pts) {
      const q = ap(m, p);
      if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return;
      flat.push(round(q.x), round(-q.y)); // y spiegeln
    }
    polylines.push({ layer, pts: flat, closed, arc: arc || undefined });
    count++;
  };

  const arcPoints = (c: Vec, r: number, a0: number, a1: number): Vec[] => {
    let sweep = a1 - a0;
    while (sweep <= 0) sweep += Math.PI * 2;
    const n = Math.max(6, Math.ceil(sweep / (Math.PI / 36)));
    const out: Vec[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (sweep * i) / n;
      out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
    }
    return out;
  };

  /** Polylinienpunkte inkl. Bogensegmente (bulge) */
  const bulgePoints = (verts: AnyEntity[], closed: boolean): Vec[] => {
    const out: Vec[] = [];
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const a = verts[i];
      out.push({ x: a.x, y: a.y });
      const last = i === n - 1;
      if (last && !closed) break;
      const b = verts[(i + 1) % n];
      const bulge = a.bulge ?? 0;
      if (Math.abs(bulge) > 1e-9) {
        const theta = 4 * Math.atan(bulge);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const chord = Math.hypot(dx, dy);
        if (chord < 1e-12) continue;
        const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const h = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0)) * Math.sign(bulge) * (Math.abs(theta) > Math.PI ? -1 : 1);
        const cx = mx - (dy / chord) * h;
        const cy = my + (dx / chord) * h;
        const a0 = Math.atan2(a.y - cy, a.x - cx);
        const steps = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 36)));
        for (let k = 1; k < steps; k++) {
          const ang = a0 + (theta * k) / steps;
          out.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
        }
      }
    }
    if (closed && out.length > 1) {
      const f = out[0];
      const l = out[out.length - 1];
      if (Math.abs(f.x - l.x) < 1e-12 && Math.abs(f.y - l.y) < 1e-12) out.pop();
    }
    return out;
  };

  const walk = (entities: AnyEntity[], m: M, depth: number, inheritLayer?: string) => {
    if (depth > 10 || !entities) return;
    for (const e of entities) {
      if (e.inPaperSpace) continue;
      // Entitäten auf Layer "0" in Blöcken erben den Layer der Blockreferenz
      const lname = e.layer === '0' && inheritLayer ? inheritLayer : e.layer;
      const layer = layerOf(lname);
      switch (e.type) {
        case 'LINE':
          if (e.vertices?.length >= 2) emit(layer, [e.vertices[0], e.vertices[1]], false, m);
          break;
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const verts = (e.vertices ?? []).filter((v: AnyEntity) => Number.isFinite(v.x) && Number.isFinite(v.y));
          const closed = !!e.shape;
          const hasBulge = verts.some((v: AnyEntity) => v.bulge);
          emit(layer, bulgePoints(verts, closed), closed, m, hasBulge && verts.length <= 3);
          break;
        }
        case 'CIRCLE':
          if (e.center && e.radius > 0) {
            const pts = arcPoints(e.center, e.radius, 0, Math.PI * 2);
            pts.pop();
            emit(layer, pts, true, m, true);
          }
          break;
        case 'ARC':
          if (e.center && e.radius > 0) emit(layer, arcPoints(e.center, e.radius, e.startAngle ?? 0, e.endAngle ?? Math.PI * 2), false, m, true);
          break;
        case 'ELLIPSE': {
          if (!e.center || !e.majorAxisEndPoint) break;
          const mx = e.majorAxisEndPoint.x;
          const my = e.majorAxisEndPoint.y;
          const ra = Math.hypot(mx, my);
          const rb = ra * (e.axisRatio ?? 1);
          const rot = Math.atan2(my, mx);
          const t0 = e.startAngle ?? 0;
          let t1 = e.endAngle ?? Math.PI * 2;
          if (t1 <= t0) t1 += Math.PI * 2;
          const n = Math.max(12, Math.ceil((t1 - t0) / (Math.PI / 36)));
          const pts: Vec[] = [];
          for (let i = 0; i <= n; i++) {
            const t = t0 + ((t1 - t0) * i) / n;
            const x = ra * Math.cos(t);
            const y = rb * Math.sin(t);
            pts.push({ x: e.center.x + x * Math.cos(rot) - y * Math.sin(rot), y: e.center.y + x * Math.sin(rot) + y * Math.cos(rot) });
          }
          emit(layer, pts, false, m, true);
          break;
        }
        case 'SPLINE': {
          const pts = e.fitPoints?.length >= 2 ? e.fitPoints : e.controlPoints;
          if (pts?.length >= 2) emit(layer, pts, !!e.closed, m, true);
          break;
        }
        case 'SOLID':
        case '3DFACE': {
          const pts: Vec[] = (e.points ?? e.vertices ?? []).filter(Boolean);
          // SOLID speichert die Ecken in der Reihenfolge 1-2-4-3
          if (e.type === 'SOLID' && pts.length === 4) [pts[2], pts[3]] = [pts[3], pts[2]];
          emit(layer, pts, true, m);
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const raw: string = e.text ?? '';
          const txt = e.type === 'MTEXT' ? cleanMtext(raw) : raw;
          const pos: Vec | undefined = e.type === 'TEXT' ? (e.halign || e.valign ? e.endPoint ?? e.startPoint : e.startPoint) : e.position;
          const h: number = (e.type === 'TEXT' ? e.textHeight : e.height) ?? 0;
          if (!pos || !txt.trim() || !(h > 0)) break;
          const rotDeg: number = e.rotation ?? 0;
          const q = ap(m, pos);
          // Richtung und Höhe unter der Blocktransformation
          const r = (rotDeg * Math.PI) / 180;
          const dir = { x: m[0] * Math.cos(r) + m[2] * Math.sin(r), y: m[1] * Math.cos(r) + m[3] * Math.sin(r) };
          const up = { x: -m[0] * Math.sin(r) + m[2] * Math.cos(r), y: -m[1] * Math.sin(r) + m[3] * Math.cos(r) };
          let y = q.y;
          // MTEXT mit Ausrichtung oben: Grundlinie um eine Texthöhe nach unten
          if (e.type === 'MTEXT' && (e.attachmentPoint ?? 1) <= 3) y -= h * Math.hypot(up.x, up.y);
          texts.push({
            layer,
            x: round(q.x),
            y: round(-y),
            h: h * Math.hypot(up.x, up.y),
            rot: (-Math.atan2(dir.y, dir.x) * 180) / Math.PI,
            text: txt.trim(),
          });
          break;
        }
        case 'INSERT': {
          const block = blocks[e.name];
          if (!block) break;
          const base: Vec = block.position ?? { x: 0, y: 0 };
          const pos: Vec = e.position ?? { x: 0, y: 0 };
          const t = mul(
            m,
            mul(translate(pos.x, pos.y), mul(rotate(((e.rotation ?? 0) * Math.PI) / 180), mul(scale(e.xScale ?? 1, e.yScale ?? 1), translate(-base.x, -base.y)))),
          );
          walk(block.entities ?? [], t, depth + 1, lname);
          break;
        }
        case 'DIMENSION': {
          const block = e.block ? blocks[e.block] : undefined;
          if (block) walk(block.entities ?? [], m, depth + 1, lname);
          break;
        }
      }
    }
  };

  walk(dxf.entities ?? [], IDENTITY, 0);
  if (polylines.length === 0 && texts.length === 0) throw new Error('Die DXF-Datei enthält keine darstellbaren Elemente im Modellbereich.');

  // Einheit: $INSUNITS oder Schätzung über die Ausdehnung
  const insunits = dxf.header?.$INSUNITS as number | undefined;
  let unitScale = insunits !== undefined ? INSUNITS[insunits] : undefined;
  const unitDetected = unitScale !== undefined;
  if (unitScale === undefined) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const pl of polylines) {
      for (let i = 0; i < pl.pts.length; i += 2) {
        minX = Math.min(minX, pl.pts[i]);
        maxX = Math.max(maxX, pl.pts[i]);
        minY = Math.min(minY, pl.pts[i + 1]);
        maxY = Math.max(maxY, pl.pts[i + 1]);
      }
    }
    const ext = Math.max(maxX - minX, maxY - minY);
    unitScale = ext > 2000 ? 0.001 : ext > 300 ? 0.01 : 1;
  }

  return {
    background: { type: 'vector', name, x: 0, y: 0, scale: unitScale, opacity: 0.8, visible: true, layers, polylines, texts },
    unitDetected,
    entityCount: count,
  };
}

function round(v: number) {
  return Math.round(v * 1e6) / 1e6 + 0; // + 0 vermeidet -0
}

/** Entfernt MTEXT-Formatierungscodes. */
export function cleanMtext(s: string): string {
  return s
    .replace(/\\P/g, ' ')
    .replace(/\\[ACcFfHhQqTtWw][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;]*)[#^/]([^;]*);/g, '$1/$2')
    .replace(/\\~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/\s+/g, ' ');
}

function colorToHex(c: number | undefined): string {
  if (c === undefined || c === null) return '#333333';
  let hex = `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  // weiß/sehr hell (AutoCAD-Farbe 7) auf hellem Hintergrund dunkel darstellen
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  if (0.299 * r + 0.587 * g + 0.114 * b > 200) hex = '#333333';
  return hex;
}
