// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { leereStammdaten } from './stammdaten';
import { useOrdner } from './store';
import { STANDARD } from './struktur';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
function render(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(createElement(App));
  });
  return host;
}
beforeEach(() => useOrdner.setState({ stamm: leereStammdaten(), struktur: STANDARD, stammordner: '', vorlagenordner: '' }));
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** Eingabe wie von Hand: Wert setzen und das Feld verlassen (die Felder übernehmen bei Fokusverlust) */
const eingabe = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    el.focus();
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => el.blur());
};
const knopf = (host: Element, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement;
const feld = (host: Element, label: string) => [...host.querySelectorAll('label.field')].find((l) => l.querySelector('.field-label')?.textContent === label)!.querySelector('input') as HTMLInputElement;

describe('Projektordner', () => {
  it('Neues Projekt: ohne Nummer und Kurzname gesperrt, Trockenlauf zeigt den Plan', () => {
    const host = render();
    expect(host.textContent).toContain('Die Projektnummer fehlt.');
    expect(knopf(host, 'Als ZIP herunterladen').disabled).toBe(true);

    eingabe(feld(host, 'Projektnummer'), '2026-014');
    eingabe(feld(host, 'Kurzname'), 'EFH Musterweg');
    expect(useOrdner.getState().stamm).toMatchObject({ nummer: '2026-014', kurzname: 'EFH Musterweg' });
    expect(host.querySelector('.po-col h3')?.textContent).toContain('2026-014 EFH Musterweg');
    expect(host.textContent).not.toContain('Die Projektnummer fehlt.');
    expect(knopf(host, 'Als ZIP herunterladen').disabled).toBe(false);
    const zeilen = () => [...host.querySelectorAll('.po-plan tr')].map((z) => z.querySelector('td')!.getAttribute('title'));
    expect(zeilen()).toContain('02 Pläne/Ausführung');
    expect(zeilen()).toContain('projekt.json');
    expect(zeilen()).toContain('03 Berechnungen/Flächen/2026-014 EFH Musterweg.oap');

    // nur LPh 1–3 beauftragt: Ordner der Ausführung, Genehmigung, Ausschreibung und Bauleitung entfallen
    for (const nr of [1, 2, 3]) act(() => ([...host.querySelectorAll('.po-lph input')][nr - 1] as HTMLInputElement).click());
    expect(useOrdner.getState().stamm.leistungsphasen).toEqual([1, 2, 3]);
    expect(zeilen()).not.toContain('02 Pläne/Ausführung');
    expect(zeilen()).not.toContain('08 Bauleitung');
    expect(host.textContent).toContain('gehören zu nicht beauftragten Leistungsphasen');
  });

  it('Nummernvorschlag übernehmen, Beteiligte pflegen, Formular leeren', () => {
    const host = render();
    const jahr = new Date().getFullYear();
    act(() => knopf(host, `Nummer ${jahr}-001 übernehmen`).click());
    expect(useOrdner.getState().stamm.nummer).toBe(`${jahr}-001`);
    eingabe(feld(host, 'Bearbeitung'), 'TP');
    act(() => knopf(host, '+ Beteiligter').click());
    eingabe(host.querySelector('.po-beteiligte input') as HTMLInputElement, 'Tragwerk');
    expect(useOrdner.getState().stamm.beteiligte).toEqual([{ rolle: 'Tragwerk', name: '', kontakt: '' }]);
    eingabe(feld(host, 'E-Mail'), 'a@example.org; b@example.org');
    expect(useOrdner.getState().stamm.bauherr.kontakte).toEqual([
      { art: 'email', wert: 'a@example.org' },
      { art: 'email', wert: 'b@example.org' },
    ]);
    act(() => knopf(host, 'Formular leeren').click());
    expect(useOrdner.getState().stamm).toMatchObject({ nummer: '', beteiligte: [], bearbeiter: 'TP' });
  });

  it('Struktur: Schemata und Ordnerliste ändern, Standard wiederherstellen', () => {
    const host = render();
    act(() => knopf(host, 'Struktur').click());
    expect(host.textContent).toContain('Beispiel: ');
    eingabe(feld(host, 'Name des Projektordners'), '{nummer}_{kurzname}');
    expect(useOrdner.getState().struktur.ordnername).toBe('{nummer}_{kurzname}');
    const text = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(text.value.split('\n')).toHaveLength(STANDARD.ordner.length);
    eingabe(text, 'A\nB/C | LPh 5-6 | Dateischema');
    expect(useOrdner.getState().struktur.ordner).toEqual([{ pfad: 'A' }, { pfad: 'B/C', lph: [5, 6], dateischema: true }]);
    // leere Liste wird nicht übernommen
    eingabe(text, '# nichts');
    expect(useOrdner.getState().struktur.ordner).toHaveLength(2);
    expect(host.textContent).toContain('Die Liste enthält keinen Ordner');
    act(() => knopf(host, 'Standard').click());
    expect(useOrdner.getState().struktur).toEqual(STANDARD);
    expect(host.textContent).toContain('{{projekt.nummer}}');
  });

  it('Ordner prüfen: Einstieg erklärt, dass nichts verändert wird', () => {
    const host = render();
    act(() => knopf(host, 'Ordner prüfen').click());
    expect(host.textContent).toContain('es verschiebt, benennt und löscht nichts');
    expect(knopf(host, 'Projektordner wählen')).toBeTruthy();
  });
});
