import { describe, expect, it } from 'vitest';
import { eintragAusPosition, gliederung, gliederungFuer, katalogCsv, katalogJson, leseKatalog, positionAusEintrag } from './katalog';
import { positionen } from './testdaten';

const CSV = [
  '# Name: Bürokennwerte',
  '# Quelle: eigene Projekte',
  '# Stand: 1. Quartal 2026',
  '# Index: 131,4',
  'KG;Bezeichnung;Bezug;Grundlage;von;Mittel;bis;Bemerkung',
  '300;Bauwerk – Baukonstruktionen;BGF;;1.500,00;1.800,50;2.100;',
  '330;Außenwände;m² AWF;;;420;;"WDVS; verputzt"',
  '461;Aufzug;Stk;;;45.000;;',
  '540;Carport;psch;;;30000;;',
  '700;Baunebenkosten;%;300+400;18;20;22;',
  '730;Honorare;;;;15;;',
  'abc;keine Kostengruppe;BGF;;;1;;',
].join('\r\n');

describe('Kennwertkatalog', () => {
  it('liest CSV aus Excel: Kopfzeilen, Dezimalkomma, Tausenderpunkt, Bezüge', () => {
    const k = leseKatalog(`﻿${CSV}`, 'Kennwerte.csv');
    expect(k).toMatchObject({ name: 'Bürokennwerte', quelle: 'eigene Projekte', stand: '1. Quartal 2026', index: 131.4 });
    expect(k.eintraege.map((e) => e.kg)).toEqual(['300', '330', '461', '540', '700', '730']);
    expect(k.eintraege[0]).toMatchObject({ bezug: 'bgf', von: 1500, mittel: 1800.5, bis: 2100 });
    expect(k.eintraege[1]).toMatchObject({ bezug: 'awf', mittel: 420, bemerkung: 'WDVS; verputzt' });
    expect(k.eintraege[1].von).toBeUndefined();
    expect(k.eintraege[2]).toMatchObject({ bezug: 'menge', einheit: 'Stk', mittel: 45000 });
    expect(k.eintraege[3]).toMatchObject({ bezug: 'pauschal', mittel: 30000 });
    expect(k.eintraege[4]).toMatchObject({ bezug: 'prozent', basis: ['300', '400'], von: 18, bis: 22 });
    // ohne Bezug: übliche Bezugsgröße der Kostengruppe
    expect(k.eintraege[5]).toMatchObject({ bezug: 'prozent', basis: ['300', '400'], mittel: 15 });
  });

  it('CSV und JSON schreiben und wieder lesen', () => {
    const k = leseKatalog(CSV, 'Kennwerte.csv');
    expect(leseKatalog(katalogCsv(k), 'x.csv')).toEqual(k);
    expect(leseKatalog(katalogJson(k), 'x.json')).toEqual(k);
  });

  it('JSON als reine Liste; ohne Einträge eine verständliche Meldung', () => {
    const k = leseKatalog('[{"kg":"420","bezeichnung":"Wärmeversorgung","mittel":95}]', 'liste.json');
    expect(k.name).toBe('Kennwertkatalog');
    expect(k.eintraege).toEqual([{ kg: '420', bezeichnung: 'Wärmeversorgung', bezug: 'bgf', mittel: 95 }]);
    expect(() => leseKatalog('nur Text', 'leer.csv')).toThrow(/Keine Einträge/);
  });

  it('Einträge werden Positionen mit Quelle – und umgekehrt', () => {
    const k = leseKatalog(CSV, 'Kennwerte.csv');
    const p = positionAusEintrag(k.eintraege[4], k);
    expect(p).toMatchObject({ kg: '700', bezug: 'prozent', basis: ['300', '400'], von: 18, mittel: 20, bis: 22, quelle: 'Bürokennwerte, 1. Quartal 2026' });
    expect(positionAusEintrag(k.eintraege[2], k)).toMatchObject({ bezug: 'menge', einheit: 'Stk' });
    expect(positionen().map(eintragAusPosition)[0]).toEqual({ kg: '300', bezeichnung: 'Bauwerk – Baukonstruktionen', bezug: 'bgf', von: 1500, mittel: 1800, bis: 2100 });
  });

  it('Gliederung je Stufe: 1. Ebene für Rahmen und Schätzung, 2. Ebene ab der Kostenberechnung', () => {
    expect(gliederungFuer('schaetzung')).toBe('grob');
    expect(gliederungFuer('berechnung')).toBe('fein');
    expect(gliederung('grob').map((p) => `${p.kg}:${p.bezug}`)).toEqual(['300:bgf', '400:bgf', '500:auf', '700:prozent']);
    const fein = gliederung('fein');
    expect(fein.find((p) => p.kg === '330')?.bezug).toBe('awf');
    expect(fein.find((p) => p.kg === '360')?.bezug).toBe('daf');
    expect(fein.every((p) => p.mittel === undefined)).toBe(true);
  });
});
