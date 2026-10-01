import { describe, expect, it } from 'vitest';
import { readProjectFile, writeArchive } from '@core/archive';
import type { Project } from '@core/model';
import { kgEbene, kgInBasis, kgUnter, standardBezug } from './din276';
import { berechne, bezugLabel, spanneVon, standAus, vergleiche } from './kosten';
import { mengen, mengenAbgeleitet } from './mengen';
import { addPositionen, mapPosition, removePosition, setKosten } from './store';
import { projekt, projektMitKosten } from './testdaten';

const mitKosten = (patch: Partial<NonNullable<Project['kosten']>>): Project => setKosten(projektMitKosten(), patch);
const summe = (p: Project, kg: string) => berechne(p).summen.find((s) => s.kg === kg)?.summe;

describe('DIN 276', () => {
  it('Gliederung: Ebenen, Unterordnung und Grundlagen', () => {
    expect(['300', '330', '331', '900', '33'].map(kgEbene)).toEqual([1, 2, 3, 0, 0]);
    expect(kgUnter('331', '300')).toBe(true);
    expect(kgUnter('331', '330')).toBe(true);
    expect(kgUnter('330', '340')).toBe(false);
    expect(kgInBasis('412', ['300', '400'])).toBe(true);
    expect(kgInBasis('500', ['300', '400'])).toBe(false);
  });

  it('übliche Bezugsgröße je Kostengruppe', () => {
    expect(standardBezug('300').bezug).toBe('bgf');
    expect(standardBezug('330').bezug).toBe('awf');
    expect(standardBezug('361').bezug).toBe('daf');
    expect(standardBezug('420').bezug).toBe('bgf');
    expect(standardBezug('500').bezug).toBe('auf');
    expect(standardBezug('730')).toEqual({ bezug: 'prozent', basis: ['300', '400'] });
  });
});

describe('Mengen', () => {
  it('aus dem Projekt abgeleitet (Handrechnung)', () => {
    const m = mengenAbgeleitet(projekt());
    expect(m.bgf).toBeCloseTo(4 * 135, 2);
    expect(m.grf).toBeCloseTo(135, 2);
    expect(m.def).toBeCloseTo(3 * 135, 2);
    expect(m.bgi).toBeCloseTo(135 * 2.8, 2);
    // Außenwand: Umfang 46,5 m × (2,80 + 3,45 + 3,20) m; das Walmdach beginnt an der Traufe ohne Kniestock
    expect(m.awf).toBeCloseTo(46.5 * 9.45, 1);
    // Walmdach 45°: Grundfläche / cos 45°
    expect(m.daf).toBeCloseTo(135 / Math.cos(Math.PI / 4), 1);
    expect(m.fbg).toBe(612.5);
    expect(m.auf).toBeCloseTo(612.5 - 135, 2);
    expect(m.bri).toBeGreaterThan(135 * 9.45);
  });

  it('festgelegte Menge gilt statt der abgeleiteten', () => {
    const m = mengen(mitKosten({ mengen: { bgf: 500 } }));
    expect(m.bgf).toEqual({ wert: 500, abgeleitet: 540, festgelegt: true });
    expect(m.grf.festgelegt).toBe(false);
  });
});

describe('Kosten', () => {
  it('Bandbreite: fehlende Werte werden ergänzt', () => {
    expect(spanneVon({ mittel: 10 })).toEqual([10, 10, 10]);
    expect(spanneVon({ von: 8, bis: 12 })).toEqual([8, 10, 12]);
    expect(spanneVon({ von: 8 })).toEqual([8, 8, 8]);
    expect(spanneVon({})).toEqual([0, 0, 0]);
  });

  it('Kostenschätzung gegen Handrechnung', () => {
    const e = berechne(projektMitKosten());
    const s = (kg: string) => e.summen.find((x) => x.kg === kg)!.summe;
    // KG 300: 540 m² BGF × 1.500 / 1.800 / 2.100 €
    expect(s('300')).toEqual([810000, 972000, 1134000]);
    // KG 400: 540 m² × 600 €
    expect(s('400')).toEqual([324000, 324000, 324000]);
    // KG 500: befestigte Flächen 477,5 m² × 120 € (KG 530) + Carport pauschal 30.000 € (KG 540)
    expect(s('500')[1]).toBeCloseTo(57300 + 30000, 2);
    expect(s('530')[1]).toBeCloseTo(57300, 2);
    expect(s('540')[1]).toBe(30000);
    // KG 700: 18 / 20 / 22 % von KG 300 + 400
    expect(s('700')[0]).toBeCloseTo(0.18 * 1134000, 2);
    expect(s('700')[1]).toBeCloseTo(0.2 * 1296000, 2);
    expect(s('700')[2]).toBeCloseTo(0.22 * 1458000, 2);
    expect(e.gesamtNetto[0]).toBeCloseTo(1425420, 2);
    expect(e.gesamtNetto[1]).toBeCloseTo(1642500, 2);
    expect(e.gesamtNetto[2]).toBeCloseTo(1866060, 2);
    expect(e.gesamtBrutto[1]).toBeCloseTo(1642500 * 1.19, 2);
    // Bauwerk brutto je m² BGF: (972.000 + 324.000) × 1,19 / 540
    expect(e.kennwerte.find((k) => k.kurz === 'BGF')!.wert[1]).toBeCloseTo(2856, 2);
    expect(e.hinweise).toEqual([]);
  });

  it('Baupreisindex und Regionalfaktor wirken auf Kennwerte, nicht auf Pauschalen und Prozentsätze', () => {
    const p = mitKosten({ indexBasis: 100, indexAktuell: 120, regionalfaktor: 1.05 });
    const e = berechne(p);
    expect(e.faktor).toBeCloseTo(1.26, 6);
    expect(summe(p, '300')![1]).toBeCloseTo(972000 * 1.26, 2);
    expect(summe(p, '540')![1]).toBe(30000);
    expect(summe(p, '700')![1]).toBeCloseTo(0.2 * 1296000 * 1.26, 2);
    expect(e.hinweise.join(' ')).toContain('Faktor 1,26');
  });

  it('Kennwerte brutto werden auf netto umgerechnet; eigener Umsatzsteuersatz', () => {
    const p = mitKosten({ kennwerteBrutto: true, mwst: 7 });
    const e = berechne(p);
    expect(summe(p, '300')![1]).toBeCloseTo(972000 / 1.07, 2);
    expect(e.gesamtBrutto[1]).toBeCloseTo(e.gesamtNetto[1] * 1.07, 2);
  });

  it('eigene Menge, ausgeschaltete Position und dritte Ebene', () => {
    let p = addPositionen(projektMitKosten(), [{ id: 'p461', kg: '461', bezeichnung: 'Aufzug', bezug: 'menge', menge: 2, einheit: 'Stk', mittel: 45000 }]);
    expect(p.kosten!.positionen.map((x) => x.kg)).toEqual(['300', '400', '461', '530', '540', '700']);
    expect(summe(p, '460')![1]).toBe(90000);
    // KG 400 und 461 gleichzeitig: Hinweis auf Doppelerfassung
    expect(berechne(p).hinweise.join(' ')).toContain('KG 400 und KG 461');
    p = mapPosition(p, 'p461', (x) => ({ ...x, aus: true }));
    expect(summe(p, '460')).toBeUndefined();
    expect(berechne(p).hinweise).toEqual([]);
    expect(removePosition(p, 'p461').kosten!.positionen).toHaveLength(5);
  });

  it('Hinweise: fehlender Kennwert, fehlende Menge, ungültige Kostengruppe, Grundlage mit eigener Kostengruppe', () => {
    const p = setKosten(projekt(), {
      positionen: [
        { id: 'a', kg: '300', bezeichnung: 'ohne Kennwert', bezug: 'bgf' },
        { id: 'b', kg: '610', bezeichnung: 'ohne Menge', bezug: 'menge', mittel: 500 },
        { id: 'c', kg: '9', bezeichnung: 'falsche KG', bezug: 'pauschal', mittel: 1000 },
        { id: 'd', kg: '730', bezeichnung: 'Honorar', bezug: 'prozent', basis: ['300', '700'], mittel: 10 },
      ],
    });
    const e = berechne(p);
    expect(e.positionen.map((x) => x.hinweis)).toEqual(['Kennwert fehlt', 'Menge fehlt', undefined, 'Grundlage enthält die eigene Kostengruppe']);
    expect(e.positionen[2].aktiv).toBe(false);
    expect(e.gesamtNetto).toEqual([0, 0, 0]);
    expect(e.hinweise.join(' ')).toContain('keine gültige Kostengruppe');
    expect(e.hinweise.join(' ')).toContain('3 Positionen ohne Menge oder Kennwert');
  });

  it('Bezugsgröße als Text', () => {
    const [p300, , , p540, p700] = projektMitKosten().kosten!.positionen;
    expect([p300, p540, p700].map(bezugLabel)).toEqual(['m² BGF', 'psch', '% von KG 300 + 400']);
    expect(bezugLabel({ bezug: 'menge', einheit: 'lfm' })).toBe('lfm');
  });
});

describe('Kostenstände', () => {
  it('Stand festhalten und nach einer Flächenänderung vergleichen', () => {
    const p = projektMitKosten();
    const stand = standAus(berechne(p), 'schaetzung', 'Vorentwurf', '2026-07-01');
    expect(stand.gesamtNetto[1]).toBeCloseTo(1642500, 2);
    expect(stand.mengen.bgf).toBe(540);
    // BGF sinkt auf 500 m²: KG 300 −72.000 €, KG 400 −24.000 €, KG 700 −19.200 €
    const v = vergleiche(stand, berechne(setKosten(p, { mengen: { bgf: 500 } })));
    expect(v.zeilen.map((z) => [z.kg, Math.round(z.differenz)])).toEqual([
      ['300', -72000],
      ['400', -24000],
      ['500', 0],
      ['700', -19200],
    ]);
    expect(v.gesamt.differenz).toBeCloseTo(-115200, 2);
    expect(v.mengen).toEqual([{ bezug: 'bgf', vorher: 540, jetzt: 500 }]);
  });

  it('Kosten, Kostenstände und Festlegungen überstehen das Speichern im Projektarchiv', () => {
    let p = mitKosten({ mengen: { bgf: 500 }, indexBasis: 100, indexAktuell: 120, katalog: { name: 'Büro', stand: '1/2026' } });
    p = setKosten(p, { staende: [standAus(berechne(p), 'schaetzung', 'Vorentwurf', '2026-07-01')] });
    const back = readProjectFile(writeArchive(p, { app: 'Test' }));
    expect(back.kosten).toEqual(p.kosten);
    expect(berechne(back).gesamtNetto).toEqual(berechne(p).gesamtNetto);
  });
});
