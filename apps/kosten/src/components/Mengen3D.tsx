import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Project } from '@core/model';
import { storeyElevations } from '@core/model';
import { useTheme } from '@core/platform/theme';
import type { Flaeche3, MengeNachweis, Nachweis, Teil } from '../nachweis';

/**
 * 3D-Modell zum Mengennachweis: die Körper der BGF-Umrisse blass als Bezug, darauf farbig genau die
 * Flächen, die zur gewählten Menge zählen (Außenwände, Dachflächen, Körper des Rauminhalts …).
 * Koordinaten: Grundriss (x, y) + Höhe z → three.js (x, z, y), y-Achse nach oben.
 */

const FARBE = 0x2a5bd7;
const FARBE_AKTIV = 0xff7a00;
const FARBE_ABZUG = 0xc0392b;
const FARBE_AUS = 0x9aa0a6;

interface Szene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  teile: THREE.Mesh[];
  fitted: boolean;
}

export default function Mengen3D({
  project,
  nachweis,
  menge,
  aktiv,
  onAktiv,
  onUmschalten,
}: {
  project: Project;
  nachweis: Nachweis;
  menge: MengeNachweis;
  aktiv: string | null;
  onAktiv: (id: string | null) => void;
  /** Klick auf ein Teil (ohne Drehen): an- bzw. abwählen */
  onUmschalten?: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const three = useRef<Szene | null>(null);
  const aktivRef = useRef(onAktiv);
  aktivRef.current = onAktiv;
  const umschaltenRef = useRef(onUmschalten);
  umschaltenRef.current = onUmschalten;
  const aktivId = useRef(aktiv);
  const [explode, setExplode] = useState(false);
  const [fehler, setFehler] = useState(false);
  const dunkel = useTheme((s) => s.theme) === 'dunkel';

  // Grundgerüst einmalig anlegen
  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setFehler(true);
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    camera.position.set(30, 25, 30);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(40, 80, 25);
    scene.add(sun);
    const content = new THREE.Group();
    scene.add(content);
    const t: Szene = { renderer, scene, camera, controls, content, teile: [], fitted: false };
    three.current = t;

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

    // Teil unter dem Mauszeiger hervorheben (nicht während des Drehens)
    let gedrueckt: { x: number; y: number } | null = null;
    let letztes: string | null = null;
    const treffer = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, camera);
      return (rc.intersectObjects(t.teile, false)[0]?.object.userData.teil as string | undefined) ?? null;
    };
    const onDown = (e: PointerEvent) => (gedrueckt = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      // Klick ohne Drehen/Verschieben: Teil an- bzw. abwählen
      if (gedrueckt && e.button === 0 && e.target === renderer.domElement && Math.hypot(e.clientX - gedrueckt.x, e.clientY - gedrueckt.y) < 4) {
        const id = treffer(e);
        if (id) umschaltenRef.current?.(id);
      }
      gedrueckt = null;
    };
    const onMove = (e: PointerEvent) => {
      if (gedrueckt) return;
      const id = treffer(e);
      if (id !== letztes) aktivRef.current((letztes = id));
    };
    const onLeave = () => {
      if (letztes !== null) aktivRef.current((letztes = null));
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointerup', onUp);
      controls.dispose();
      disposeGroup(content);
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // Inhalt bei Änderungen neu aufbauen
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    disposeGroup(t.content);
    t.teile = [];
    const elev = storeyElevations(project);
    const maxH = Math.max(...project.storeys.map((s) => s.hoehe), 3);
    // Geschosse nach Höhe auseinanderziehen (Rang, nicht Listenreihenfolge)
    const rang = elev.map((e) => elev.filter((x) => x < e - 1e-9).length);
    const dz = (geschoss: number) => (explode ? rang[geschoss] * maxH * 0.9 : 0);

    // Bezug: alle Körper, blass
    const bezug = flaechenGeometrie(nachweis.koerper, dz, 0);
    t.content.add(
      new THREE.Mesh(
        bezug,
        new THREE.MeshStandardMaterial({ color: dunkel ? 0x9aa1ad : 0x8a93a3, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, roughness: 0.9 }),
      ),
    );
    t.content.add(new THREE.LineSegments(new THREE.EdgesGeometry(bezug, 25), new THREE.LineBasicMaterial({ color: dunkel ? 0x6f7785 : 0x9aa0a6 })));

    // Teile der Menge: farbig, knapp vor den Körperflächen
    for (const teil of menge.teile) {
      const flaechen = flaechenVon(teil, project, elev);
      if (!flaechen.length) continue;
      const geo = flaechenGeometrie(flaechen, dz, teil.raum ? 0 : 0.03);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ transparent: true, side: THREE.DoubleSide, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      );
      const kanten = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial());
      mesh.userData = { teil: teil.id, abzug: teil.wert < 0, aus: teil.zaehlt === false, kanten };
      mesh.renderOrder = 2;
      t.content.add(mesh, kanten);
      t.teile.push(mesh);
    }
    faerben(t.teile, aktivId.current);

    const box = new THREE.Box3().setFromObject(t.content);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const gsize = Math.ceil(Math.max(size.x, size.z) * 1.6 + 4);
      const grid = dunkel ? new THREE.GridHelper(gsize, gsize, 0x4a505a, 0x30343c) : new THREE.GridHelper(gsize, gsize, 0xc9ccd2, 0xe1e3e7);
      // Raster auf ±0,00 (Gelände), nicht unter dem Keller
      grid.position.set(Math.round(center.x), -0.01, Math.round(center.z));
      t.content.add(grid);
      if (!t.fitted) {
        fitCamera(t.camera, t.controls, box);
        t.fitted = true;
      }
    }
  }, [project, nachweis, menge, explode, dunkel]);

  // Hervorhebung ohne Neuaufbau der Szene
  useEffect(() => {
    aktivId.current = aktiv;
    if (three.current) faerben(three.current.teile, aktiv);
  }, [aktiv]);

  useEffect(() => {
    three.current?.renderer.setClearColor(dunkel ? 0x1a1d22 : 0xf4f5f7);
  }, [dunkel]);

  const fit = () => {
    const t = three.current;
    if (!t) return;
    const box = new THREE.Box3().setFromObject(t.content);
    if (!box.isEmpty()) fitCamera(t.camera, t.controls, box);
  };

  if (fehler) return <p className="warning">Die 3D-Ansicht steht auf diesem Gerät nicht zur Verfügung (WebGL fehlt). Die Grundrisse und der Rechenweg zeigen dieselben Teile.</p>;

  return (
    <div className="m3d">
      <div ref={hostRef} className="m3d-canvas" />
      <div className="m3d-controls">
        <label className="toggle">
          <input type="checkbox" checked={explode} onChange={(e) => setExplode(e.target.checked)} />
          Geschosse auseinanderziehen
        </label>
        <button className="small" onClick={fit}>
          ⤢ Alles
        </button>
      </div>
      <p className="m3d-hilfe muted small-text">Linke Maus: drehen · rechte Maus: verschieben · Rad: zoomen · ±0,00 liegt auf dem Raster</p>
    </div>
  );
}

function faerben(teile: THREE.Mesh[], aktiv: string | null) {
  for (const mesh of teile) {
    const { teil, abzug, aus, kanten } = mesh.userData as { teil: string; abzug: boolean; aus: boolean; kanten: THREE.LineSegments };
    const istAktiv = teil === aktiv;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color.setHex(istAktiv ? FARBE_AKTIV : aus ? FARBE_AUS : abzug ? FARBE_ABZUG : FARBE);
    mat.opacity = istAktiv ? 0.95 : aus ? 0.35 : 0.78;
    (kanten.material as THREE.LineBasicMaterial).color.setHex(istAktiv ? 0xb35900 : aus ? 0x8a8f99 : abzug ? 0x8e2b20 : 0x1d3f96);
  }
}

/** Flächen eines Teils im Raum; Teile ohne eigene 3D-Flächen (Grundflächen) liegen als Platte auf ihrem Fußboden */
function flaechenVon(teil: Teil, project: Project, elev: number[]): Flaeche3[] {
  if (teil.raum) return teil.raum;
  return (teil.plan ?? []).flatMap((f) => {
    const i = project.storeys.findIndex((s) => s.id === f.storeyId);
    if (i < 0) return [];
    const z = elev[i];
    return [{ aussen: f.points.map((p) => ({ ...p, z })), loecher: f.loecher?.map((l) => l.map((p) => ({ ...p, z }))), geschoss: i }];
  });
}

function flaechenGeometrie(flaechen: Flaeche3[], dz: (geschoss: number) => number, anheben: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const f of flaechen) {
    if (f.aussen.length < 3) continue;
    // in der Ebene der Fläche triangulieren: die Achse mit dem größten Normalenanteil fällt weg
    const n = normale(f.aussen);
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    if (ax + ay + az < 1e-12) continue;
    const proj = az >= ax && az >= ay ? (p: { x: number; y: number; z: number }) => new THREE.Vector2(p.x, p.y) : ax >= ay ? (p: { x: number; y: number; z: number }) => new THREE.Vector2(p.y, p.z) : (p: { x: number; y: number; z: number }) => new THREE.Vector2(p.x, p.z);
    const loecher = f.loecher ?? [];
    const alle = [...f.aussen, ...loecher.flat()];
    const tris = THREE.ShapeUtils.triangulateShape(f.aussen.map(proj), loecher.map((l) => l.map(proj)));
    const z0 = dz(f.geschoss) + anheben;
    for (const tri of tris) for (const k of tri) pos.push(alle[k].x, alle[k].z + z0, alle[k].y);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function normale(poly: { x: number; y: number; z: number }[]) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return { x, y, z };
}

function fitCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls, box: THREE.Box3) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.length() / 2, 2);
  const dist = (r / Math.sin((camera.fov * Math.PI) / 360)) * 1.1;
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
