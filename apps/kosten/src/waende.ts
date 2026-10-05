import type { Point } from '@core/geometry';
import type { IfcExtract } from '@core/ifcData';
import { LAGEPLAN_NAME } from '@core/ifcImport';
import type { Point3 } from '@core/roof';

/**
 * Wände aus dem IFC-Modell für die Innenwandfläche. Jede Wand wird einzeln vermessen: Länge entlang ihrer
 * Achse, Dicke quer dazu, Ansichtsfläche vom Wandfuß bis zur Oberkante – Öffnungen (Türen, Fenster, auch
 * raumhohe Durchgänge) übermessen, schräge Oberkanten (Giebel, Dachschrägen) in wahrer Größe.
 */

export interface IfcWand {
  /** GlobalId, sonst Express-ID */
  id: string;
  name: string;
  typ: string;
  /** Geschoss laut IFC (Name und Kote) – die Zuordnung zum Projektgeschoss erfolgt im Mengennachweis */
  geschoss: string;
  geschossKote: number;
  /** Außenwand laut IFC (IsExternal); ohne Angabe nach der Lage am BGF-Umriss */
  isExternal?: boolean;
  laenge: number;
  dicke: number;
  /** Unterkante und Oberkante über ±0,00 */
  z0: number;
  z1: number;
  /** Ansichtsfläche einer Seite, Öffnungen übermessen */
  flaeche: number;
  /** Grundriss: Rechteck um die Wand */
  grundriss: Point[];
  /** Achse (Mitte der Dicke) */
  achse: [Point, Point];
  /** Umriss der Ansichtsfläche in der Achsebene */
  ansicht: Point3[][];
}

/** Abtastweite entlang der Wandachse [m] */
const RASTER = 0.05;

const WAND_TYPEN = new Set(['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE']);

export function waendeAusIfc(x: IfcExtract): IfcWand[] {
  const out: IfcWand[] = [];
  for (const e of x.elements) {
    if (!WAND_TYPEN.has(e.type)) continue;
    const st = x.storeys[e.storey];
    if (st && LAGEPLAN_NAME.test(st.name)) continue; // Gartenmauern u. ä.
    const w = vermessen(e.tris);
    if (!w) continue;
    out.push({
      id: e.globalId || String(e.expressId),
      name: e.name,
      typ: e.type,
      geschoss: st?.name ?? '',
      geschossKote: st?.elevation ?? NaN,
      ...(e.isExternal !== undefined ? { isExternal: e.isExternal } : {}),
      ...w,
    });
  }
  return out;
}

type Masse = Pick<IfcWand, 'laenge' | 'dicke' | 'z0' | 'z1' | 'flaeche' | 'grundriss' | 'achse' | 'ansicht'>;

/** Achse entlang der langen Seite des kleinsten umschließenden Rechtecks, dann Ausdehnung längs, quer und in der Höhe */
export function vermessen(tris: ArrayLike<number>): Masse | null {
  const n = Math.floor(tris.length / 3);
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += tris[i * 3];
    my += tris[i * 3 + 1];
  }
  mx /= n;
  my /= n;
  const d = hauptrichtung(huelle(Array.from({ length: n }, (_, i) => ({ x: tris[i * 3] - mx, y: tris[i * 3 + 1] - my }))));
  const q = { x: -d.y, y: d.x };
  let t0 = Infinity;
  let t1 = -Infinity;
  let s0 = Infinity;
  let s1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  const ts = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = tris[i * 3] - mx;
    const dy = tris[i * 3 + 1] - my;
    const z = tris[i * 3 + 2];
    const t = (ts[i] = dx * d.x + dy * d.y);
    const s = dx * q.x + dy * q.y;
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const laenge = t1 - t0;
  const hoehe = z1 - z0;
  if (laenge < 0.01 || hoehe < 0.01) return null;
  const sm = (s0 + s1) / 2;
  const punkt = (t: number, s: number): Point => ({ x: mx + d.x * t + q.x * s, y: my + d.y * t + q.y * s });

  // Ansicht: Oberkante der Wand entlang der Achse (alle 5 cm) über dem Wandfuß – Öffnungen übermessen: Türen
  // unter einem Sturz zählen bis zum Fuß, raumhohe Öffnungen werden zwischen ihren Nachbarn überbrückt
  const N = Math.max(2, Math.ceil(laenge / RASTER) + 1);
  const step = laenge / (N - 1);
  const oben = new Float64Array(N).fill(-Infinity);
  for (let i = 0; i + 2 < n; i += 3) {
    const p = [i, i + 1, i + 2].map((k) => ({ t: ts[k], z: tris[k * 3 + 2] }));
    const lo = Math.min(p[0].t, p[1].t, p[2].t);
    const hi = Math.max(p[0].t, p[1].t, p[2].t);
    for (let j = Math.max(0, Math.ceil((lo - t0) / step - 1e-6)); j <= Math.min(N - 1, Math.floor((hi - t0) / step + 1e-6)); j++) {
      const t = Math.min(Math.max(t0 + j * step, lo), hi);
      for (let k = 0; k < 3; k++) {
        const a = p[k];
        const b = p[(k + 1) % 3];
        let z = -Infinity;
        if (Math.abs(b.t - a.t) < 1e-9) {
          if (Math.abs(a.t - t) < 1e-6) z = Math.max(a.z, b.z);
        } else if ((a.t - t) * (b.t - t) <= 0) z = a.z + ((b.z - a.z) * (t - a.t)) / (b.t - a.t);
        if (z > oben[j]) oben[j] = z;
      }
    }
  }
  let letzte = -1;
  for (let j = 0; j < N; j++) {
    if (!Number.isFinite(oben[j])) continue;
    if (letzte < 0) oben.fill(oben[j], 0, j);
    else for (let k = letzte + 1; k < j; k++) oben[k] = oben[letzte] + ((oben[j] - oben[letzte]) * (k - letzte)) / (j - letzte);
    letzte = j;
  }
  if (letzte < 0) return null;
  oben.fill(oben[letzte], letzte + 1);
  let flaeche = 0;
  for (let j = 0; j + 1 < N; j++) flaeche += ((oben[j] + oben[j + 1]) / 2 - z0) * step;
  if (!(flaeche > 0.01)) return null;

  const ring: [number, number][] = [];
  for (let j = 0; j < N; j++) ring.push([t0 + j * step, oben[j]]);
  ring.push([t1, z0], [t0, z0]);
  return {
    laenge,
    dicke: s1 - s0,
    z0,
    z1,
    flaeche,
    grundriss: [punkt(t0, s0), punkt(t1, s0), punkt(t1, s1), punkt(t0, s1)],
    achse: [punkt(t0, sm), punkt(t1, sm)],
    ansicht: [vereinfachen(ring).map(([t, z]) => ({ ...punkt(t, sm), z }))],
  };
}

/** Punkte auf einer Geraden zwischen ihren Nachbarn entfernen */
function vereinfachen(r: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < r.length; i++) {
    const a = out.length ? out[out.length - 1] : r[r.length - 1];
    const b = r[i];
    const c = r[(i + 1) % r.length];
    const kreuz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(kreuz) > 1e-6) out.push(b);
  }
  return out.length >= 3 ? out : r;
}

/** konvexe Hülle (monotone Kette) */
function huelle(punkte: Point[]): Point[] {
  const p = [...punkte].sort((a, b) => a.x - b.x || a.y - b.y);
  const kreuz = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const unten: Point[] = [];
  for (const q of p) {
    while (unten.length >= 2 && kreuz(unten[unten.length - 2], unten[unten.length - 1], q) <= 1e-12) unten.pop();
    unten.push(q);
  }
  const oben: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    while (oben.length >= 2 && kreuz(oben[oben.length - 2], oben[oben.length - 1], p[i]) <= 1e-12) oben.pop();
    oben.push(p[i]);
  }
  return [...unten.slice(0, -1), ...oben.slice(0, -1)];
}

/** Richtung der langen Seite des flächenkleinsten Rechtecks um die Hülle (je Hüllkante geprüft) */
function hauptrichtung(h: Point[]): Point {
  let best = { flaeche: Infinity, d: { x: 1, y: 0 } };
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let t0 = Infinity;
    let t1 = -Infinity;
    let s0 = Infinity;
    let s1 = -Infinity;
    for (const p of h) {
      const t = p.x * d.x + p.y * d.y;
      const s = -p.x * d.y + p.y * d.x;
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
    }
    const f = (t1 - t0) * (s1 - s0);
    if (f < best.flaeche - 1e-9) best = { flaeche: f, d: t1 - t0 >= s1 - s0 ? d : { x: -d.y, y: d.x } };
  }
  return best.d;
}
