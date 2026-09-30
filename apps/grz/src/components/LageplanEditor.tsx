import { useEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '@core/geometry';
import { bounds, pointInPolygon, polygonArea } from '@core/geometry';
import { nutzungLabel, versiegelungInfo } from '@core/lageplan';
import { createLageplanFlaeche } from '@core/model';
import type { Nachweis } from '../massNutzung';
import { addFlaeche, removeFlaeche, useGrz } from '../store';
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
  { id: 'auswahl', label: 'Auswahl', hint: 'Fläche anklicken; Entf löscht die ausgewählte Fläche' },
  { id: 'polygon', label: 'Polygon', hint: 'Punkte setzen, ersten Punkt oder Doppelklick/Enter schließt; Rück löscht den letzten Punkt, Esc bricht ab' },
  { id: 'rechteck', label: 'Rechteck', hint: 'erste Ecke, dann Gegenecke klicken' },
];

/**
 * Lageplan: Gebäude (Hauptanlage), Grundstück und Lageplan-Flächen. Flächen lassen sich auswählen,
 * als Polygon oder Rechteck zeichnen und löschen; Ecken von Gebäude und Flächen werden gefangen.
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

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const el = svgRef.current;
    const m = el?.getScreenCTM?.();
    if (!el || !m) return { x: 0, y: 0 };
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const fangpunkte = useMemo(() => [...n.hauptanlagePolygone.flat(), ...flaechen.flatMap((f) => f.points)], [n.hauptanlagePolygone, flaechen]);
  const fang = (p: Point): Point => {
    const r = FANG_PX * skala();
    let best: Point | null = null;
    let d = r;
    for (const q of [...fangpunkte, ...draft]) {
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
  const onPointerMove = (e: React.PointerEvent) => {
    if (pan.current) {
      const k = skala();
      const { sx, sy, vb: v } = pan.current;
      setVb({ ...v, x: v.x - (e.clientX - sx) * k, y: v.y - (e.clientY - sy) * k });
      return;
    }
    if (werkzeug !== 'auswahl') setCursor(fang(toWorld(e)));
  };
  const onPointerUp = () => (pan.current = null);

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
            d={d(f.points)}
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
        {cursor && werkzeug !== 'auswahl' && <circle cx={cursor.x} cy={cursor.y} r={k * 3} fill="var(--sel)" pointerEvents="none" />}
      </svg>
    </div>
  );
}

function rechteck(a: Point, b: Point): Point[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}
