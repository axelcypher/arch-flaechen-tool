import { memo, useMemo } from 'react';
import type { Background, VectorBackground } from '../core/model';

/**
 * Stellt einen Hintergrundplan dar. Abbildung Welt → Bildschirm: screen = world × k + (tx, ty).
 * In der Zeichenfläche ist k die Zoomstufe (px/m), im Bericht (viewBox in Metern) ist k = 1.
 */
export function BackgroundLayer({ bg, k, tx, ty, minTextPx = 5 }: { bg: Background; k: number; tx: number; ty: number; minTextPx?: number }) {
  if (!bg.visible) return null;
  if (bg.type === 'raster') {
    return (
      <image
        href={bg.dataUrl}
        x={bg.x * k + tx}
        y={bg.y * k + ty}
        width={bg.widthPx * bg.metersPerPixel * k}
        height={bg.heightPx * bg.metersPerPixel * k}
        opacity={bg.opacity}
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      />
    );
  }
  const m = bg.scale * k;
  return (
    <g transform={`matrix(${m} 0 0 ${m} ${bg.x * k + tx} ${bg.y * k + ty})`} opacity={bg.opacity} style={{ pointerEvents: 'none' }}>
      <VectorPaths bg={bg} />
      <VectorTexts bg={bg} minH={minTextPx / m} />
    </g>
  );
}

/** Pfade je Layer; nur neu berechnet, wenn sich Geometrie oder Layer-Sichtbarkeit ändern. */
const VectorPaths = memo(
  function VectorPaths({ bg }: { bg: VectorBackground }) {
    const paths = useMemo(() => {
      const byLayer = new Map<number, string[]>();
      for (const pl of bg.polylines) {
        if (!bg.layers[pl.layer]?.visible) continue;
        const p = pl.pts;
        let d = `M${p[0]} ${p[1]}`;
        for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
        if (pl.closed) d += 'Z';
        let arr = byLayer.get(pl.layer);
        if (!arr) byLayer.set(pl.layer, (arr = []));
        arr.push(d);
      }
      return [...byLayer.entries()].map(([layer, ds]) => ({ layer, d: ds.join('') }));
    }, [bg.polylines, bg.layers]);
    return (
      <>
        {paths.map((p) => (
          <path key={p.layer} d={p.d} fill="none" stroke={bg.layers[p.layer].color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      </>
    );
  },
  (a, b) => a.bg.polylines === b.bg.polylines && a.bg.layers === b.bg.layers,
);

function VectorTexts({ bg, minH }: { bg: VectorBackground; minH: number }) {
  // kleine Texte weglassen – sie wären unlesbar und kosten nur Renderzeit
  const visible = bg.texts.filter((t) => t.h >= minH && bg.layers[t.layer]?.visible);
  if (visible.length > 3000) return null;
  return (
    <>
      {visible.map((t, i) => (
        <text
          key={i}
          x={t.x}
          y={t.y}
          fontSize={t.h}
          fill={bg.layers[t.layer].color}
          transform={t.rot ? `rotate(${t.rot} ${t.x} ${t.y})` : undefined}
          style={{ fontFamily: 'Arial, sans-serif' }}
        >
          {t.text}
        </text>
      ))}
    </>
  );
}
