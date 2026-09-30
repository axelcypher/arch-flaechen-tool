// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '@core/model';
import { App } from './App';
import { GrzGfzView } from './components/GrzGfzView';
import { NachweisDruck } from './components/NachweisDruck';
import { useGrz } from './store';
import { projekt } from './testdaten';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

  it('druckbarer Nachweis mit Grundlagen, Ergebnis, Lageplan und Aufenthaltsräumen', () => {
    useGrz.getState().load(projekt());
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
      root = createRoot(host);
      root.render(createElement(NachweisDruck, { onClose: () => {} }));
    });
    const text = host.textContent ?? '';
    expect(text).toContain('Nachweis des Maßes der baulichen Nutzung');
    expect(text).toContain('14.3.1967');
    expect(text).toContain('BauNVO 1962');
    expect(text).toContain('Hauptanlage (Gebäude)');
    expect(text).toContain('Aufenthaltsräume in Nicht-Vollgeschossen');
    expect(text).toContain('Zimmer I');
    // Lageplan mit Nummern der eigenen Flächen
    expect([...host.querySelectorAll('.plan-svg text')].map((t) => t.textContent)).toEqual(['1', '2']);
  });

  it('öffnet Druck und Excel über die Werkzeugleiste', () => {
    useGrz.getState().load(projekt());
    const host = render(App);
    const btn = (t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith(t)) as HTMLButtonElement;
    act(() => btn('Nachweis drucken').click());
    expect(host.querySelector('.grz-report')).not.toBeNull();
    act(() => btn('Schließen').click());
    act(() => btn('Excel').click());
    expect(host.textContent).toContain('Muster-Vorlage herunterladen');
  });

  it('Punkte wie im Flächenrechner: ziehen, über ◇ einfügen, per Rechtsklick löschen; Fläche verschieben', () => {
    useGrz.getState().load(projekt());
    const host = render(GrzGfzView);
    const id = useGrz.getState().project.lageplan!.flaechen[0].id;
    act(() => useGrz.getState().select(id));
    const svg = host.querySelector('svg.grz-skizze') as SVGSVGElement;
    const punkte = () => useGrz.getState().project.lageplan!.flaechen[0].points;
    const vorher = punkte().map((p) => ({ ...p }));
    // je Ereignis ein eigenes act(), damit der Zustand dazwischen gerendert wird
    const ziehe = (el: Element, x = 50, y = 50) => {
      act(() => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 })));
      act(() => svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y })));
      act(() => svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y })));
    };
    // Punkt ziehen: ein Punkt ändert sich, die Zahl bleibt
    ziehe(host.querySelectorAll('.vertex-handle')[2]);
    expect(punkte()).toHaveLength(4);
    expect(punkte()[2]).not.toEqual(vorher[2]);
    expect(punkte()[0]).toEqual(vorher[0]);
    act(() => useGrz.getState().undo());
    expect(punkte()).toEqual(vorher);
    // ◇ ohne Bewegung fügt den Mittelpunkt ein
    act(() => host.querySelectorAll('.mid-handle')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 })));
    act(() => svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5 })));
    expect(punkte()).toHaveLength(5);
    expect(punkte()[1]).toEqual({ x: (vorher[0].x + vorher[1].x) / 2, y: (vorher[0].y + vorher[1].y) / 2 });
    // Rechtsklick löscht einen Punkt, aber nie unter drei
    const rechts = () => act(() => host.querySelectorAll('.vertex-handle')[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    rechts();
    expect(punkte()).toHaveLength(4);
    rechts();
    rechts();
    expect(punkte()).toHaveLength(3);
    // Mausrad zoomt, ohne dass die Seite scrollt
    const rad = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    act(() => svg.dispatchEvent(rad));
    expect(rad.defaultPrevented).toBe(true);
  });
});
