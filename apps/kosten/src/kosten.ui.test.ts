// @vitest-environment happy-dom
import type { FunctionComponent } from 'react';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '@core/model';
import { App } from './App';
import { KatalogDialog } from './components/KatalogDialog';
import { KostenDruck } from './components/KostenDruck';
import { leseKatalog, katalogSpeichern } from './katalog';
import { useKosten } from './store';
import { projekt, projektMitAnbau, projektMitKosten } from './testdaten';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
function render<P extends object>(el: FunctionComponent<P>, props?: P): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(createElement(el, props));
  });
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  katalogSpeichern(null);
});

/** Eingabe wie von Hand: Wert setzen und das Feld verlassen (die Felder übernehmen bei Fokusverlust) */
const eingabe = (el: HTMLInputElement, value: string) => {
  act(() => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => el.blur());
};
const waehle = (el: HTMLSelectElement, value: string) =>
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
const knopf = (host: Element, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement;
const kosten = () => useKosten.getState().project.kosten!;

describe('Kostenermittlung', () => {
  it('zeigt ohne Projekt den Einstieg; Druck und Excel sind gesperrt', () => {
    useKosten.getState().load(createProject());
    const host = render(App);
    expect(host.textContent).toContain('Projekt oder IFC öffnen');
    expect(knopf(host, 'Kosten drucken').disabled).toBe(true);
    expect(knopf(host, 'Excel').disabled).toBe(true);
  });

  it('zeigt Mengen aus dem Projekt, Positionen je Kostengruppe und die Übersicht', () => {
    useKosten.getState().load(projektMitKosten());
    const host = render(App);
    const text = host.textContent ?? '';
    expect(text).not.toContain('Projekt oder IFC öffnen');
    expect(text).toContain('Kostenschätzung');
    expect(text).toContain('1.642.500 €');
    expect(text).toContain('1.954.575 €');
    // abgeleitete BGF als Vorgabe im Mengenfeld
    expect((host.querySelector('.ko-menge input') as HTMLInputElement).placeholder).toBe('540,00');
    expect(host.querySelectorAll('.ko-pos tr.ko-gruppe')).toHaveLength(4);
    expect(host.querySelectorAll('.ko-pos tbody tr:not(.ko-gruppe)')).toHaveLength(5);
  });

  it('Gliederung anlegen, Kennwert eintragen, Menge festlegen, Position ausschalten und löschen', () => {
    useKosten.getState().load(projekt());
    const host = render(App);
    act(() => knopf(host, 'Gliederung 1. Ebene').click());
    expect(kosten().positionen.map((p) => p.kg)).toEqual(['300', '400', '500', '700']);
    expect(host.textContent).toContain('Kennwert fehlt');

    // Kennwert „Mittel“ der KG 300
    const zeile = () => host.querySelectorAll('.ko-pos tbody tr:not(.ko-gruppe)')[0];
    eingabe(zeile().querySelectorAll('.ko-kw input')[1] as HTMLInputElement, '1800');
    expect(kosten().positionen[0].mittel).toBe(1800);
    expect(zeile().textContent).toContain('972.000 €');

    // BGF von Hand festlegen und wieder freigeben
    const bgf = () => host.querySelector('.ko-menge input') as HTMLInputElement;
    eingabe(bgf(), '500');
    expect(kosten().mengen).toEqual({ bgf: 500 });
    expect(zeile().textContent).toContain('900.000 €');
    eingabe(bgf(), '');
    expect(kosten().mengen).toBeUndefined();

    // Bezug umstellen: Prozent bekommt die übliche Grundlage
    waehle(zeile().querySelector('select') as HTMLSelectElement, 'prozent');
    expect(kosten().positionen[0]).toMatchObject({ bezug: 'prozent', basis: ['300', '400'] });
    act(() => useKosten.getState().undo());

    // ausschalten und löschen
    act(() => (zeile().querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    expect(kosten().positionen[0].aus).toBe(true);
    act(() => (zeile().querySelector('button.danger') as HTMLButtonElement).click());
    expect(kosten().positionen.map((p) => p.kg)).toEqual(['400', '500', '700']);
    act(() => useKosten.getState().undo());
    expect(kosten().positionen).toHaveLength(4);
  });

  it('Stufe und Faktoren wirken auf die Übersicht; Stand festhalten und Vorher/Nachher', () => {
    useKosten.getState().load(projektMitKosten());
    const host = render(App);
    waehle(host.querySelector('.ko-col select') as HTMLSelectElement, 'berechnung');
    expect(kosten().stufe).toBe('berechnung');
    expect(host.textContent).toContain('Kostenberechnung');

    act(() => knopf(host, 'Stand festhalten').click());
    expect(kosten().staende).toHaveLength(1);
    expect(kosten().staende![0].gesamtNetto[1]).toBeCloseTo(1642500, 2);
    expect(host.textContent).toContain('Vorher/Nachher');

    eingabe(host.querySelector('.ko-menge input') as HTMLInputElement, '500');
    const text = host.textContent ?? '';
    expect(text).toContain('Geänderte Mengen: BGF 540,00 → 500,00 m²');
    expect(text).toContain('-115.200 €');
  });

  it('druckbare Kostenermittlung mit Übersicht, Positionen, Mengen und Kostenständen', () => {
    useKosten.getState().load(projektMitKosten());
    const host = render(KostenDruck, { onClose: () => {} });
    const text = host.textContent ?? '';
    expect(text).toContain('Kostenschätzung nach DIN 276 (LPh 2)');
    expect(text).toContain('Kosten-Test');
    expect(text).toContain('1.7.2026');
    expect(text).toContain('Gesamt brutto');
    expect(text).toContain('1.954.575 €');
    expect(text).toContain('2.856 €/m² BGF');
    expect(text).toContain('% von KG 300 + 400');
    expect(text).toContain('Brutto-Grundfläche');
    // keine Wohnfläche im Projekt: Mengen ohne Wert erscheinen nicht
    expect(text).not.toContain('Wohnfläche');
    expect(text).toContain('Verfasser/in');
  });

  it('öffnet Druck, Excel und Kennwertkatalog über die Werkzeugleiste', () => {
    useKosten.getState().load(projektMitKosten());
    const host = render(App);
    act(() => knopf(host, 'Kosten drucken').click());
    expect(host.querySelector('.ko-report')).not.toBeNull();
    act(() => knopf(host.querySelector('.ko-report')!, 'Schließen').click());
    act(() => knopf(host, 'Excel').click());
    expect(host.textContent).toContain('Muster-Vorlage herunterladen');
    act(() => knopf(host, 'Abbrechen').click());
    act(() => knopf(host, 'Kennwertkatalog').click());
    expect(host.textContent).toContain('Katalog laden');
  });

  it('Kennwertkatalog: aus dem Projekt erstellen, Einträge wählen und als Positionen übernehmen', () => {
    useKosten.getState().load(projekt());
    katalogSpeichern(leseKatalog('# Name: Büro\n# Stand: 1/2026\n# Index: 130\nKG;Bezeichnung;Bezug;Grundlage;von;Mittel;bis\n300;Bauwerk;BGF;;1500;1800;2100\n700;Nebenkosten;%;300+400;;20;', 'k.csv'));
    let zu = false;
    const host = render(KatalogDialog, { onClose: () => (zu = true) });
    expect(host.textContent).toContain('Büro · Stand: 1/2026 · Baupreisindex 130 · 2 Einträge');
    expect(knopf(host, 'Einträge wählen').disabled).toBe(true);
    act(() => (host.querySelector('thead input[type="checkbox"]') as HTMLInputElement).click());
    act(() => knopf(host, '2 als Positionen übernehmen').click());
    expect(zu).toBe(true);
    expect(kosten().positionen.map((p) => [p.kg, p.mittel, p.quelle])).toEqual([
      ['300', 1800, 'Büro, 1/2026'],
      ['700', 20, 'Büro, 1/2026'],
    ]);
    expect(kosten().katalog).toEqual({ name: 'Büro', stand: '1/2026' });
    expect(kosten().indexBasis).toBe(130);
  });
  it('Mengen prüfen: Grundrisse je Geschoss mit den Teilen der Menge und Rechenweg', () => {
    useKosten.getState().load(projektMitAnbau());
    const host = render(App);
    act(() => knopf(host, 'Mengen prüfen').click());
    // BGF: zwei Geschosse, drei Umrisse, Summe 245 m²
    expect(host.querySelector('.mv-bild h2')?.textContent).toBe('BGF – Brutto-Grundfläche: 245,00 m²');
    expect([...host.querySelectorAll('.mp-geschoss figcaption')].map((f) => f.textContent)).toEqual(['OG90,00 m²', 'EG155,00 m²']);
    expect(host.querySelectorAll('.mp-teil')).toHaveLength(3);
    expect([...host.querySelectorAll('.mp-wert')].map((t) => t.textContent).sort()).toEqual(['135,00', '20,00', '90,00']);
    const zeilen = () => [...host.querySelectorAll('.mv-rechenweg tbody tr')];
    expect(zeilen().map((z) => z.textContent)).toEqual(['EGHaus (R)135,00', 'EGAnbau (R)20,00', 'OGStaffelgeschoss (R)90,00', 'Summe = BGF245,00']);

    // Zeile unter dem Mauszeiger hebt die Fläche im Grundriss hervor
    act(() => zeilen()[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(host.querySelectorAll('.mp-teil.aktiv')).toHaveLength(1);
    expect(host.querySelector('.mp-teil.aktiv title')?.textContent).toBe('Anbau (R): 20,00\nKlick: abwählen');

    // Teil abwählen: zählt nicht mehr, die Auswahl steht im Projekt; „Standard“ setzt zurück
    act(() => (zeilen()[1].querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    expect(host.querySelector('.mv-bild h2')?.textContent).toBe('BGF – Brutto-Grundfläche: 225,00 m²');
    expect(kosten().teile).toEqual({ [`bgf-${useKosten.getState().project.storeys[0].shapes[1].id}`]: false });
    expect(zeilen()[1].className).toContain('mv-aus');
    expect(host.querySelectorAll('.mp-teil.aus')).toHaveLength(1);
    expect(host.querySelector('.mv-auswahl')?.textContent).toContain('2 von 3 Teilen zählen');
    // im Grundriss wieder anwählen
    act(() => (host.querySelector('.mp-teil.aus') as SVGGElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelector('.mv-bild h2')?.textContent).toBe('BGF – Brutto-Grundfläche: 245,00 m²');
    expect(kosten().teile).toBeUndefined();
    act(() => knopf(host.querySelector('.mv-auswahl')!, 'keine').click());
    expect(host.querySelector('.mv-bild h2')?.textContent).toBe('BGF – Brutto-Grundfläche: 0,00 m²');
    act(() => knopf(host.querySelector('.mv-auswahl')!, 'Standard').click());
    expect(kosten().teile).toBeUndefined();

    // Gründungsfläche: nur das EG zählt, das OG bleibt als Bezug stehen
    const menge = (kurz: string) => [...host.querySelectorAll('.mv-liste tbody tr')].find((z) => z.querySelector('strong')?.textContent === kurz) as HTMLElement;
    act(() => menge('GRF').click());
    expect([...host.querySelectorAll('.mp-geschoss figcaption')].map((f) => f.textContent)).toEqual(['OGzählt nicht', 'EG155,00 m²']);
    expect(host.querySelectorAll('.mp-geschoss.leer .mp-umriss')).toHaveLength(1);

    // Nutzungsfläche: ein Raum zählt, die anderen sind nur Linien
    act(() => menge('NUF').click());
    expect(host.querySelectorAll('.mp-teil')).toHaveLength(1);
    expect(host.querySelectorAll('.mp-raum')).toHaveLength(3);
    expect(zeilen()[0].textContent).toBe('EG0.1 Wohnen · NUF 125,76');
  });

  it('Mengen prüfen: Außenwand und Dach öffnen im 3D-Modell und lassen sich im Grundriss zeigen', async () => {
    useKosten.getState().load(projektMitAnbau());
    const host = render(App);
    // Einstieg über das Kürzel in der Kostenansicht
    const awf = [...host.querySelectorAll('.ko-table button.link')].find((b) => b.textContent === 'AWF') as HTMLButtonElement;
    await act(async () => awf.click());
    expect(host.querySelector('.mv-bild h2')?.textContent).toBe('AWF – Außenwandfläche: 307,63 m²');
    expect(host.querySelector('.mv-umschalter button.active')?.textContent).toBe('3D-Modell');
    expect(host.querySelectorAll('.mp-geschoss')).toHaveLength(0);
    expect(host.querySelector('.mv-rechenweg tbody tr')?.textContent).toContain('ohne 1 Abschnitt an anderen Umrissen');
    // im Grundriss: Wände als Kanten
    act(() => knopf(host.querySelector('.mv-umschalter')!, 'Grundrisse').click());
    expect(host.querySelectorAll('.mp-teil.kanten')).toHaveLength(3);

    // festgelegte Menge: Hinweis, dass das Bild die abgeleitete Menge zeigt
    act(() => useKosten.getState().update((p) => ({ ...p, kosten: { positionen: [], mengen: { awf: 300 } } })));
    expect(host.querySelector('.mv-bild .warning')?.textContent).toContain('festgelegte Wert 300,00 m²');
    expect(host.querySelector('.mv-bild .warning')?.textContent).toContain('abgeleitete Menge 307,63');
  });
});
