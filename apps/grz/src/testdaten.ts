import { rectPoints } from '@core/geometry';
import type { Project, Storey } from '@core/model';
import { createLageplanFlaeche, createOutline, createProject, createRoom, createStorey } from '@core/model';

/** Testprojekt: EG, OG, DG mit Walmdach, Zufahrt und Terrasse, B-Plan von 1967 */
export function projekt(): Project {
  const p = createProject('GRZ-Test');
  const rect = rectPoints({ x: 0, y: 0 }, { x: 12, y: 11.25 });
  const st = (name: string, e: number, h: number): Storey => ({ ...createStorey(name, h), elevation: e, shapes: [createOutline(rect)] });
  const eg = st('EG', 0, 3.45);
  const og = st('OG', 3.45, 3.2);
  const dg = st('DG', 6.65, 3);
  const o = dg.shapes[0];
  if (o.kind === 'outline') o.dach = { typ: 'walm', traufhoehe: 0, neigung: 45, neigungWalm: 45, firstrichtung: 0 };
  dg.shapes.push(createRoom(rectPoints({ x: 3, y: 3 }, { x: 9, y: 8.25 }), '1', 'Zimmer I'));
  p.storeys = [eg, og, dg];
  p.lageplan = {
    flaechen: [
      { ...createLageplanFlaeche(rectPoints({ x: 12, y: 0 }, { x: 15, y: 10 }), 'Zufahrt'), nutzung: 'zufahrt', versiegelung: 'teil', hoehe: -0.2 },
      { ...createLageplanFlaeche(rectPoints({ x: -3, y: 0 }, { x: 0, y: 5 }), 'Terrasse'), nutzung: 'terrasse', versiegelung: 'voll' },
    ],
  };
  p.meta.grundstueck.flaeche = 612.5;
  p.massNutzung = { planDatum: '1967-03-14', grz: 0.4, gfz: 0.5, vollgeschosseMax: 2, gelaende: -0.2 };
  return p;
}
