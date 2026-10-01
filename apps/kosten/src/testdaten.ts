import { rectPoints } from '@core/geometry';
import type { KostenPosition, Project, RoomShape, Storey } from '@core/model';
import { createOutline, createProject, createRoom, createStorey } from '@core/model';

/**
 * Testprojekt: UG, EG, OG und DG mit Walmdach auf 12,00 × 11,25 m (135 m² je Geschoss), Grundstück 612,5 m².
 *   BGF 540 m² · Gründungsfläche 135 m² · Deckenfläche 405 m² · Baugrube 135 × 2,80 = 378 m³ · Außenanlagen 477,5 m²
 */
export function projekt(): Project {
  const p = createProject('Kosten-Test');
  const rect = rectPoints({ x: 0, y: 0 }, { x: 12, y: 11.25 });
  const st = (name: string, e: number, h: number): Storey => ({ ...createStorey(name, h), elevation: e, shapes: [createOutline(rect)] });
  const dg = st('DG', 6.65, 3);
  const o = dg.shapes[0];
  if (o.kind === 'outline') o.dach = { typ: 'walm', traufhoehe: 0, neigung: 45, neigungWalm: 45, firstrichtung: 0 };
  p.storeys = [st('UG', -2.8, 2.8), st('EG', 0, 3.45), st('OG', 3.45, 3.2), dg];
  p.meta.grundstueck.flaeche = 612.5;
  return p;
}

/** Positionen der Handrechnung (siehe kosten.test.ts) */
export function positionen(): KostenPosition[] {
  return [
    { id: 'p300', kg: '300', bezeichnung: 'Bauwerk – Baukonstruktionen', bezug: 'bgf', von: 1500, mittel: 1800, bis: 2100 },
    { id: 'p400', kg: '400', bezeichnung: 'Bauwerk – Technische Anlagen', bezug: 'bgf', mittel: 600 },
    { id: 'p530', kg: '530', bezeichnung: 'Befestigte Flächen', bezug: 'auf', mittel: 120 },
    { id: 'p540', kg: '540', bezeichnung: 'Carport', bezug: 'pauschal', mittel: 30000 },
    { id: 'p700', kg: '700', bezeichnung: 'Baunebenkosten', bezug: 'prozent', basis: ['300', '400'], von: 18, mittel: 20, bis: 22 },
  ];
}

export function projektMitKosten(): Project {
  const p = projekt();
  p.kosten = { stufe: 'schaetzung', datum: '2026-07-01', positionen: positionen() };
  return p;
}

/**
 * Testprojekt für den Mengennachweis: EG 12,00 × 11,25 m mit Anbau 4,00 × 5,00 m (Höhe 3,00 m) an der
 * Ostwand, darüber ein Staffelgeschoss 8,00 × 11,25 m; drei Räume im EG, Grundstück 500 m².
 */
export function projektMitAnbau(): Project {
  const p = createProject('Anbau-Test');
  const eg = { ...createStorey('EG', 3.45), elevation: 0 } as Storey;
  const anbau = { ...createOutline(rectPoints({ x: 12, y: 0 }, { x: 16, y: 5 }), 'Anbau'), hoehe: 3 };
  const raum = (a: [number, number], b: [number, number], nr: string, name: string): RoomShape => createRoom(rectPoints({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }), nr, name);
  const wohnen: RoomShape = { ...raum([0.4, 0.4], [6, 5], '0.1', 'Wohnen'), wofl: { kategorie: 'voll', wohnung: 'WE 1' } };
  const flur: RoomShape = { ...raum([6.2, 0.4], [8, 5], '0.2', 'Flur'), nutzung: 'VF', wofl: { kategorie: 'voll', wohnung: 'WE 1' } };
  const technik: RoomShape = { ...raum([8.2, 0.4], [11.6, 5], '0.3', 'Technik'), nutzung: 'TF' };
  eg.shapes = [createOutline(rectPoints({ x: 0, y: 0 }, { x: 12, y: 11.25 }), 'Haus'), anbau, wohnen, flur, technik];
  const og = { ...createStorey('OG', 3.2), elevation: 3.45 } as Storey;
  og.shapes = [createOutline(rectPoints({ x: 0, y: 0 }, { x: 8, y: 11.25 }), 'Staffelgeschoss')];
  p.storeys = [eg, og];
  p.meta.grundstueck.flaeche = 500;
  return p;
}
