import { bgWorldBounds } from '../core/background';
import { fmt2 } from '../core/format';
import type { Point } from '../core/geometry';
import { bounds, labelPoint, polygonArea } from '../core/geometry';
import type { Nutzungsgruppe, Storey } from '../core/model';
import { nutzungInfo } from '../core/norms';
import { BackgroundLayer } from './BackgroundLayer';

/**
 * Statischer, druckfähiger Grundriss eines Geschosses für die Flächenaufstellung:
 * BGF-Umrisse, Räume nach Nutzungsgruppe eingefärbt und beschriftet, Maßstabsleiste, Legende.
 * Die viewBox ist in Metern, daher skaliert die Grafik verlustfrei auf jede Druckbreite.
 */
export function PlanFigure({ storey, showBackground }: { storey: Storey; showBackground: boolean }) {
  const shapes = storey.shapes.filter((s) => s.points.length >= 3);
  if (!shapes.length) return null;

  const b = bounds(shapes.flatMap((s) => s.points));
  const w = Math.max(b.maxX - b.minX, 1);
  const h = Math.max(b.maxY - b.minY, 1);
  const margin = Math.max(w, h) * 0.06;
  const fs = Math.max(w, h) / 50; // Schriftgröße in Metern
  // unten zusätzlicher Streifen für die Maßstabsleiste
  const vb = { x: b.minX - margin, y: b.minY - margin, w: w + 2 * margin, h: h + 2 * margin + fs * 2.2 };
  const roomPts = shapes.filter((s) => s.kind === 'room').map((s) => s.points);
  const bg = showBackground && storey.background?.visible ? storey.background : undefined;
  // nur zeigen, wenn der Plan den Ausschnitt überhaupt berührt
  const bgHit = bg && (() => {
    const bb = bgWorldBounds(bg);
    return bb.maxX > vb.x && bb.minX < vb.x + vb.w && bb.maxY > vb.y && bb.minY < vb.y + vb.h;
  })();

  const path = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('') + 'Z';
  const outlines = shapes.filter((s) => s.kind === 'outline');
  const rooms = shapes.filter((s) => s.kind === 'room');
  const used = [...new Set(rooms.map((r) => (r.kind === 'room' ? r.nutzung : 'NUF1')))] as Nutzungsgruppe[];

  // Maßstabsleiste: runde Länge ≈ 1/5 der Breite
  const nice = [0.5, 1, 2, 5, 10, 20, 50, 100].find((v) => v >= vb.w / 6) ?? 100;
  const sbX = vb.x + margin * 0.3;
  const sbY = vb.y + vb.h - fs * 0.5;

  return (
    <figure className="plan-figure">
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" className="plan-svg">
        <defs>
          <pattern id={`ph-s-${storey.id}`} width={fs * 0.6} height={fs * 0.6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={fs * 0.6} stroke="#2a5bd7" strokeWidth={fs * 0.05} opacity="0.5" />
          </pattern>
          <pattern id={`ph-x-${storey.id}`} width={fs * 0.5} height={fs * 0.5} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2={fs * 0.5} stroke="#c0392b" strokeWidth={fs * 0.05} opacity="0.6" />
          </pattern>
        </defs>
        {bg && bgHit && <BackgroundLayer bg={{ ...bg, opacity: Math.min(bg.opacity, 0.45) }} k={1} tx={0} ty={0} minTextPx={0} />}
        {outlines.map((s) => (
          <path
            key={s.id}
            d={path(s.points)}
            fill={s.subtract ? `url(#ph-x-${storey.id})` : s.umschliessung === 'S' ? `url(#ph-s-${storey.id})` : 'rgba(42,91,215,0.06)'}
            stroke={s.subtract ? '#c0392b' : '#2a5bd7'}
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {rooms.map((s) =>
          s.kind === 'room' ? (
            <path
              key={s.id}
              d={path(s.points)}
              fill={s.subtract ? `url(#ph-x-${storey.id})` : nutzungInfo(s.nutzung).color}
              fillOpacity={s.subtract ? 1 : 0.5}
              stroke="#333"
              strokeWidth={0.8}
              strokeDasharray={s.umschliessung === 'S' ? '4 2' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}
        {shapes.map((s) => {
          const bb = bounds(s.points);
          const sw = bb.maxX - bb.minX;
          const sh = bb.maxY - bb.minY;
          if (sw < fs * 2.5 || sh < fs * 1.2) return null;
          const lp = labelPoint(s.points, s.kind === 'outline' ? roomPts : []);
          const area = polygonArea(s.points) * (s.subtract ? -1 : 1);
          const title = s.kind === 'room' ? [s.nummer, s.name].filter(Boolean).join(' ') : `${s.name} (${s.umschliessung})`;
          const two = sh > fs * 2.6 && sw > fs * Math.min(title.length * 0.55, 8);
          const f = s.kind === 'outline' ? fs * 0.85 : fs;
          return (
            <text key={`t-${s.id}`} x={lp.x} y={lp.y} fontSize={f} textAnchor="middle" className="plan-label">
              {two && (
                <tspan x={lp.x} dy={-f * 0.25} fontWeight="600">
                  {title}
                </tspan>
              )}
              <tspan x={lp.x} dy={two ? f * 1.15 : f * 0.35}>
                {fmt2(area)} m²
              </tspan>
            </text>
          );
        })}
        <g>
          <rect x={vb.x} y={vb.y + vb.h - fs * 2.2} width={vb.w} height={fs * 2.2} fill="#fff" />
          <rect x={sbX} y={sbY - fs * 0.25} width={nice / 2} height={fs * 0.25} fill="#333" />
          <rect x={sbX + nice / 2} y={sbY - fs * 0.25} width={nice / 2} height={fs * 0.25} fill="#fff" stroke="#333" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
          <text x={sbX} y={sbY - fs * 0.45} fontSize={fs * 0.75} className="plan-label">
            0
          </text>
          <text x={sbX + nice} y={sbY - fs * 0.45} fontSize={fs * 0.75} textAnchor="middle" className="plan-label">
            {String(nice).replace('.', ',')} m
          </text>
        </g>
      </svg>
      {used.length > 0 && (
        <figcaption className="plan-legend">
          {used.map((id) => (
            <span key={id}>
              <i style={{ background: nutzungInfo(id).color }} />
              {nutzungInfo(id).kurz} {nutzungInfo(id).label}
            </span>
          ))}
          <span>
            <i className="legend-bgf" />
            BGF-Umriss
          </span>
        </figcaption>
      )}
    </figure>
  );
}
