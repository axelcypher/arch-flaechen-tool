import { rectPoints } from '@core/geometry';
import type { KostenPosition, Project, Storey } from '@core/model';
import { createOutline, createProject, createStorey } from '@core/model';

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
