import { describe, expect, it } from 'vitest';
import { computeProject, computeStorey } from './calc';
import { projectToCsv } from './export';
import { buildExportContext } from './exportData';
import { fmt2, parseNum } from './format';
import {
  centroid,
  isSelfIntersecting,
  labelPoint,
  perimeter,
  pointInPolygon,
  polygonArea,
  rectPoints,
  signedArea,
  snapToGrid,
} from './geometry';
import { createOutline, createProject, createRoom, createStorey } from './model';
import { woflFaktor } from './norms';
import { parseProject, serializeProject } from './serialize';

const rect = (x: number, y: number, w: number, h: number) => rectPoints({ x, y }, { x: x + w, y: y + h });

describe('Geometrie', () => {
  it('berechnet Rechteckflächen unabhängig vom Umlaufsinn', () => {
    const r = rect(0, 0, 10, 12.5);
    expect(polygonArea(r)).toBeCloseTo(125);
    expect(polygonArea([...r].reverse())).toBeCloseTo(125);
    expect(Math.sign(signedArea(r))).toBe(-Math.sign(signedArea([...r].reverse())));
  });

  it('berechnet L-Formen, Umfang und Schwerpunkt', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ];
    expect(polygonArea(l)).toBeCloseTo(6 * 2 + 2 * 4);
    expect(perimeter(l)).toBeCloseTo(24);
    expect(centroid(rect(0, 0, 4, 2))).toEqual({ x: 2, y: 1 });
    const lp = labelPoint(l);
    expect(pointInPolygon(lp, l)).toBe(true);
  });

  it('erkennt Selbstüberschneidungen', () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ];
    expect(isSelfIntersecting(bowtie)).toBe(true);
    expect(isSelfIntersecting(rect(0, 0, 3, 3))).toBe(false);
  });

  it('fängt auf das Raster ohne Rundungsrauschen', () => {
    expect(snapToGrid({ x: 1.2345, y: -0.026 }, 0.05)).toEqual({ x: 1.25, y: -0.05 });
  });
});

describe('Zahlenformat', () => {
  it('liest deutsche und englische Dezimaltrenner', () => {
    expect(parseNum('3,25')).toBe(3.25);
    expect(parseNum(' 3.5 ')).toBe(3.5);
    expect(parseNum('abc')).toBeNull();
    expect(fmt2(1234.5)).toBe('1.234,50');
  });
});

describe('DIN 277 / WoFlV', () => {
  function sampleProject() {
    const p = createProject('Test');
    const eg = p.storeys[0];
    eg.hoehe = 3;
    eg.shapes.push(createOutline(rect(0, 0, 10, 10))); // 100 m² BGF
    const hof = createOutline(rect(4, 4, 2, 2)); // 4 m² Abzug
    hof.subtract = true;
    eg.shapes.push(hof);
    const balkonBgf = createOutline(rect(10, 0, 2, 4)); // 8 m² BGF (S)
    balkonBgf.umschliessung = 'S';
    eg.shapes.push(balkonBgf);

    const wohnen = createRoom(rect(0.3, 0.3, 5, 4), '0.01', 'Wohnen'); // 20 m²
    wohnen.wofl = { kategorie: 'voll', wohnung: 'WE 1' };
    const flur = createRoom(rect(0.3, 5, 3, 2), '0.02', 'Flur'); // 6 m²
    flur.nutzung = 'VF';
    flur.wofl = { kategorie: 'voll', wohnung: 'WE 1' };
    const hzg = createRoom(rect(6, 6, 2, 2), '0.03', 'Heizung'); // 4 m²
    hzg.nutzung = 'TF';
    const balkon = createRoom(rect(10, 0, 2, 4), '0.04', 'Balkon'); // 8 m²
    balkon.umschliessung = 'S';
    balkon.wofl = { kategorie: 'freisitz', wohnung: 'WE 1' };
    eg.shapes.push(wohnen, flur, hzg, balkon);

    const og = createStorey('OG', 2.8);
    og.shapes.push(createOutline(rect(0, 0, 10, 10)));
    const schraege = createRoom(rect(0, 0, 10, 1), '1.01', 'Schräge');
    schraege.wofl = { kategorie: 'halb', wohnung: 'WE 2' };
    og.shapes.push(schraege);
    p.storeys.push(og);
    return p;
  }

  it('berechnet BGF, BRI, NRF und KGF je Geschoss', () => {
    const p = sampleProject();
    const r = computeStorey(p.storeys[0], p);
    expect(r.bgf.R).toBeCloseTo(96);
    expect(r.bgf.S).toBeCloseTo(8);
    expect(r.bgf.total).toBeCloseTo(104);
    expect(r.bri.total).toBeCloseTo(104 * 3);
    expect(r.nuf.total).toBeCloseTo(20 + 8);
    expect(r.nutzung.NUF1).toBeCloseTo(28);
    expect(r.tf.total).toBeCloseTo(4);
    expect(r.vf.total).toBeCloseTo(6);
    expect(r.nrf.R).toBeCloseTo(30);
    expect(r.nrf.S).toBeCloseTo(8);
    expect(r.kgf.R).toBeCloseTo(66);
    expect(r.kgf.S).toBeCloseTo(0);
  });

  it('berücksichtigt abweichende Höhen für den BRI', () => {
    const p = createProject();
    const o = createOutline(rect(0, 0, 5, 4));
    o.hoehe = 5.5;
    p.storeys[0].shapes.push(o);
    expect(computeStorey(p.storeys[0], p).bri.total).toBeCloseTo(110);
  });

  it('berechnet Wohnflächen mit Anrechnungsfaktoren je Wohnung', () => {
    const p = sampleProject();
    const r = computeProject(p);
    // WE 1: 20 + 6 + 8 × 0,25 = 28; WE 2: 10 × 0,5 = 5
    expect(r.wohnungen.map((w) => w.wohnung)).toEqual(['WE 1', 'WE 2']);
    expect(r.wohnungen[0].wofl).toBeCloseTo(28);
    expect(r.wohnungen[1].wofl).toBeCloseTo(5);
    expect(r.total.wofl).toBeCloseTo(33);
    expect(r.total.bgf.total).toBeCloseTo(204);
    expect(r.total.bri.total).toBeCloseTo(104 * 3 + 100 * 2.8);
  });

  it('begrenzt den Balkonfaktor auf höchstens 50 %', () => {
    const s = createProject().settings;
    expect(woflFaktor({ kategorie: 'freisitz', wohnung: '' }, s)).toBe(0.25);
    expect(woflFaktor({ kategorie: 'freisitz', faktor: 0.8, wohnung: '' }, s)).toBe(0.5);
  });

  it('exportiert CSV mit Dezimalkomma', () => {
    const p = sampleProject();
    const csv = projectToCsv(p, computeProject(p));
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Summe;;196,00;8,00;204,00');
  });
});

describe('Serialisierung', () => {
  it('speichert und lädt ein Projekt verlustfrei', () => {
    const p = createProject('Roundtrip');
    p.storeys[0].shapes.push(createRoom(rect(0, 0, 3, 4), '1', 'Küche'));
    const back = parseProject(serializeProject(p));
    expect(back).toEqual(JSON.parse(JSON.stringify(p)));
  });

  it('weist fremde Dateien ab und bereinigt ungültige Werte', () => {
    expect(() => parseProject('{"foo":1}')).toThrow();
    expect(() => parseProject('kein json')).toThrow();
    const p = parseProject(
      JSON.stringify({
        format: 'arch-flaechen-tool',
        version: 1,
        storeys: [{ name: 'EG', shapes: [{ kind: 'room', nutzung: 'XYZ', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, { kind: 'room', points: [] }] }],
      }),
    );
    expect(p.storeys[0].shapes).toHaveLength(1);
    const s = p.storeys[0].shapes[0];
    expect(s.kind === 'room' && s.nutzung).toBe('NUF1');
  });
});

describe('Projektdaten', () => {
  it('übernimmt die Adresse früherer Versionen (Freitext) als Straße, PLZ, Ort', () => {
    const alt = (adresse: string) =>
      parseProject(JSON.stringify({ format: 'arch-flaechen-tool', version: 1, meta: { projektcode: 'HSA', adresse, bearbeiter: 'TP' }, storeys: [] })).meta;
    expect(alt('Deiringser Weg 7a, 59494 Soest').adresse).toEqual({ strasse: 'Deiringser Weg 7a', plz: '59494', ort: 'Soest' });
    expect(alt('59494 Soest').adresse).toEqual({ strasse: '', plz: '59494', ort: 'Soest' });
    expect(alt('Hauptstraße 1').adresse).toEqual({ strasse: 'Hauptstraße 1', plz: '', ort: '' });
    const m = alt('Deiringser Weg 7a, 59494 Soest');
    expect(m).toMatchObject({ projektcode: 'HSA', bearbeiter: 'TP', grundstueck: { gemarkung: '', flur: '', flurstueck: '' }, bauherr: { name: '', kontakte: [] } });
  });

  it('stellt Projektdaten als Platzhalter bereit', () => {
    const p = createProject('Sanierung EFH Sander');
    p.meta.adresse = { strasse: 'Deiringser Weg 7a', plz: '59494', ort: 'Soest' };
    p.meta.grundstueck = { gemarkung: 'Soest', flur: '12', flurstueck: '345/6', flaeche: 612.5 };
    p.meta.bauherr = {
      name: 'Familie Sander',
      adresse: { strasse: 'Musterweg 1', plz: '59494', ort: 'Soest' },
      kontakte: [
        { art: 'email', wert: 'sander@example.org' },
        { art: 'telefon', wert: '02921 1234' },
        { art: 'telefon', wert: '0170 555' },
      ],
    };
    const s = buildExportContext(p, computeProject(p)).scalars;
    expect(s['projekt.adresse']).toBe('Deiringser Weg 7a, 59494 Soest');
    expect(s['projekt.plz_ort']).toBe('59494 Soest');
    expect(s['grundstueck.flurtext']).toBe('Gemarkung Soest, Flur 12, Flurstück 345/6');
    expect(s['grundstueck.flaeche']).toBe(612.5);
    expect(s['bauherr.adresse']).toBe('Musterweg 1, 59494 Soest');
    expect(s['bauherr.email']).toBe('sander@example.org');
    expect(s['bauherr.telefon']).toBe('02921 1234, 0170 555');
    // Roundtrip
    expect(parseProject(serializeProject(p)).meta).toEqual(p.meta);
  });
});
