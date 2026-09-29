// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { rectPoints } from '../core/geometry';
import type { Project, Storey } from '../core/model';
import { createFlaeche, createOutline, createProject, createRoom, createStorey } from '../core/model';
import { useEditor } from '../store/store';
import { GrzGfzView } from './GrzGfzView';
import { Properties } from './Properties';
import { Report } from './Report';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function projekt(): Project {
  const p = createProject('Oberfläche');
  const rect = rectPoints({ x: 0, y: 0 }, { x: 12, y: 11.25 });
  const st = (name: string, e: number, h: number): Storey => ({ ...createStorey(name, h), elevation: e, shapes: [createOutline(rect)] });
  const eg = st('EG', 0, 3.45);
  const og = st('OG', 3.45, 3.2);
  const dg = st('DG', 6.65, 3);
  const o = dg.shapes[0];
  if (o.kind === 'outline') o.dach = { typ: 'walm', traufhoehe: 0, neigung: 45, neigungWalm: 45, firstrichtung: 0 };
  dg.shapes.push(createRoom(rectPoints({ x: 3, y: 3 }, { x: 9, y: 8.25 }), '1', 'Zimmer I'));
  const lp: Storey = { ...createStorey('Lageplan', 0), elevation: 0, lageplan: true };
  lp.shapes.push({ ...createFlaeche(rectPoints({ x: 12, y: 0 }, { x: 15, y: 10 }), 'Zufahrt'), nutzung: 'zufahrt', versiegelung: 'teil', hoehe: -0.2 });
  lp.shapes.push({ ...createFlaeche(rectPoints({ x: -3, y: 0 }, { x: 0, y: 5 }), 'Terrasse'), nutzung: 'terrasse', versiegelung: 'voll' });
  p.storeys = [lp, eg, og, dg];
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

describe('Tab GRZ/GFZ', () => {
  it('zeigt Recht, Kennzahlen, Vollgeschosse und Lageplan-Flächen', () => {
    useEditor.getState().loadProject(projekt());
    const host = render(GrzGfzView);
    const text = host.textContent ?? '';
    expect(text).toContain('automatisch (BauNVO 1962)');
    expect(text).toContain('automatisch (BauO NW 1962/1970)');
    expect(text).toContain('Vollgeschosse nach BauO NW 1962/1970');
    expect(text).toContain('Zufahrt');
    expect(text).toContain('Einstufung offener Fälle');
    expect(host.querySelectorAll('.grz-skizze path').length).toBeGreaterThan(2);
    expect(host.querySelectorAll('.kpi').length).toBe(3); // vor 1990: eine GRZ, keine GRZ II
    expect(text).toContain('Aufenthaltsräume mit Treppenräumen und Umfassungswänden');
  });

  it('ändert Festsetzungen und Einstufung über die Oberfläche', () => {
    useEditor.getState().loadProject(projekt());
    const host = render(GrzGfzView);
    const datum = host.querySelector('input[type="date"]') as HTMLInputElement;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(datum, '2020-05-01');
      datum.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(useEditor.getState().project.massNutzung?.planDatum).toBe('2020-05-01');
    expect(host.textContent).toContain('GRZ II');
    const einst = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent?.startsWith('offen')))!;
    act(() => {
      einst.value = 'ja';
      einst.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useEditor.getState().project.massNutzung?.einstufung?.terrasse).toBe('ja');
  });

  it('Eigenschaften einer Lageplan-Fläche und Bericht', () => {
    const p = projekt();
    useEditor.getState().loadProject(p);
    useEditor.getState().setActiveStorey(p.storeys[0].id);
    useEditor.getState().select(p.storeys[0].shapes[0].id);
    const props = render(Properties);
    expect(props.textContent).toContain('Lageplan-Fläche');
    expect(props.textContent).toContain('Versiegelung');
    act(() => root?.unmount());
    useEditor.getState().select(null);
    useEditor.getState().setActiveStorey(p.storeys[3].id);
    expect(render(Properties).textContent).toContain('Vollgeschoss');
    act(() => root?.unmount());
    const rep = render(Report).textContent ?? '';
    expect(rep).toContain('Maß der baulichen Nutzung');
    expect(rep).not.toContain('Raumliste – Lageplan');
  });
});
