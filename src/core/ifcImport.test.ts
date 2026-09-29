import { describe, expect, it } from 'vitest';
import { computeProject } from './calc';
import type { IfcExtract, IfcMeshPart } from './ifcData';
import { polygonArea } from './geometry';
import { buildFromIfc, chainSegments, rechtwinklig, sectionPlan } from './ifcImport';
import type { OutlineShape } from './model';
import { createProject } from './model';
import { briKoerper } from './rechenweg';
import type { Dach } from './roof';
import { clippedPieces } from './roof';

/** Quader als Dreiecke (Grundrisskoordinaten, z = Höhe) */
function box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): number[] {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const f = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ];
  return f.flatMap((t) => t.flatMap((i) => v[i]));
}

/** Wandring 10 × 8 m, Wanddicke 0,3 m */
function ring(z0: number, z1: number): number[] {
  return [...box(0, 0, 10, 0.3, z0, z1), ...box(0, 7.7, 10, 8, z0, z1), ...box(0, 0.3, 0.3, 7.7, z0, z1), ...box(9.7, 0.3, 10, 7.7, z0, z1)];
}

const part = (type: string, storey: number, tris: number[], predefinedType = ''): IfcMeshPart => ({
  expressId: Math.floor(Math.random() * 1e9),
  type,
  name: type,
  predefinedType,
  storey,
  tris: Float32Array.from(tris),
  color: [0.5, 0.5, 0.5, 1],
});

/** Satteldach: Traufe z = 4 bei y = 0 und 8, First z = 7 bei y = 4 (First entlang x) */
function gableRoof(): number[] {
  const t: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => t.push(...a, ...b, ...c, ...a, ...c, ...d);
  quad([0, 0, 4], [10, 0, 4], [10, 4, 7], [0, 4, 7]);
  quad([0, 4, 7], [10, 4, 7], [10, 8, 4], [0, 8, 4]);
  return t;
}

function extract(withSpitzboden: boolean): IfcExtract {
  const storeys = [
    { name: 'EG', elevation: 0, expressId: 1 },
    { name: 'DG', elevation: 3, expressId: 2 },
  ];
  if (withSpitzboden) storeys.push({ name: 'Spitzboden', elevation: 5.5, expressId: 3 });
  return {
    schema: 'IFC4',
    projectName: 'Test',
    storeys,
    spaces: [],
    elements: [part('IFCWALL', 0, ring(0, 3)), part('IFCWALL', 1, ring(3, 4.2)), part('IFCSLAB', withSpitzboden ? 2 : 1, gableRoof(), 'ROOF')],
    offset: { x: 0, y: 0 },
  };
}

function bri(x: IfcExtract) {
  const r = buildFromIfc(x, { rooms: false, outlines: true, roof: true, wohnflaeche: false });
  const p = createProject();
  p.storeys = r.storeys;
  p.dachModell = r.dachModell;
  return { res: computeProject(p), report: r.report };
}

describe('IFC: Dach über mehrere Geschosse', () => {
  // DG: 80 m² × 1 m bis zur Traufe + Dachprisma 10 × (8 × 3 / 2) = 200 m³
  it('DG als oberstes Geschoss: BRI bis zur Dachhaut', () => {
    const { res } = bri(extract(false));
    expect(res.storeys[0].bri.total).toBeCloseTo(240, 1);
    expect(Math.abs(res.storeys[1].bri.total - 200) / 200).toBeLessThan(0.005);
  });

  it('Dachspitze als eigenes Geschoss ohne BGF wird dem DG zugerechnet', () => {
    const { res, report } = bri(extract(true));
    expect(res.storeys).toHaveLength(3);
    expect(res.storeys[2].bgf.total).toBe(0);
    expect(res.storeys[0].bri.total).toBeCloseTo(240, 1);
    expect(Math.abs(res.storeys[1].bri.total - 200) / 200).toBeLessThan(0.005);
    expect(report.some((r) => r.includes('Spitzboden'))).toBe(true);
  });

  it('begrenzt dort, wo das Geschoss darüber BGF hat', () => {
    // Spitzboden mit eigenem (kleinerem) Umriss: Wände nur im mittleren Streifen y 3..5; Dach gehört zum DG
    // (hinge es am Spitzboden, reichte dessen BGF bis zur Dachhaut)
    const x = extract(true);
    x.elements.find((e) => e.type === 'IFCSLAB')!.storey = 1;
    x.elements.push(part('IFCWALL', 2, [...box(0, 3, 10, 3.2, 5.5, 6.5), ...box(0, 4.8, 10, 5, 5.5, 6.5), ...box(0, 3.2, 0.2, 4.8, 5.5, 6.5), ...box(9.8, 3.2, 10, 4.8, 5.5, 6.5)]));
    const { res } = bri(x);
    // DG: außerhalb des Streifens bis zum Dach, im Streifen (10 × 2 m) bis 5,5 m
    // Dachhöhe über DG-Fußboden: h(y) = 1 + 0,75·min(y, 8 − y); im Streifen y 3..5 auf 2,5 m begrenzt
    const strip = 10 * (2 * 2.5 - 0); // Streifen y 3..5 mit Höhe 2,5
    const outside = 200 - 10 * (2 * 1 + 0.75 * 2 * (3 + 4) / 2 * 2 / 2); // 200 − Volumen im Streifen
    const expected = outside + strip;
    expect(Math.abs(res.storeys[1].bri.total - expected) / expected).toBeLessThan(0.01);
  });
});

describe('IFC: BGF-Umriss', () => {
  it('Fenster und Türen: keine Zacken vor der Fassade, raumhohe Öffnungen geschlossen', () => {
    const walls = [...box(0, 0, 3, 0.3, 0, 3), ...box(5, 0, 10, 0.3, 0, 3), ...box(0, 7.7, 10, 8, 0, 3), ...box(0, 0.3, 0.3, 7.7, 0, 3), ...box(9.7, 0.3, 10, 7.7, 0, 3)];
    const x: IfcExtract = {
      schema: 'IFC4',
      projectName: 'Test',
      storeys: [{ name: 'EG', elevation: 0, expressId: 1 }],
      spaces: [],
      elements: [
        part('IFCWALL', 0, walls),
        // raumhohe Tür in der Wandlücke x 3..5, Rahmen steht innen und außen 10 cm über
        part('IFCDOOR', 0, box(3, -0.1, 5, 0.4, 0, 3)),
        // Fenster mit Fensterbank 15 cm vor der Fassade
        part('IFCWINDOW', 0, box(7, -0.15, 8, 0.3, 0.9, 2.1)),
        part('IFCWINDOW', 0, box(0.3, 3, 0.45, 4, 0.9, 2.1).map((v, i) => (i % 3 === 0 ? v - 0.45 : v))),
      ],
      offset: { x: 0, y: 0 },
    };
    const r = buildFromIfc(x, { rooms: false, outlines: true, roof: false, wohnflaeche: false });
    const o = r.storeys[0].shapes.find((s) => s.kind === 'outline')!;
    expect(o.points).toHaveLength(4);
    expect(polygonArea(o.points)).toBeCloseTo(80, 1);
  });

  it('richtet fast rechtwinklige Umrisse exakt aus', () => {
    const r = rechtwinklig([
      { x: 0, y: 0 },
      { x: 12, y: 0.001 },
      { x: 12.0005, y: 10.75 },
      { x: 0, y: 10.7508 },
    ]);
    expect(polygonArea(r)).toBeCloseTo(129, 2);
    for (let i = 0; i < 4; i++) {
      const a = r[i];
      const b = r[(i + 1) % 4];
      const c = r[(i + 2) % 4];
      expect(Math.abs((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y))).toBeLessThan(1e-9);
    }
  });
});

describe('IFC: Dachgeschoss unter einem Walmdach', () => {
  /** OG 10 × 8 m; DG mit eingerückten Drempelwänden, Walmdach 45° ab DG-Fußboden mit 0,5 m Überstand */
  function walmHaus(): IfcExtract {
    const walm: Dach = { typ: 'walm', traufhoehe: 3 - 0.5, neigung: 45, neigungWalm: 45, firstrichtung: 0 };
    const big = [
      { x: -0.5, y: -0.5 },
      { x: 10.5, y: -0.5 },
      { x: 10.5, y: 8.5 },
      { x: -0.5, y: 8.5 },
    ];
    const t: number[] = [];
    for (const pc of clippedPieces(walm, big)) {
      const z = (q: { x: number; y: number }) => pc.f[0] * q.x + pc.f[1] * q.y + pc.f[2];
      for (let k = 1; k + 1 < pc.poly.length; k++) for (const q of [pc.poly[0], pc.poly[k], pc.poly[k + 1]]) t.push(q.x, q.y, z(q));
    }
    const inset = [...box(0.8, 0.8, 9.2, 1, 3, 3.8), ...box(0.8, 7, 9.2, 7.2, 3, 3.8), ...box(0.8, 1, 1, 7, 3, 3.8), ...box(9, 1, 9.2, 7, 3, 3.8)];
    return {
      schema: 'IFC4',
      projectName: 'Test',
      storeys: [
        { name: 'OG', elevation: 0, expressId: 1 },
        { name: 'DG', elevation: 3, expressId: 2 },
      ],
      spaces: [],
      elements: [part('IFCWALL', 0, ring(0, 3)), part('IFCWALL', 1, inset), part('IFCROOF', 1, t)],
      offset: { x: 0, y: 0 },
    };
  }

  it('BGF des DG reicht bis zur Dachhaut, Walmdach mit Formel', () => {
    const r = buildFromIfc(walmHaus(), { rooms: false, outlines: true, roof: true, wohnflaeche: false, dachform: true });
    const dg = r.storeys[1].shapes.find((s): s is OutlineShape => s.kind === 'outline')!;
    expect(polygonArea(dg.points)).toBeCloseTo(80, 1);
    expect(r.report.some((z) => z.includes('BGF bis zur Dachhaut erweitert'))).toBe(true);
    expect(dg.dach).toMatchObject({ typ: 'walm', neigung: 45, neigungWalm: 45 });
    const p = createProject();
    p.storeys = r.storeys;
    p.dachModell = r.dachModell;
    const k = briKoerper(p).filter((x) => x.geschoss === 'DG');
    expect(k.map((x) => x.formel)).toContain('B × H × (3 × L − B) / 6');
    // OG: Quader bis zum DG-Fußboden
    expect(computeProject(p).storeys[0].bri.total).toBeCloseTo(240, 1);
  });

  it('ohne Dach über dem Geschoss bleibt es bei den Wänden', () => {
    const x = walmHaus();
    x.elements = x.elements.filter((e) => e.type !== 'IFCROOF');
    const r = buildFromIfc(x, { rooms: false, outlines: true, roof: false, wohnflaeche: false });
    const dg = r.storeys[1].shapes.find((s) => s.kind === 'outline')!;
    expect(polygonArea(dg.points)).toBeCloseTo(8.4 * 6.4, 1);
  });
});

describe('IFC: Geschossschnitt als Plan', () => {
  it('schneidet den Wandring entlang der Wandflächen', () => {
    const bg = sectionPlan([part('IFCWALL', 0, ring(0, 3))], 1, 'Schnitt')!;
    expect(bg.layers.map((l) => l.name)).toEqual(['Wände']);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of bg.polylines) for (let i = 0; i < p.pts.length; i += 2) {
      xs.push(p.pts[i]);
      ys.push(p.pts[i + 1]);
    }
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 10, 0, 8]);
    // jeder Punkt liegt auf einer Außen- oder Innenfläche der Wände
    const onFace = (v: number, faces: number[]) => faces.some((f) => Math.abs(v - f) < 1e-6);
    for (let i = 0; i < xs.length; i++) expect(onFace(xs[i], [0, 0.3, 9.7, 10]) || onFace(ys[i], [0, 0.3, 7.7, 8])).toBe(true);
    // Schnitt über dem Bauteil liefert nichts
    expect(sectionPlan([part('IFCWALL', 0, ring(0, 3))], 3.5, 'x')).toBeNull();
  });

  it('verkettet Segmente und entfernt kollineare Punkte', () => {
    const r = chainSegments([0, 0, 1, 0, 1, 0, 2, 0, 2, 0, 2, 1, 2, 1, 0, 1, 0, 1, 0, 0]);
    expect(r).toHaveLength(1);
    expect(r[0].closed).toBe(true);
    expect(r[0].pts.length / 2).toBe(4);
  });
});
