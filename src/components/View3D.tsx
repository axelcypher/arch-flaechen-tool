import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeProject, modellRoofParams } from '../core/calc';
import { fmt2 } from '../core/format';
import type { Point } from '../core/geometry';
import type { OutlineShape, Project } from '../core/model';
import { storeyElevations } from '../core/model';
import { nutzungInfo } from '../core/norms';
import type { Point3 } from '../core/roof';
import { solidFaces } from '../core/roof';
import { meshRoofHeightAt } from '../core/roofMesh';
import { useEditor } from '../store/store';

/**
 * 3D-Ansicht der Rauminhalte: jeder BGF-Umriss als Körper vom Fußboden bis zur Dachhaut
 * bzw. Geschosshöhe – genau die Geometrie, aus der der BRI berechnet wird.
 * Koordinaten: Grundriss (x, y) + Höhe z → three.js (x, z, y), y-Achse nach oben.
 */
export default function View3D() {
  const project = useEditor((s) => s.project);
  const activeStoreyId = useEditor((s) => s.activeStoreyId);
  const selectedId = useEditor((s) => s.selectedShapeId);
  const ifcModel = useEditor((s) => s.ifcModel);
  const hostRef = useRef<HTMLDivElement>(null);
  const [explode, setExplode] = useState(false);
  const [showRooms, setShowRooms] = useState(true);
  const [showIfc, setShowIfc] = useState(true);
  const [onlyActive, setOnlyActive] = useState(false);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Group;
    pickables: THREE.Object3D[];
    fitted: boolean;
  } | null>(null);

  const result = useMemo(() => computeProject(project), [project]);

  // Grundgerüst einmalig anlegen
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0xf4f5f7);
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    camera.position.set(30, 25, 30);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(40, 80, 25);
    scene.add(sun);
    const content = new THREE.Group();
    scene.add(content);
    three.current = { renderer, scene, camera, controls, content, pickables: [], fitted: false };

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    // Klick (ohne Ziehen) wählt einen Körper aus
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, camera);
      const hit = rc.intersectObjects(three.current!.pickables, false)[0];
      const st = useEditor.getState();
      if (hit?.object.userData.shapeId) {
        st.setActiveStorey(hit.object.userData.storeyId);
        st.select(hit.object.userData.shapeId);
      } else st.select(null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeGroup(content);
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // Inhalt bei jeder Änderung neu aufbauen
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    disposeGroup(t.content);
    t.pickables = [];
    const elev = storeyElevations(project);
    const maxH = Math.max(...project.storeys.map((s) => s.hoehe), 3);
    const gap = explode ? maxH * 0.9 : 0;

    project.storeys.forEach((storey, i) => {
      if (onlyActive && storey.id !== activeStoreyId) return;
      const z0 = elev[i] + gap * i;
      const active = storey.id === activeStoreyId;
      for (const s of storey.shapes) {
        if (s.points.length < 3) continue;
        if (s.kind === 'outline') {
          const faces = outlineFaces(s, project, elev[i], storey.hoehe);
          const color = s.subtract ? 0xc0392b : s.umschliessung === 'S' ? 0x2fa39a : 0x2a5bd7;
          const sel = s.id === selectedId;
          const geo = facesToGeometry(faces, z0);
          const mat = new THREE.MeshStandardMaterial({
            color: sel ? 0xff7a00 : color,
            transparent: true,
            opacity: sel ? 0.55 : active ? 0.38 : 0.22,
            side: THREE.DoubleSide,
            depthWrite: false,
            roughness: 0.8,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.userData = { shapeId: s.id, storeyId: storey.id };
          mesh.renderOrder = 2;
          t.content.add(mesh);
          t.pickables.push(mesh);
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo, 25),
            new THREE.LineBasicMaterial({ color: sel ? 0xb35900 : s.subtract ? 0x8e2b20 : 0x1d3f96 }),
          );
          t.content.add(edges);
        } else if (showRooms) {
          const shape = new THREE.Shape(s.points.map((p) => new THREE.Vector2(p.x, p.y)));
          const geo = new THREE.ShapeGeometry(shape);
          geo.rotateX(Math.PI / 2); // (x, y, 0) → (x, 0, y)
          geo.translate(0, z0 + 0.02, 0);
          const mat = new THREE.MeshStandardMaterial({
            color: s.subtract ? 0xc0392b : nutzungInfo(s.nutzung).color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
          });
          t.content.add(new THREE.Mesh(geo, mat));
        }
      }
    });

    if (ifcModel && showIfc && !explode && !onlyActive) {
      for (const m of ifcModel.meshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(m.color[0], m.color[1], m.color[2]),
          transparent: true,
          opacity: Math.min(m.color[3], 0.35),
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 1;
        t.content.add(mesh);
      }
    }

    // Bodenraster
    const box = new THREE.Box3().setFromObject(t.content);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const gsize = Math.ceil(Math.max(size.x, size.z) * 1.6 + 4);
      const grid = new THREE.GridHelper(gsize, gsize, 0xc9ccd2, 0xe1e3e7);
      grid.position.set(Math.round(center.x), Math.min(box.min.y, 0) - 0.01, Math.round(center.z));
      t.content.add(grid);
      if (!t.fitted) {
        fitCamera(t.camera, t.controls, box);
        t.fitted = true;
      }
    }
  }, [project, explode, showRooms, showIfc, onlyActive, activeStoreyId, selectedId, ifcModel]);

  const fit = () => {
    const t = three.current;
    if (!t) return;
    const box = new THREE.Box3();
    for (const o of t.pickables) box.expandByObject(o);
    if (!box.isEmpty()) fitCamera(t.camera, t.controls, box);
  };

  return (
    <div className="view3d">
      <div ref={hostRef} className="view3d-canvas" />
      <div className="canvas-controls view3d-controls">
        <label className="toggle">
          <input type="checkbox" checked={explode} onChange={(e) => setExplode(e.target.checked)} />
          Geschosse auseinanderziehen
        </label>
        <label className="toggle">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          nur aktives Geschoss
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showRooms} onChange={(e) => setShowRooms(e.target.checked)} />
          Räume
        </label>
        {ifcModel && (
          <label className="toggle" title="Importiertes IFC-Modell zum Vergleich einblenden">
            <input type="checkbox" checked={showIfc} onChange={(e) => setShowIfc(e.target.checked)} />
            IFC-Modell
          </label>
        )}
        <button className="small" onClick={fit}>
          ⤢ Alles
        </button>
      </div>
      <div className="view3d-legend">
        <strong>Brutto-Rauminhalt</strong>
        <table>
          <tbody>
            {result.storeys.map((s) => (
              <tr key={s.storeyId} className={s.storeyId === activeStoreyId ? 'active' : ''}>
                <td>{s.name}</td>
                <td className="num">{fmt2(s.bri.total)} m³</td>
              </tr>
            ))}
            <tr className="sum">
              <td>Summe</td>
              <td className="num">{fmt2(result.total.bri.total)} m³</td>
            </tr>
          </tbody>
        </table>
        <div className="legend-items">
          <span>
            <i style={{ background: '#2a5bd7' }} />R
          </span>
          <span>
            <i style={{ background: '#2fa39a' }} />S
          </span>
          <span>
            <i style={{ background: '#c0392b' }} />
            Abzug
          </span>
        </div>
        <p className="muted small-text">Klick auf einen Körper wählt den Umriss aus. Linke Maus: drehen · rechte Maus: verschieben · Rad: zoomen</p>
      </div>
    </div>
  );
}

/** Körperflächen eines Umrisses; bei Dach aus Modell als Höhenfeld */
function outlineFaces(s: OutlineShape, project: Project, floorZ: number, storeyH: number) {
  const h = s.hoehe ?? storeyH;
  if (s.dach?.typ === 'modell' && project.dachModell) {
    const storey = project.storeys.find((st) => st.shapes.includes(s));
    const cap = storey ? modellRoofParams(project, storey, s).cap : Infinity;
    const capAt = typeof cap === 'function' ? cap : () => cap;
    return heightFieldFaces(s.points, (p) => {
      const v = meshRoofHeightAt(project.dachModell!, s.points, floorZ, p);
      return Math.min(Number.isNaN(v) ? h : Math.max(v, 0), capAt(p));
    });
  }
  return solidFaces(s.points, s.dach, h);
}

/** Näherung für Modell-Dächer: Grundriss in Streifen zerlegen, Oberseite als Raster */
function heightFieldFaces(pts: Point[], height: (p: Point) => number) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  const n = 60;
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / n;
  const tops: Point3[][] = [];
  const inside = (p: Point) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  // Höhen an den Rasterecken → durchgehende Fläche (Kanten nur an echten Knicken wie dem First)
  const H: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) H.push(height({ x: x0 + i * dx, y: y0 + j * dy }));
  const corner = (i: number, j: number): Point3 => ({ x: x0 + i * dx, y: y0 + j * dy, z: H[j * (n + 1) + i] });
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!inside({ x: x0 + (i + 0.5) * dx, y: y0 + (j + 0.5) * dy })) continue;
      tops.push([corner(i, j), corner(i + 1, j), corner(i + 1, j + 1)]);
      tops.push([corner(i, j), corner(i + 1, j + 1), corner(i, j + 1)]);
    }
  }
  const sides: Point3[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const steps = 24;
    const top: Point3[] = [];
    for (let k = 0; k <= steps; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
      // Punkt minimal nach innen versetzen, um die Dachhöhe am Rand zu treffen
      top.push({ ...p, z: height(p) });
    }
    sides.push([{ x: a.x, y: a.y, z: 0 }, ...top, { x: b.x, y: b.y, z: 0 }]);
  }
  return { tops, sides, bottom: pts.map((p) => ({ x: p.x, y: p.y, z: 0 })) };
}

function facesToGeometry(f: { tops: Point3[][]; sides: Point3[][]; bottom: Point3[] }, z0: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const push = (p: Point3) => pos.push(p.x, p.z + z0, p.y);
  const addPoly = (poly: Point3[], proj: (p: Point3) => THREE.Vector2) => {
    if (poly.length < 3) return;
    const tris = THREE.ShapeUtils.triangulateShape(poly.map(proj), []);
    for (const [a, b, c] of tris) {
      push(poly[a]);
      push(poly[b]);
      push(poly[c]);
    }
  };
  const xy = (p: Point3) => new THREE.Vector2(p.x, p.y);
  for (const t of f.tops) addPoly(t, xy);
  addPoly(f.bottom, xy);
  for (const s of f.sides) {
    // senkrechte Fläche: in (Länge entlang der Wand, Höhe) triangulieren
    const a = s[0];
    const b = s[s.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    addPoly(s, (p) => new THREE.Vector2((p.x - a.x) * ux + (p.y - a.y) * uy, p.z));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function fitCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls, box: THREE.Box3) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.length() / 2, 2);
  const dist = r / Math.sin((camera.fov * Math.PI) / 360);
  const dir = new THREE.Vector3(1, 0.75, 1.2).normalize();
  camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  camera.near = dist / 100;
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function disposeGroup(g: THREE.Group) {
  for (const o of [...g.children]) {
    g.remove(o);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

