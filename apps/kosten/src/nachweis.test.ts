import { describe, expect, it } from 'vitest';
import { computeProject } from '@core/calc';
import { rectPoints } from '@core/geometry';
import type { Project } from '@core/model';
import { createOutline } from '@core/model';
import { mengenAbgeleitet } from './mengen';
import type { MengeNachweis } from './nachweis';
import { flaeche3, mengenNachweis } from './nachweis';
import { projekt, projektMitAnbau } from './testdaten';

const teile = (m: MengeNachweis) => m.teile.map((t) => [t.geschoss, t.bezeichnung, Math.round(t.wert * 1000) / 1000]);
const raumflaeche = (m: MengeNachweis) => m.teile.flatMap((t) => t.raum ?? []).reduce((a, f) => a + flaeche3(f.aussen) - (f.loecher ?? []).reduce((b, l) => b + flaeche3(l), 0), 0);

describe('Mengennachweis', () => {
  it('Summen der Teile stimmen mit der Flächenberechnung überein (DIN 277, WoFlV)', () => {
    for (const p of [projekt(), projektMitAnbau()]) {
      const t = computeProject(p).total;
      const n = mengenNachweis(p).mengen;
      expect(n.bgf.summe).toBeCloseTo(t.bgf.total, 6);
      expect(n.bri.summe).toBeCloseTo(t.bri.total, 6);
      expect(n.nuf.summe).toBeCloseTo(t.nuf.total, 6);
      expect(n.tf.summe).toBeCloseTo(t.tf.total, 6);
      expect(n.vf.summe).toBeCloseTo(t.vf.total, 6);
      expect(n.nrf.summe).toBeCloseTo(t.nrf.total, 6);
      expect(n.wofl.summe).toBeCloseTo(t.wofl, 6);
      // die Mengen der Kostenermittlung sind genau diese Summen
      const m = mengenAbgeleitet(p);
      for (const b of Object.keys(n) as (keyof typeof n)[]) expect(m[b]).toBeCloseTo(n[b].summe, 2);
    }
  });

  it('Grundflächen: Teile je Umriss und Raum mit Grundriss', () => {
    const p = projektMitAnbau();
    const n = mengenNachweis(p).mengen;
    expect(teile(n.bgf)).toEqual([
      ['EG', 'Haus (R)', 135],
      ['EG', 'Anbau (R)', 20],
      ['OG', 'Staffelgeschoss (R)', 90],
    ]);
    expect(n.bgf.teile.every((t) => t.plan?.length === 1 && t.plan[0].points.length === 4)).toBe(true);
    expect(teile(n.grf)).toEqual([
      ['EG', 'Haus (R)', 135],
      ['EG', 'Anbau (R)', 20],
    ]);
    expect(teile(n.def)).toEqual([['OG', 'Staffelgeschoss (R)', 90]]);
    expect(n.bgi.teile).toEqual([]);
    expect(n.bgi.hinweis).toContain('keine Baugrube');
    expect(teile(n.nuf)).toEqual([['EG', '0.1 Wohnen · NUF 1', 25.76]]);
    expect(n.nrf.summe).toBeCloseTo(25.76 + 8.28 + 15.64, 6);
    expect(n.wofl.teile.map((t) => t.ansatz)).toEqual(['25,76 m² × 100 %', '8,28 m² × 100 %']);
    expect(n.we.teile.map((t) => [t.bezeichnung, t.wert, t.plan?.length])).toEqual([['WE 1', 1, 2]]);
  });

  it('Rauminhalt: Körper je Umriss', () => {
    const n = mengenNachweis(projektMitAnbau()).mengen;
    expect(n.bri.teile.map((t) => [t.bezeichnung, t.ansatz, t.wert])).toEqual([
      ['Haus (R)', '135,00 m² × 3,45 m', 465.75],
      ['Anbau (R)', '20,00 m² × 3,00 m', 60],
      ['Staffelgeschoss (R)', '90,00 m² × 3,20 m', 288],
    ]);
    // sechs Flächen je Quader
    expect(n.bri.teile.map((t) => t.raum?.length)).toEqual([6, 6, 6]);
  });

  it('Außenwand: Wände an einem anderen Umriss zählen nur über dessen Höhe', () => {
    const n = mengenNachweis(projektMitAnbau()).mengen.awf;
    // Haus: 46,50 m × 3,45 m, abzüglich 5,00 m × 3,00 m am Anbau · Anbau: drei freie Seiten (13,00 m) × 3,00 m
    expect(teile(n)).toEqual([
      ['EG', 'Haus (R)', 46.5 * 3.45 - 15],
      ['EG', 'Anbau (R)', 39],
      ['OG', 'Staffelgeschoss (R)', 123.2],
    ]);
    expect(n.teile[0].ansatz).toContain('ohne 1 Abschnitt an anderen Umrissen');
    expect(n.teile[2].ansatz).toBe('Umfang 38,50 m × 3,20 m');
    // die dargestellten Flächen ergeben genau die Menge
    expect(raumflaeche(n)).toBeCloseTo(n.summe, 6);
    // der Streifen der Hauswand über dem Anbau: 5,00 m × 0,45 m zwischen 3,00 und 3,45 m
    const streifen = n.teile[0].raum!.find((f) => Math.abs(flaeche3(f.aussen) - 2.25) < 1e-6)!;
    expect([...new Set(streifen.aussen.map((q) => q.z))].sort()).toEqual([3, 3.45]);
  });

  it('Dach: ebene Flächen nur, soweit kein Geschoss darüber liegt', () => {
    const n = mengenNachweis(projektMitAnbau()).mengen.daf;
    // Haus: 135 − 90 unter dem Staffelgeschoss = 45 · Anbau 20 · Staffelgeschoss 90
    expect(teile(n)).toEqual([
      ['EG', 'Haus (R)', 45],
      ['EG', 'Anbau (R)', 20],
      ['OG', 'Staffelgeschoss (R)', 90],
    ]);
    expect(n.teile[0].ansatz).toContain('abzüglich überbauter Fläche');
    expect(raumflaeche(n)).toBeCloseTo(155, 6);
    // die freie Dachfläche des Hauses liegt östlich des Staffelgeschosses (x von 8 bis 12) in Höhe der Decke
    const frei = n.teile[0].raum![0].aussen;
    expect([Math.min(...frei.map((q) => q.x)), Math.max(...frei.map((q) => q.x)), frei[0].z]).toEqual([8, 12, 3.45]);
  });

  it('Walmdach: geneigte Flächen in wahrer Größe, Decken darunter zählen nicht', () => {
    const n = mengenNachweis(projekt()).mengen;
    expect(teile(n.daf)).toEqual([['DG', 'BGF (R)', Math.round((135 / Math.cos(Math.PI / 4)) * 1000) / 1000]]);
    expect(n.daf.teile[0].ansatz).toBe('Walmdach, 45°');
    expect(n.awf.teile.map((t) => t.geschoss)).toEqual(['UG', 'EG', 'OG']);
    expect(n.bgi.teile.map((t) => [t.geschoss, t.ansatz, t.wert])).toEqual([['UG', '135,00 m² × 2,80 m', 378]]);
  });

  it('Außenanlagen: Grundstück abzüglich des größten Geschosses; ohne Grundstücksfläche ein Hinweis', () => {
    const p = projektMitAnbau();
    const n = mengenNachweis(p).mengen;
    expect(teile(n.auf)).toEqual([
      ['', 'Grundstücksfläche laut Projektdaten', 500],
      ['EG', 'überbaut: Haus (R)', -135],
      ['EG', 'überbaut: Anbau (R)', -20],
    ]);
    expect(n.auf.summe).toBe(345);
    const ohne: Project = { ...p, meta: { ...p.meta, grundstueck: { ...p.meta.grundstueck, flaeche: undefined } } };
    const m = mengenNachweis(ohne).mengen;
    expect(m.auf.teile).toEqual([]);
    expect(m.fbg.hinweis).toContain('fehlt');
  });

  it('Abzugsflächen erscheinen als negative Teile', () => {
    const p = projektMitAnbau();
    p.storeys[1].shapes.push({ ...createOutline(rectPoints({ x: 2, y: 2 }, { x: 4, y: 5 }), 'Luftraum'), subtract: true });
    const n = mengenNachweis(p).mengen;
    expect(teile(n.bgf).at(-1)).toEqual(['OG', 'Luftraum (R) – Abzug', -6]);
    expect(n.bgf.summe).toBe(239);
  });

  it('wird wiederverwendet, solange sich das Gebäude nicht ändert', () => {
    const p = projektMitAnbau();
    const a = mengenNachweis(p);
    expect(mengenNachweis({ ...p, name: 'umbenannt', kosten: { positionen: [] } })).toBe(a);
    expect(mengenNachweis({ ...p, storeys: [...p.storeys] })).not.toBe(a);
  });
});
