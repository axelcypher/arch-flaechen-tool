import { useEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '@core/geometry';
import { bounds, pointInPolygon, polygonArea } from '@core/geometry';
import { nutzungLabel, versiegelungInfo } from '@core/lageplan';
import { createLageplanFlaeche } from '@core/model';
import type { Nachweis } from '../massNutzung';
import { addFlaeche, mapFlaeche, removeFlaeche, useGrz } from '../store';
import type { Werkzeug } from '../store';

interface Ausschnitt {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fangradius in Bildschirmpixeln */
const FANG_PX = 10;

const WERKZEUGE: { id: Werkzeug; label: string; hint: string }[] = [
  {
    id: 'auswahl',
    label: 'Auswahl',
    hint: 'Fläche anklicken; Ecken ziehen verschiebt, Mittelpunkt ziehen fügt eine Ecke ein, Doppelklick auf eine Ecke löscht sie; Entf löscht die Fläche',
  },
  { id: 'polygon', label: 'Polygon', hint: 'Punkte setzen, ersten Punkt oder Doppelklick/Enter schließt; Rück löscht den letzten Punkt, Esc bricht ab' },
  { id: 'rechteck', label: 'Rechteck', hint: 'erste Ecke, dann Gegenecke klicken' },
];

/** Ziehen einer Ecke (bzw. eines Kantenmittelpunkts, der dann zur neuen Ecke wird) */
interface Ziehen {
  id: string;
  index: number;
  einfuegen: boolean;
  p: Point;
  bewegt: boolean;
}

/**
 * Lageplan: Gebäude (Hauptanlage), Grundstück und Lageplan-Flächen. Flächen lassen sich auswählen,
 * als Polygon oder Rechteck zeichnen, ihre Ecken verschieben, einfügen und löschen; Ecken von Gebäude
 * und Flächen werden gefangen.
 */
export function LageplanEditor({ n }: { n: Nachweis }) {
  const project = useGrz((s) => s.project);
  const selected = useGrz((s) => s.selected);
  const werkzeug = useGrz((s) => s.werkzeug);
  const st = useGrz.getState();
  const flaechen = project.lageplan?.flaechen ?? [];
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const pan = useRef<{ sx: number; sy: number; vb: Ausschnitt } | null>(null);
  const [ziehen, setZiehen] = useState<Ziehen | null>(null);
  // nach dem Ziehen keinen Klick (Auswahl) auslösen
  const gezogen = useRef(false);

  // Ausschnitt: eingepasst auf Gebäude und Flächen; neu beim Öffnen eines anderen Projekts
  const passend = useMemo<Ausschnitt>(() => {
    const pts: Point[] = [...n.hauptanlagePolygone.flat(), ...flaechen.flatMap((f) => f.points)];
    if (!pts.length) return { x: -20, y: -15, w: 40, h: 30 };
    const b = bounds(pts);
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08 + 1;
    return { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + 2 * pad, h: b.maxY - b.minY + 2 * pad };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.storeys, n.hauptanlagePolygone.length]);
  const [vb, setVb] = useState<Ausschnitt>(passend);
  useEffect(() => setVb(passend), [passend]);

  useEffect(() => setDraft([]), [werkzeug]);

  const skala = () => {
    const el = svgRef.current;
    const wPx = el?.clientWidth || 600;
    const hPx = el?.clientHeight || 400;
    return Math.max(vb.w / wPx, vb.h / hPx);
  };

  // Bildschirm → Plan (viewBox mit xMidYMid meet: Ausschnitt mittig, gleicher Maßstab in x und y)
  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current?.getBoundingClientRect();
    const wPx = r?.width || 600;
    const hPx = r?.height || 400;
    const s = Math.max(vb.w / wPx, vb.h / hPx);
    const x0 = vb.x - (wPx * s - vb.w) / 2;
    const y0 = vb.y - (hPx * s - vb.h) / 2;
    return { x: x0 + (e.clientX - (r?.left ?? 0)) * s, y: y0 + (e.clientY - (r?.top ?? 0)) * s };
  };

  const fangpunkte = useMemo(() => [...n.hauptanlagePolygone.flat(), ...flaechen.flatMap((f) => f.points)], [n.hauptanlagePolygone, flaechen]);
  const fang = (p: Point, ohne?: Point): Point => {
    const r = FANG_PX * skala();
    let best: Point | null = null;
    let d = r;
    for (const q of [...fangpunkte, ...draft]) {
      if (q === ohne) continue;
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < d) {
        d = dd;
        best = q;
      }
    }
    return best ? { ...best } : p;
  };

  const fertig = (pts: Point[]) => {
    setDraft([]);
    if (pts.length < 3 || polygonArea(pts) < 0.05) return;
    const f = createLageplanFlaeche(pts, `Fläche ${flaechen.length + 1}`);
    st.update((p) => addFlaeche(p, f));
    st.select(f.id);
  };

  const onClick = (e: React.MouseEvent) => {
    if (e.button !== 0 || e.altKey) return;
    if (gezogen.current) {
      gezogen.current = false;
      return;
    }
    const p = fang(toWorld(e));
    if (werkzeug === 'auswahl') {
      const hit = [...flaechen].reverse().find((f) => pointInPolygon(p, f.points));
      st.select(hit?.id ?? null);
      return;
    }
    if (werkzeug === 'rechteck') {
      if (!draft.length) setDraft([p]);
      else {
        const a = draft[0];
        fertig([a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }]);
      }
      return;
    }
    // Polygon: Klick auf den ersten Punkt schließt
    if (draft.length >= 3 && Math.hypot(p.x - draft[0].x, p.y - draft[0].y) < FANG_PX * skala()) fertig(draft);
    else setDraft([...draft, p]);
  };

  const onDoubleClick = () => {
    if (werkzeug === 'polygon' && draft.length >= 3) fertig(draft);
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = toWorld(e);
    const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setVb((v) => ({ x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w: v.w * f, h: v.h * f }));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      pan.current = { sx: e.clientX, sy: e.clientY, vb };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
  };
  const eckeGreifen = (e: React.PointerEvent, id: string, index: number, einfuegen: boolean, p: Point) => {
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setZiehen({ id, index, einfuegen, p, bewegt: false });
  };
  const eckeLoeschen = (e: React.MouseEvent, id: string, index: number) => {
    e.stopPropagation();
    st.update((p) => mapFlaeche(p, id, (f) => (f.points.length > 3 ? { ...f, points: f.points.filter((_, i) => i !== index) } : f)));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (ziehen) {
      const f = flaechen.find((x) => x.id === ziehen.id);
      setZiehen({ ...ziehen, p: fang(toWorld(e), ziehen.einfuegen ? undefined : f?.points[ziehen.index]), bewegt: true });
      return;
    }
    if (pan.current) {
      const k = skala();
      const { sx, sy, vb: v } = pan.current;
      setVb({ ...v, x: v.x - (e.clientX - sx) * k, y: v.y - (e.clientY - sy) * k });
      return;
    }
    if (werkzeug !== 'auswahl') setCursor(fang(toWorld(e)));
  };
  const onPointerUp = () => {
    pan.current = null;
    if (!ziehen) return;
    setZiehen(null);
    if (!ziehen.bewegt) return;
    gezogen.current = true;
    st.update((p) => mapFlaeche(p, ziehen.id, (f) => ({ ...f, points: mitGezogen(f.points, ziehen) })));
  };

  // Tastatur: Enter schließt, Esc bricht ab, Rück löscht den letzten Punkt, Entf löscht die Auswahl
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        if (draft.length) setDraft([]);
        else st.setWerkzeug('auswahl');
      } else if (e.key === 'Enter' && werkzeug === 'polygon' && draft.length >= 3) fertig(draft);
      else if (e.key === 'Backspace' && draft.length) setDraft(draft.slice(0, -1));
      else if (e.key === 'Delete' && selected && werkzeug === 'auswahl') st.update((p) => removeFlaeche(p, selected));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const k = skala();
  const d = (pts: Point[], zu = true) => `M${pts.map((p) => `${p.x} ${p.y}`).join('L')}${zu ? 'Z' : ''}`;
  const sel = flaechen.find((f) => f.id === selected);
  const punkteSel = sel ? (ziehen?.id === sel.id && ziehen.bewegt ? mitGezogen(sel.points, ziehen) : sel.points) : [];
  const vorschau = draft.length && cursor ? (werkzeug === 'rechteck' ? rechteck(draft[0], cursor) : [...draft, cursor]) : draft;

  return (
    <div className="lp-editor">
      <div className="lp-tools">
        {WERKZEUGE.map((w) => (
          <button key={w.id} className={werkzeug === w.id ? 'small active' : 'small'} title={w.hint} onClick={() => st.setWerkzeug(w.id)}>
            {w.label}
          </button>
        ))}
        <button className="small" title="Ansicht auf Gebäude und Flächen einpassen" onClick={() => setVb(passend)}>
          Einpassen
        </button>
        <span className="muted small-text lp-hint">{WERKZEUGE.find((w) => w.id === werkzeug)!.hint} · Mausrad zoomt, mittlere Maustaste oder Alt+Ziehen verschiebt</span>
      </div>
      <svg
        ref={svgRef}
        className={`grz-skizze lp-${werkzeug}`}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
      >
        <defs>
          <pattern id="grz-hatch" width={k * 8} height={k * 8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={k * 8} stroke="#2a5bd7" strokeWidth={k * 2} strokeOpacity={0.5} />
          </pattern>
        </defs>
        {flaechen.map((f) => (
          <path
            key={f.id}
            d={d(ziehen?.id === f.id && ziehen.bewegt ? mitGezogen(f.points, ziehen) : f.points)}
            fill={versiegelungInfo(f.versiegelung).color}
            fillOpacity={f.nachbar ? 0.15 : 0.55}
            stroke={f.id === selected ? 'var(--sel)' : f.nachbar ? '#9aa0a6' : '#5b6068'}
            strokeWidth={k * (f.id === selected ? 3 : 1)}
            strokeDasharray={f.nachbar ? `${k * 4} ${k * 3}` : undefined}
          >
            <title>{`${f.name} · ${nutzungLabel(f.nutzung)} · ${versiegelungInfo(f.versiegelung).label}${f.nachbar ? ' · Nachbar' : ''}`}</title>
          </path>
        ))}
        {n.hauptanlagePolygone.map((pts, i) => (
          <path key={`h${i}`} d={d(pts)} fill="url(#grz-hatch)" stroke="#1d3f96" strokeWidth={k * 2} fillRule="evenodd" pointerEvents="none" />
        ))}
        {n.grundstueckPolygone.map((pts, i) => (
          <path key={`g${i}`} d={d(pts)} fill="none" stroke="#1f2328" strokeWidth={k * 2.5} strokeDasharray={`${k * 10} ${k * 3} ${k * 2} ${k * 3}`} pointerEvents="none" />
        ))}
        {vorschau.length > 0 && (
          <g pointerEvents="none">
            <path d={d(vorschau, werkzeug === 'rechteck' || vorschau.length > 2)} fill="var(--sel)" fillOpacity={0.12} stroke="var(--sel)" strokeWidth={k * 1.5} />
            {draft.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={k * (i === 0 ? 5 : 3.5)} fill="var(--panel)" stroke="var(--sel)" strokeWidth={k * 1.5} />
            ))}
          </g>
        )}
        {werkzeug === 'auswahl' && sel && (
          <g className="lp-ecken">
            {punkteSel.map((p, i) => {
              const q = punkteSel[(i + 1) % punkteSel.length];
              const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
              return (
                <rect
                  key={`m${i}`}
                  x={m.x - k * 3}
                  y={m.y - k * 3}
                  width={k * 6}
                  height={k * 6}
                  className="lp-mitte"
                  strokeWidth={k * 1.2}
                  onPointerDown={(e) => eckeGreifen(e, sel.id, i, true, m)}
                >
                  <title>Ziehen fügt hier eine Ecke ein</title>
                </rect>
              );
            })}
            {punkteSel.map((p, i) => (
              <circle
                key={`e${i}`}
                cx={p.x}
                cy={p.y}
                r={k * 5}
                className="lp-ecke"
                strokeWidth={k * 1.5}
                onPointerDown={(e) => eckeGreifen(e, sel.id, i, false, p)}
                onDoubleClick={(e) => eckeLoeschen(e, sel.id, i)}
              >
                <title>Ecke ziehen; Doppelklick löscht sie</title>
              </circle>
            ))}
          </g>
        )}
        {cursor && werkzeug !== 'auswahl' && <circle cx={cursor.x} cy={cursor.y} r={k * 3} fill="var(--sel)" pointerEvents="none" />}
      </svg>
    </div>
  );
}

/** Punkte mit der gezogenen (bzw. eingefügten) Ecke */
function mitGezogen(pts: Point[], z: Ziehen): Point[] {
  if (z.einfuegen) return [...pts.slice(0, z.index + 1), z.p, ...pts.slice(z.index + 1)];
  return pts.map((p, i) => (i === z.index ? z.p : p));
}

function rechteck(a: Point, b: Point): Point[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}
