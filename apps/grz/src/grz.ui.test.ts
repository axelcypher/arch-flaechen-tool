// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { rectPoints } from '@core/geometry';
import type { Project, Storey } from '@core/model';
import { createLageplanFlaeche, createOutline, createProject, createRoom, createStorey } from '@core/model';
import { App } from './App';
import { GrzGfzView } from './components/GrzGfzView';
import { useGrz } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function projekt(): Project {
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

let root: ReturnType<typeof createRoot> | null = null;
function render(el: Parameters<typeof createElement>[0]): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(createElement(el));
  });
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

const change = (el: HTMLSelectElement | HTMLInputElement, value: string) =>
  act(() => {
    if (el instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

describe('GRZ-Nachweis', () => {
  it('zeigt ohne Projekt den Einstieg', () => {
    useGrz.getState().load(createProject());
    expect(render(App).textContent).toContain('Projekt oder IFC öffnen');
  });

  it('rechnet nach dem Recht des Plandatums und zeigt Lageplan und Nachweis', () => {
    useGrz.getState().load(projekt());
    const host = render(App);
    const text = host.textContent ?? '';
    expect(text).not.toContain('Projekt oder IFC öffnen');
    expect(text).toContain('automatisch (BauNVO 1962)');
    expect(text).toContain('Vollgeschosse nach BauO NW 1962/1970');
    expect(text).toContain('Aufenthaltsräume in Nicht-Vollgeschossen');
    expect(host.querySelectorAll('.grz-skizze path').length).toBeGreaterThan(2);
    expect(host.querySelectorAll('.kpi').length).toBe(3); // vor 1990: eine GRZ
  });

  it('Festsetzungen, Einstufung, Vollgeschoss und Aufenthaltsraum über die Oberfläche', () => {
    useGrz.getState().load(projekt());
    const host = render(GrzGfzView);
    change(host.querySelector('input[type="date"]') as HTMLInputElement, '2020-05-01');
    expect(useGrz.getState().project.massNutzung?.planDatum).toBe('2020-05-01');
    expect(host.textContent).toContain('GRZ II');
    const selects = () => [...host.querySelectorAll('select')];
    change(selects().find((s) => [...s.options].some((o) => o.textContent?.startsWith('offen')))!, 'ja');
    expect(useGrz.getState().project.massNutzung?.einstufung?.terrasse).toBe('ja');
    // Vollgeschoss des DG festlegen
    const vg = selects().filter((s) => [...s.options].some((o) => o.value === 'auto') && [...s.options].some((o) => o.textContent === 'Vollgeschoss'));
    change(vg[vg.length - 1], 'ja');
    expect(useGrz.getState().project.storeys[2].vollgeschoss).toBe(true);
    // zurück auf 1967: Aufenthaltsraum einstufen (DG wieder automatisch)
    change(vg[vg.length - 1], 'auto');
    change(host.querySelector('input[type="date"]') as HTMLInputElement, '1967-03-14');
    const auf = selects().find((s) => [...s.options].some((o) => o.value === 'treppe'))!;
    change(auf, 'treppe');
    const r = useGrz.getState().project.storeys[2].shapes.find((s) => s.kind === 'room');
    expect(r?.kind === 'room' && r.aufenthalt).toBe('treppe');
  });

  it('wählt eine Fläche aus der Liste aus und löscht sie', () => {
    useGrz.getState().load(projekt());
    const host = render(GrzGfzView);
    const link = [...host.querySelectorAll('button.link')].find((b) => b.textContent === 'Terrasse') as HTMLButtonElement;
    act(() => link.click());
    expect(useGrz.getState().selected).toBe(useGrz.getState().project.lageplan!.flaechen[1].id);
    const del = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Fläche löschen') as HTMLButtonElement;
    act(() => del.click());
    expect(useGrz.getState().project.lageplan!.flaechen.map((f) => f.name)).toEqual(['Zufahrt']);
    act(() => useGrz.getState().undo());
    expect(useGrz.getState().project.lageplan!.flaechen).toHaveLength(2);
  });
});
