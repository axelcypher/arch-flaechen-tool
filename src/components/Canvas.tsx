import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '../core/geometry';
import {
  bounds,
  distance,
  labelPoint,
  orthoConstrain,
  pointInPolygon,
  polygonArea,
  projectOnSegment,
  rectPoints,
  roundTo,
  snapToGrid,
  translate,
} from '../core/geometry';
import { fmt2, parseNum } from '../core/format';
import { NumberField } from './fields';
import type { Shape, Storey } from '../core/model';
import { createOutline, createRoom, shapeArea } from '../core/model';
import { nutzungInfo } from '../core/norms';
import { bgWorldBounds, scaleAround, vectorSegmentGrid } from '../core/background';
import { detectRegion } from '../core/detect';
import { SegmentGrid } from '../core/spatial';
import { loadImage, rasterEdgeRefiner, rasterMaskProvider } from '../platform/rasterMask';
import { mapStorey, nextRoomNumber, setShapePoints, useActiveStorey, useEditor } from '../store/store';
import { BackgroundLayer } from './BackgroundLayer';

interface Viewport {
  /** Pixel pro Meter */
  scale: number;
  tx: number;
  ty: number;
}

type SnapKind = 'vertex' | 'edge' | 'grid' | 'ortho' | 'none';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number }
  | { kind: 'vertex'; shapeId: string; index: number; started: boolean; sx: number; sy: number }
  | { kind: 'move'; shapeId: string; start: Point; orig: Point[]; started: boolean; sx: number; sy: number };

const VERTEX_SNAP_PX = 10;
const EDGE_SNAP_PX = 7;


function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'range', 'button'].includes((el as HTMLInputElement).type);
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function Canvas() {
  const storey = useActiveStorey();
  const project = useEditor((s) => s.project);
  const tool = useEditor((s) => s.tool);
  const drawKind = useEditor((s) => s.drawKind);
  const view = useEditor((s) => s.view);
  const selectedId = useEditor((s) => s.selectedShapeId);
  const fitRequest = useEditor((s) => s.fitRequest);
  const { update, updateSilent, checkpoint, select, setTool } = useEditor.getState();

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [vp, setVp] = useState<Viewport>({ scale: 40, tx: 60, ty: 60 });
  const [cursor, setCursor] = useState<{ p: Point; kind: SnapKind } | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [numBuf, setNumBuf] = useState('');
  const [measure, setMeasure] = useState<[Point, Point] | null>(null);
  const [calib, setCalib] = useState<[Point, Point] | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const drag = useRef<Drag | null>(null);
  const lastClick = useRef<{ t: number; x: number; y: number }>({ t: 0, x: 0, y: 0 });

  const gridStep = project.settings.gridStep;
  const storeyIndex = project.storeys.findIndex((s) => s.id === storey.id);
  const ghost: Storey | null = view.showGhost && storeyIndex > 0 ? project.storeys[storeyIndex - 1] : null;
  const selected = storey.shapes.find((s) => s.id === selectedId) ?? null;

  const toScreen = useCallback((p: Point) => ({ x: p.x * vp.scale + vp.tx, y: p.y * vp.scale + vp.ty }), [vp]);
  const toWorld = useCallback((sx: number, sy: number) => ({ x: (sx - vp.tx) / vp.scale, y: (sy - vp.ty) / vp.scale }), [vp]);

  /* ---------- Größe & Zoom ---------- */

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pts: Point[] = storey.shapes.flatMap((s) => s.points);
    const bg = storey.background;
    if (bg && bg.visible) {
      const b = bgWorldBounds(bg);
      pts.push({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY });
    }
    const el = svgRef.current;
    const w = el?.clientWidth || size.w;
    const h = el?.clientHeight || size.h;
    if (!pts.length) {
      setVp({ scale: 40, tx: 60, ty: 60 });
      return;
    }
    const b = bounds(pts);
    const bw = Math.max(b.maxX - b.minX, 1);
    const bh = Math.max(b.maxY - b.minY, 1);
    const scale = Math.min((w - 80) / bw, (h - 80) / bh);
    setVp({ scale, tx: w / 2 - ((b.minX + b.maxX) / 2) * scale, ty: h / 2 - ((b.minY + b.maxY) / 2) * scale });
  }, [storey, size]);

  // Zoom auf alles bei Projektwechsel / Anforderung
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    requestAnimationFrame(() => fitRef.current());
  }, [fitRequest]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      setVp((v) => {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
        const scale = Math.min(5000, Math.max(1, v.scale * factor));
        const wx = (sx - v.tx) / v.scale;
        const wy = (sy - v.ty) / v.scale;
        return { scale, tx: sx - wx * scale, ty: sy - wy * scale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Zeichnungsentwurf verwerfen, wenn Werkzeug oder Geschoss wechselt
  useEffect(() => {
    setDraft([]);
    setNumBuf('');
    if (tool !== 'measure') setMeasure(null);
    setCalib(null);
  }, [tool, storey.id]);

  /* ---------- Fang ---------- */

  const snapCandidates = useMemo(() => {
    const shapes: Shape[] = [];
    if (view.showOutlines) shapes.push(...storey.shapes.filter((s) => s.kind === 'outline'));
    if (view.showRooms) shapes.push(...storey.shapes.filter((s) => s.kind === 'room'));
    if (ghost) shapes.push(...ghost.shapes);
    return shapes;
  }, [storey, ghost, view.showOutlines, view.showRooms]);

  const bgVisible = !!storey.background?.visible && view.showBackground;
  const vectorGrid = useMemo(
    () => (bgVisible && storey.background?.type === 'vector' ? vectorSegmentGrid(storey.background) : null),
    [bgVisible, storey.background],
  );

  const snap = useCallback(
    (raw: Point, mods: { alt: boolean; shift: boolean }, origin: Point | null, exclude?: { shapeId: string; index: number }) => {
      if (mods.alt) return { p: raw, kind: 'none' as SnapKind };
      if (origin && mods.shift) {
        const o = orthoConstrain(origin, raw);
        if (view.snapGrid) {
          if (o.y === origin.y) o.x = origin.x + roundTo(o.x - origin.x, gridStep);
          else o.y = origin.y + roundTo(o.y - origin.y, gridStep);
        }
        return { p: o, kind: 'ortho' as SnapKind };
      }
      if (view.snapVertices) {
        const vTol = VERTEX_SNAP_PX / vp.scale;
        let best: Point | null = null;
        let bestD = vTol;
        const consider = (q: Point) => {
          const d = distance(q, raw);
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        };
        for (const s of snapCandidates) {
          s.points.forEach((q, i) => {
            if (exclude && exclude.shapeId === s.id && exclude.index === i) return;
            consider(q);
          });
        }
        draft.forEach(consider);
        const near = vectorGrid ? vectorGrid.query(raw.x - vTol, raw.y - vTol, raw.x + vTol, raw.y + vTol) : [];
        for (const i of near) {
          const [x1, y1, x2, y2] = vectorGrid!.seg(i);
          consider({ x: x1, y: y1 });
          consider({ x: x2, y: y2 });
        }
        if (best) return { p: { ...(best as Point) }, kind: 'vertex' as SnapKind };

        const eTol = EDGE_SNAP_PX / vp.scale;
        let bestE: Point | null = null;
        let bestED = eTol;
        for (const s of snapCandidates) {
          const n = s.points.length;
          for (let i = 0; i < n; i++) {
            if (exclude && exclude.shapeId === s.id && (exclude.index === i || exclude.index === (i + 1) % n)) continue;
            const pr = projectOnSegment(raw, s.points[i], s.points[(i + 1) % n]);
            if (pr.dist < bestED) {
              bestED = pr.dist;
              bestE = pr.point;
            }
          }
        }
        const eNear = vectorGrid ? vectorGrid.query(raw.x - eTol, raw.y - eTol, raw.x + eTol, raw.y + eTol) : [];
        for (const i of eNear) {
          const [x1, y1, x2, y2] = vectorGrid!.seg(i);
          const pr = projectOnSegment(raw, { x: x1, y: y1 }, { x: x2, y: y2 });
          if (pr.dist < bestED) {
            bestED = pr.dist;
            bestE = pr.point;
          }
        }
        if (bestE) {
          const e = bestE as Point;
          return { p: { x: roundTo(e.x, 1e-4), y: roundTo(e.y, 1e-4) }, kind: 'edge' as SnapKind };
        }
      }
      if (view.snapGrid) return { p: snapToGrid(raw, gridStep), kind: 'grid' as SnapKind };
      return { p: raw, kind: 'none' as SnapKind };
    },
    [view.snapGrid, view.snapVertices, gridStep, vp.scale, snapCandidates, draft, vectorGrid],
  );

  /* ---------- Formen anlegen ---------- */

  const finishShape = useCallback(
    (pts: Point[]) => {
      const clean = pts.filter((p, i) => i === 0 || distance(p, pts[i - 1]) > 1e-6);
      if (clean.length > 3 && distance(clean[0], clean[clean.length - 1]) < 1e-6) clean.pop();
      setDraft([]);
      setNumBuf('');
      if (clean.length < 3 || polygonArea(clean) < 1e-6) return;
      const st = storey;
      const shape =
        drawKind === 'outline'
          ? createOutline(clean, st.shapes.some((s) => s.kind === 'outline') ? 'BGF-Teilfläche' : 'BGF')
          : createRoom(clean, nextRoomNumber(project, st));
      update((p) => mapStorey(p, st.id, (s) => ({ ...s, shapes: [...s.shapes, shape] })));
      select(shape.id);
    },
    [storey, drawKind, project, update, select],
  );

  const applyNumeric = useCallback(() => {
    const buf = numBuf.trim();
    if (!buf) return false;
    const last = draft[draft.length - 1];
    if (!last) return false;
    const cur = cursor?.p ?? { x: last.x + 1, y: last.y };
    if (tool === 'polygon') {
      const rel = buf.split(';');
      if (rel.length === 2) {
        const dx = parseNum(rel[0]);
        const dy = parseNum(rel[1]);
        if (dx === null || dy === null) return false;
        setDraft([...draft, { x: last.x + dx, y: last.y + dy }]);
      } else {
        const len = parseNum(buf);
        if (len === null) return false;
        let dx = cur.x - last.x;
        let dy = cur.y - last.y;
        const d = Math.hypot(dx, dy);
        if (d < 1e-9) {
          dx = 1;
          dy = 0;
        } else {
          dx /= d;
          dy /= d;
        }
        setDraft([...draft, { x: roundTo(last.x + dx * len, 1e-4), y: roundTo(last.y + dy * len, 1e-4) }]);
      }
      setNumBuf('');
      return true;
    }
    if (tool === 'rect') {
      const parts = buf.split(/[x;*]/i);
      if (parts.length !== 2) return false;
      const w = parseNum(parts[0]);
      const h = parseNum(parts[1]);
      if (w === null || h === null) return false;
      const sx = cur.x < last.x ? -1 : 1;
      const sy = cur.y < last.y ? -1 : 1;
      finishShape(rectPoints(last, { x: last.x + sx * w, y: last.y + sy * h }));
      return true;
    }
    return false;
  }, [numBuf, draft, cursor, tool, finishShape]);

  /* ---------- Tastatur ---------- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const st = useEditor.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        st.undo();
        return;
      }
      if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        st.redo();
        return;
      }
      if (ctrl) return;
      if (e.key === ' ') {
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      const drawing = draft.length > 0 && (tool === 'polygon' || tool === 'rect');
      if (drawing && /^[0-9.,;xX*-]$/.test(e.key)) {
        setNumBuf((b) => b + e.key);
        e.preventDefault();
        return;
      }
      switch (e.key) {
        case 'Escape':
          if (numBuf) setNumBuf('');
          else if (draft.length) setDraft([]);
          else if (calib) setCalib(null);
          else if (tool !== 'select') setTool('select');
          else st.select(null);
          break;
        case 'Enter':
          if (numBuf) applyNumeric();
          else if (tool === 'polygon' && draft.length >= 3) finishShape(draft);
          break;
        case 'Backspace':
          if (numBuf) setNumBuf((b) => b.slice(0, -1));
          else if (draft.length) setDraft((d) => d.slice(0, -1));
          else if (st.selectedShapeId) deleteSelected();
          e.preventDefault();
          break;
        case 'Delete':
          deleteSelected();
          break;
        case 'v':
        case 'V':
          setTool('select');
          break;
        case 'p':
        case 'P':
          setTool('polygon');
          break;
        case 'r':
        case 'R':
          setTool('rect');
          break;
        case 'm':
        case 'M':
          setTool('measure');
          break;
        case 'e':
        case 'E':
          setTool('detect');
          break;
        case 'b':
        case 'B':
          st.setDrawKind('outline');
          break;
        case 'n':
        case 'N':
          st.setDrawKind('room');
          break;
        case 'f':
        case 'F':
          fitRef.current();
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
    };
    function deleteSelected() {
      const st = useEditor.getState();
      const id = st.selectedShapeId;
      if (!id) return;
      st.update((p) => mapStorey(p, storey.id, (s) => ({ ...s, shapes: s.shapes.filter((x) => x.id !== id) })));
      st.select(null);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [draft, tool, numBuf, calib, applyNumeric, finishShape, storey.id, setTool]);

  /* ---------- Maus ---------- */

  const localPos = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const startPan = (e: React.PointerEvent) => {
    const { sx, sy } = localPos(e);
    drag.current = { kind: 'pan', sx, sy, tx: vp.tx, ty: vp.ty };
    svgRef.current!.setPointerCapture(e.pointerId);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const { sx, sy } = localPos(e);
    const raw = toWorld(sx, sy);
    const origin = draft.length ? draft[draft.length - 1] : null;
    const { p } = snap(raw, { alt: e.altKey, shift: e.shiftKey }, origin);

    const now = performance.now();
    const isDouble = now - lastClick.current.t < 350 && Math.hypot(sx - lastClick.current.x, sy - lastClick.current.y) < 5;
    lastClick.current = { t: now, x: sx, y: sy };

    switch (tool) {
      case 'select':
        select(null);
        startPan(e);
        break;
      case 'polygon': {
        if (isDouble && draft.length >= 3) {
          finishShape(draft);
          break;
        }
        if (draft.length >= 3 && distance(toScreen(p), toScreen(draft[0])) < VERTEX_SNAP_PX) {
          finishShape(draft);
          break;
        }
        if (draft.length && distance(p, draft[draft.length - 1]) < 1e-9) break;
        setDraft([...draft, p]);
        setNumBuf('');
        break;
      }
      case 'rect':
        if (!draft.length) setDraft([p]);
        else finishShape(rectPoints(draft[0], p));
        break;
      case 'measure':
        if (draft.length === 0) {
          setDraft([p]);
          setMeasure(null);
        } else {
          setMeasure([draft[0], p]);
          setDraft([]);
        }
        break;
      case 'detect':
        void runDetection(raw);
        break;
      case 'calibrate':
        if (!storey.background) break;
        if (draft.length === 0) setDraft([p]);
        else {
          if (distance(draft[0], p) > 1e-6) setCalib([draft[0], p]);
          setDraft([]);
        }
        break;
    }
  };

  const detect = useEditor((s) => s.detect);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  const runDetection = async (click: Point) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const grids: SegmentGrid[] = [];
      const bg = storey.background;
      if (bg && bgVisible && bg.type === 'vector') grids.push(vectorSegmentGrid(bg, { skipArcs: detect.skipArcs }));
      // Kanten vorhandener (sichtbarer) Flächen begrenzen ebenfalls
      const edges: number[] = [];
      for (const s of storey.shapes) {
        if ((s.kind === 'outline' && !view.showOutlines) || (s.kind === 'room' && !view.showRooms)) continue;
        const n = s.points.length;
        for (let i = 0; i < n; i++) {
          const a = s.points[i];
          const b = s.points[(i + 1) % n];
          edges.push(a.x, a.y, b.x, b.y);
        }
      }
      if (edges.length) grids.push(new SegmentGrid(edges));
      let rasterMask: ReturnType<typeof rasterMaskProvider> | undefined;
      let refineEdge: ReturnType<typeof rasterEdgeRefiner> | undefined;
      if (bg && bgVisible && bg.type === 'raster') {
        const img = await loadImage(bg.dataUrl);
        rasterMask = rasterMaskProvider(bg, img, detect.threshold);
        refineEdge = rasterEdgeRefiner(bg, img);
      }
      if (!grids.length && !rasterMask) {
        setMessage('Keine Linien vorhanden: zuerst einen Plan laden oder einen BGF-Umriss zeichnen.');
        return;
      }
      // dem Browser einen Frame für die Anzeige des Wartezustands lassen
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const res = detectRegion({ click, grids, rasterMask, refineEdge, gap: detect.gap, ignoreThinLines: detect.ignoreThin ? 0.05 : 0 });
      if (!res.ok) setMessage(res.error);
      else finishShape(res.points);
    } catch (e) {
      setMessage(`Erkennung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onShapePointerDown = (e: React.PointerEvent, shape: Shape) => {
    if (tool !== 'select' || e.button !== 0 || spaceDown) return;
    e.stopPropagation();
    select(shape.id);
    const { sx, sy } = localPos(e);
    drag.current = { kind: 'move', shapeId: shape.id, start: toWorld(sx, sy), orig: shape.points, started: false, sx, sy };
    svgRef.current!.setPointerCapture(e.pointerId);
  };

  const onVertexPointerDown = (e: React.PointerEvent, shape: Shape, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { sx, sy } = localPos(e);
    drag.current = { kind: 'vertex', shapeId: shape.id, index, started: false, sx, sy };
    svgRef.current!.setPointerCapture(e.pointerId);
  };

  const onMidpointPointerDown = (e: React.PointerEvent, shape: Shape, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const a = shape.points[index];
    const b = shape.points[(index + 1) % shape.points.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const pts = [...shape.points];
    pts.splice(index + 1, 0, mid);
    update((p) => setShapePoints(p, storey.id, shape.id, pts));
    const { sx, sy } = localPos(e);
    // Einfügen ist bereits ein Undo-Schritt, das anschließende Ziehen gehört dazu
    drag.current = { kind: 'vertex', shapeId: shape.id, index: index + 1, started: true, sx, sy };
    svgRef.current!.setPointerCapture(e.pointerId);
  };

  const onVertexContextMenu = (e: React.MouseEvent, shape: Shape, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (shape.points.length <= 3) return;
    update((p) => setShapePoints(p, storey.id, shape.id, shape.points.filter((_, i) => i !== index)));
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const { sx, sy } = localPos(e);
    const raw = toWorld(sx, sy);
    const d = drag.current;
    const mods = { alt: e.altKey, shift: e.shiftKey };

    if (d?.kind === 'pan') {
      setVp((v) => ({ ...v, tx: d.tx + (sx - d.sx), ty: d.ty + (sy - d.sy) }));
      return;
    }
    if (d?.kind === 'vertex') {
      if (!d.started) {
        if (Math.hypot(sx - d.sx, sy - d.sy) < 3) return;
        d.started = true;
        checkpoint();
      }
      const shape = storey.shapes.find((s) => s.id === d.shapeId);
      if (!shape) return;
      const n = shape.points.length;
      const s = snap(raw, mods, shape.points[(d.index - 1 + n) % n], { shapeId: d.shapeId, index: d.index });
      setCursor(s);
      const pts = shape.points.map((q, i) => (i === d.index ? s.p : q));
      updateSilent((p) => setShapePoints(p, storey.id, d.shapeId, pts));
      return;
    }
    if (d?.kind === 'move') {
      if (!d.started) {
        if (Math.hypot(sx - d.sx, sy - d.sy) < 3) return;
        d.started = true;
        checkpoint();
      }
      let dx = raw.x - d.start.x;
      let dy = raw.y - d.start.y;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (view.snapGrid && !e.altKey) {
        dx = roundTo(dx, gridStep);
        dy = roundTo(dy, gridStep);
      }
      const pts = translate(d.orig, dx, dy);
      updateSilent((p) => setShapePoints(p, storey.id, d.shapeId, pts));
      return;
    }
    const origin = draft.length ? draft[draft.length - 1] : null;
    setCursor(snap(raw, mods, tool === 'select' ? null : origin));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
  };

  /* ---------- Kalibrierung Hintergrundbild ---------- */

  const applyCalibration = (realLength: number) => {
    const bg = storey.background;
    if (!calib || !bg) return;
    const [a, b] = calib;
    const measured = distance(a, b);
    if (measured < 1e-9 || !(realLength > 0)) return;
    update((p) => mapStorey(p, storey.id, (s) => ({ ...s, background: scaleAround(bg, realLength / measured, a) })));
    setCalib(null);
    setTool('select');
    requestAnimationFrame(() => fitRef.current());
  };

  /* ---------- Rendering ---------- */

  const pathOf = (pts: Point[], close = true) =>
    pts.length ? pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x * vp.scale + vp.tx).toFixed(2)},${(p.y * vp.scale + vp.ty).toFixed(2)}`).join('') + (close ? 'Z' : '') : '';

  const grid = useMemo(() => {
    const steps = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500];
    const minor = steps.find((s) => s * vp.scale >= 12) ?? 500;
    const major = steps.find((s) => s > minor * 4 && s * vp.scale >= 60) ?? minor * 10;
    const w0 = toWorld(0, 0);
    const w1 = toWorld(size.w, size.h);
    const lines: { d: string; major: boolean }[] = [];
    const x0 = Math.floor(w0.x / minor) * minor;
    for (let x = x0; x <= w1.x; x += minor) {
      const sx = x * vp.scale + vp.tx;
      lines.push({ d: `M${sx.toFixed(1)},0V${size.h}`, major: Math.abs(x / major - Math.round(x / major)) < 1e-6 });
    }
    const y0 = Math.floor(w0.y / minor) * minor;
    for (let y = y0; y <= w1.y; y += minor) {
      const sy = y * vp.scale + vp.ty;
      lines.push({ d: `M0,${sy.toFixed(1)}H${size.w}`, major: Math.abs(y / major - Math.round(y / major)) < 1e-6 });
    }
    return {
      minorPath: lines.filter((l) => !l.major).map((l) => l.d).join(''),
      majorPath: lines.filter((l) => l.major).map((l) => l.d).join(''),
    };
  }, [vp, size, toWorld]);

  const outlines = view.showOutlines ? storey.shapes.filter((s) => s.kind === 'outline') : [];
  const rooms = view.showRooms ? storey.shapes.filter((s) => s.kind === 'room') : [];

  // Beschriftungspunkte; BGF-Beschriftungen weichen sichtbaren Räumen aus
  const labelPoints = useMemo(() => {
    const m = new Map<string, Point>();
    const roomPts = view.showRooms ? storey.shapes.filter((s) => s.kind === 'room').map((s) => s.points) : [];
    for (const s of storey.shapes) m.set(s.id, labelPoint(s.points, s.kind === 'outline' ? roomPts : []));
    return m;
  }, [storey.shapes, view.showRooms]);

  const shapeStyle = (s: Shape): React.SVGProps<SVGPathElement> => {
    const isSel = s.id === selectedId;
    if (s.subtract) {
      return { fill: 'url(#hatch-subtract)', stroke: isSel ? 'var(--sel)' : '#c0392b', strokeWidth: isSel ? 2.5 : 1.5, strokeDasharray: '6 3' };
    }
    if (s.kind === 'outline') {
      return {
        fill: s.umschliessung === 'S' ? 'url(#hatch-s)' : 'rgba(42, 91, 215, 0.08)',
        stroke: isSel ? 'var(--sel)' : '#2a5bd7',
        strokeWidth: isSel ? 3 : 2,
      };
    }
    const c = nutzungInfo(s.nutzung).color;
    return {
      fill: c,
      fillOpacity: 0.45,
      stroke: isSel ? 'var(--sel)' : '#444',
      strokeWidth: isSel ? 2.5 : 1,
      strokeDasharray: s.umschliessung === 'S' ? '5 3' : undefined,
    };
  };

  const renderLabel = (s: Shape) => {
    if (s.points.length < 3) return null;
    const lp = toScreen(labelPoints.get(s.id) ?? labelPoint(s.points));
    const b = bounds(s.points);
    const wPx = (b.maxX - b.minX) * vp.scale;
    const hPx = (b.maxY - b.minY) * vp.scale;
    if (wPx < 30 || hPx < 16) return null;
    const area = shapeArea(s) * (s.subtract ? -1 : 1);
    const title = s.kind === 'room' ? [s.nummer, s.name].filter(Boolean).join(' ') : `${s.name} (${s.umschliessung})`;
    const showTitle = wPx > 70 && hPx > 34 && title;
    return (
      <text key={`l-${s.id}`} className="shape-label" x={lp.x} y={lp.y} textAnchor="middle">
        {showTitle && (
          <tspan x={lp.x} dy="-0.35em" className="shape-label-title">
            {title}
          </tspan>
        )}
        <tspan x={lp.x} dy={showTitle ? '1.2em' : '0.35em'}>
          {fmt2(area)} m²
        </tspan>
      </text>
    );
  };

  const renderDimensions = (pts: Point[], closed: boolean) => {
    const n = pts.length;
    const out: React.ReactNode[] = [];
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const len = distance(a, b);
      if (len * vp.scale < 28) continue;
      const sa = toScreen(a);
      const sb = toScreen(b);
      const mx = (sa.x + sb.x) / 2;
      const my = (sa.y + sb.y) / 2;
      let nx = (sb.y - sa.y) / (len * vp.scale);
      let ny = -(sb.x - sa.x) / (len * vp.scale);
      if (closed) {
        const probe = toWorld(mx + nx * 3, my + ny * 3);
        if (pointInPolygon(probe, pts)) {
          nx = -nx;
          ny = -ny;
        }
      }
      out.push(
        <text key={`d${i}`} className="dim-label" x={mx + nx * 12} y={my + ny * 12 + 4} textAnchor="middle">
          {fmt2(len)}
        </text>,
      );
    }
    return out;
  };

  const bg = storey.background;
  const origin = draft.length ? draft[draft.length - 1] : null;
  const preview = cursor && draft.length ? cursor.p : null;

  let hint = '';
  switch (tool) {
    case 'select':
      hint = 'Klicken: auswählen · Ziehen: verschieben · Punkt ziehen: ändern · ◇ ziehen: Punkt einfügen · Rechtsklick auf Punkt: löschen';
      break;
    case 'polygon':
      hint = draft.length
        ? 'Klicken: nächster Punkt · Zahl + Enter: Länge in Mausrichtung · dx;dy + Enter: relativ · Enter/Doppelklick/Startpunkt: schließen · ⇧ orthogonal'
        : `Ersten Punkt setzen (${drawKind === 'outline' ? 'BGF-Umriss' : 'Raum'})`;
      break;
    case 'rect':
      hint = draft.length ? 'Gegenecke klicken oder Maße eingeben, z. B. 4,5x3,2 + Enter' : `Erste Ecke setzen (${drawKind === 'outline' ? 'BGF-Umriss' : 'Raum'})`;
      break;
    case 'detect':
      hint = busy
        ? 'Erkenne Fläche …'
        : `In einen umschlossenen Bereich klicken – die Fläche wird als ${drawKind === 'outline' ? 'BGF-Umriss' : 'Raum'} angelegt (Türöffnungen bis ${fmt2(detect.gap)} m werden geschlossen)`;
      break;
    case 'measure':
      hint = 'Zwei Punkte klicken, um einen Abstand zu messen';
      break;
    case 'calibrate':
      hint = bg ? 'Zwei Punkte mit bekanntem Abstand auf dem Plan anklicken' : 'Zuerst einen Plan laden (Geschoss-Eigenschaften rechts)';
      break;
  }

  const cursorStyle = busy ? 'progress' : drag.current?.kind === 'pan' || spaceDown ? 'grabbing' : tool === 'select' ? 'default' : tool === 'detect' ? 'cell' : 'crosshair';

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => !drag.current && setCursor(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="hatch-s" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="rgba(42, 91, 215, 0.05)" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(42, 91, 215, 0.35)" strokeWidth="1.5" />
          </pattern>
          <pattern id="hatch-subtract" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect width="7" height="7" fill="rgba(255,255,255,0.6)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(192, 57, 43, 0.6)" strokeWidth="1.5" />
          </pattern>
        </defs>

        <rect width={size.w} height={size.h} className="canvas-bg" />
        {bg && view.showBackground && <BackgroundLayer bg={bg} k={vp.scale} tx={vp.tx} ty={vp.ty} />}
        <path d={grid.minorPath} className="grid-minor" />
        <path d={grid.majorPath} className="grid-major" />

        {ghost &&
          ghost.shapes.map((s) => <path key={`g-${s.id}`} d={pathOf(s.points)} className="ghost" />)}

        <g style={{ pointerEvents: tool === 'select' && !spaceDown ? 'visiblePainted' : 'none' }}>
          {[...outlines, ...rooms].map((s) => (
            <path
              key={s.id}
              d={pathOf(s.points)}
              {...shapeStyle(s)}
              fillRule="evenodd"
              strokeLinejoin="round"
              onPointerDown={(e) => onShapePointerDown(e, s)}
              style={{ cursor: tool === 'select' ? 'move' : undefined }}
            />
          ))}
        </g>
        <g style={{ pointerEvents: 'none' }}>{[...outlines, ...rooms].map(renderLabel)}</g>

        {selected && tool === 'select' && (
          <g>
            <path d={pathOf(selected.points)} fill="none" stroke="var(--sel)" strokeWidth={2} pointerEvents="none" />
            {view.showDimensions && <g pointerEvents="none">{renderDimensions(selected.points, true)}</g>}
            {selected.points.map((a, i) => {
              const b = selected.points[(i + 1) % selected.points.length];
              const m = toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
              if (distance(a, b) * vp.scale < 24) return null;
              return (
                <rect
                  key={`m${i}`}
                  className="mid-handle"
                  x={m.x - 4}
                  y={m.y - 4}
                  width={8}
                  height={8}
                  transform={`rotate(45 ${m.x} ${m.y})`}
                  onPointerDown={(e) => onMidpointPointerDown(e, selected, i)}
                />
              );
            })}
            {selected.points.map((p, i) => {
              const s = toScreen(p);
              return (
                <circle
                  key={`v${i}`}
                  className="vertex-handle"
                  cx={s.x}
                  cy={s.y}
                  r={5}
                  onPointerDown={(e) => onVertexPointerDown(e, selected, i)}
                  onContextMenu={(e) => onVertexContextMenu(e, selected, i)}
                />
              );
            })}
          </g>
        )}

        {/* Entwurf beim Zeichnen */}
        {draft.length > 0 && (tool === 'polygon' || tool === 'rect') && (
          <g pointerEvents="none">
            {tool === 'polygon' && (
              <>
                <path d={pathOf(preview ? [...draft, preview] : draft, false)} className="draft" />
                {draft.length >= 2 && preview && <path d={pathOf([...draft, preview])} className="draft-fill" />}
                {renderDimensions(preview ? [...draft, preview] : draft, false)}
              </>
            )}
            {tool === 'rect' && preview && (
              <>
                <path d={pathOf(rectPoints(draft[0], preview))} className="draft draft-fill" />
                {renderDimensions(rectPoints(draft[0], preview).slice(0, 3), false)}
              </>
            )}
            {draft.map((p, i) => {
              const s = toScreen(p);
              return <circle key={i} cx={s.x} cy={s.y} r={i === 0 ? 5 : 3.5} className={i === 0 ? 'draft-start' : 'draft-point'} />;
            })}
          </g>
        )}

        {/* Messen / Kalibrieren */}
        {(tool === 'measure' || tool === 'calibrate') && (
          <g pointerEvents="none">
            {(() => {
              const seg = draft.length && preview ? ([draft[0], preview] as [Point, Point]) : tool === 'measure' ? measure : calib;
              if (!seg) return null;
              const a = toScreen(seg[0]);
              const b = toScreen(seg[1]);
              return (
                <>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="measure-line" />
                  <circle cx={a.x} cy={a.y} r={3.5} className="draft-point" />
                  <circle cx={b.x} cy={b.y} r={3.5} className="draft-point" />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} textAnchor="middle" className="dim-label measure-label">
                    {fmt2(distance(seg[0], seg[1]))} m
                  </text>
                </>
              );
            })()}
          </g>
        )}

        {/* Fangsymbol */}
        {cursor && tool !== 'select' && (
          <g pointerEvents="none">
            {(() => {
              const s = toScreen(cursor.p);
              switch (cursor.kind) {
                case 'vertex':
                  return <rect x={s.x - 6} y={s.y - 6} width={12} height={12} className="snap-marker" />;
                case 'edge':
                  return <path d={`M${s.x},${s.y - 7}L${s.x + 7},${s.y}L${s.x},${s.y + 7}L${s.x - 7},${s.y}Z`} className="snap-marker" />;
                default:
                  return <path d={`M${s.x - 7},${s.y}H${s.x + 7}M${s.x},${s.y - 7}V${s.y + 7}`} className="snap-cross" />;
              }
            })()}
          </g>
        )}
      </svg>

      <div className="hud">
        <span className="hud-coords">
          {cursor ? `X ${fmt2(cursor.p.x)}  Y ${fmt2(cursor.p.y)} m` : '—'}
          {cursor && cursor.kind !== 'none' && cursor.kind !== 'grid' && tool !== 'select' && (
            <em> · Fang: {{ vertex: 'Punkt', edge: 'Kante', ortho: 'orthogonal', grid: 'Raster', none: '' }[cursor.kind]}</em>
          )}
          {origin && preview && tool === 'polygon' && <em> · Segment {fmt2(distance(origin, preview))} m</em>}
        </span>
        {numBuf && <span className="hud-input">Eingabe: {numBuf}▏</span>}
        <span className="hud-hint">{hint}</span>
      </div>
      <ScaleBar scale={vp.scale} />
      <div className="canvas-controls" title="Alt gedrückt halten: Fang aus · Shift: orthogonal">
        <label className="toggle">
          <input type="checkbox" checked={view.snapGrid} onChange={(e) => useEditor.getState().setView({ snapGrid: e.target.checked })} />
          Raster ({fmt2(gridStep * 100).replace(',00', '')} cm)
        </label>
        <label className="toggle">
          <input type="checkbox" checked={view.snapVertices} onChange={(e) => useEditor.getState().setView({ snapVertices: e.target.checked })} />
          Punktfang
        </label>
        <button className="small" onClick={() => fitRef.current()} title="Alles zeigen (F)">
          ⤢ Alles
        </button>
      </div>
      {tool === 'detect' && (
        <div className="canvas-controls detect-controls">
          <label className="toggle" title="Größte Öffnung (z. B. Türbreite), die beim Erkennen geschlossen wird. Muss kleiner sein als der schmalste Raum.">
            Lückenschluss
            <NumberField value={detect.gap} min={0} max={5} onChange={(v) => v !== undefined && useEditor.getState().setDetect({ gap: v })} />m
          </label>
          {bg?.type === 'vector' && (
            <label className="toggle" title="Bögen und Kreise (z. B. Türaufschläge) nicht als Begrenzung verwenden">
              <input type="checkbox" checked={detect.skipArcs} onChange={(e) => useEditor.getState().setDetect({ skipArcs: e.target.checked })} />
              Bögen ignorieren
            </label>
          )}
          {bg?.type === 'raster' && (
            <label className="toggle" title="Dünne Linien (Türaufschläge, Möbel) nicht als Begrenzung verwenden – solange der Raum trotzdem geschlossen ist">
              <input type="checkbox" checked={detect.ignoreThin} onChange={(e) => useEditor.getState().setDetect({ ignoreThin: e.target.checked })} />
              dünne Linien ignorieren
            </label>
          )}
          {bg?.type === 'raster' && (
            <label className="toggle" title="Pixel dunkler als dieser Wert gelten als Wand/Linie">
              Schwelle
              <input
                type="range"
                min={60}
                max={250}
                step={5}
                value={detect.threshold}
                onChange={(e) => useEditor.getState().setDetect({ threshold: Number(e.target.value) })}
              />
            </label>
          )}
        </div>
      )}
      {message && (
        <div className="canvas-message" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}

      {calib && <CalibrationDialog measured={distance(calib[0], calib[1])} onApply={applyCalibration} onCancel={() => setCalib(null)} />}
    </div>
  );
}

function ScaleBar({ scale }: { scale: number }) {
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  const len = candidates.find((c) => c * scale >= 80) ?? 500;
  return (
    <div className="scalebar">
      <div className="scalebar-bar" style={{ width: len * scale }} />
      <span>{String(len).replace('.', ',')} m</span>
    </div>
  );
}

function CalibrationDialog({ measured, onApply, onCancel }: { measured: number; onApply: (v: number) => void; onCancel: () => void }) {
  const [val, setVal] = useState('');
  const v = parseNum(val);
  return (
    <div className="overlay-dialog" onPointerDown={(e) => e.stopPropagation()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (v && v > 0) onApply(v);
        }}
      >
        <h3>Plan kalibrieren</h3>
        <p>
          Gemessene Strecke im aktuellen Maßstab: <strong>{fmt2(measured)} m</strong>
        </p>
        <label>
          Tatsächliche Länge [m]
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="z. B. 10,00" />
        </label>
        <div className="dialog-buttons">
          <button type="button" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="primary" disabled={!v || v <= 0}>
            Übernehmen
          </button>
        </div>
      </form>
    </div>
  );
}
