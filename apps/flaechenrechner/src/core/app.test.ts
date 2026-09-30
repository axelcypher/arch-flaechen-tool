import { describe, expect, it } from 'vitest';
import { computeProject } from '@core/calc';
import { rectPoints } from '@core/geometry';
import { createOutline, createProject } from '@core/model';
import { parseProject, serializeProject } from '@core/serialize';
import { projectToCsv } from './export';
import { buildExportContext } from './exportData';

const rect = (x: number, y: number, w: number, h: number) => rectPoints({ x, y }, { x: x + w, y: y + h });

describe('CSV-Export', () => {
  it('exportiert CSV mit Dezimalkomma', () => {
    const p = createProject('Test');
    const eg = p.storeys[0];
    eg.hoehe = 3;
    eg.shapes.push(createOutline(rect(0, 0, 10, 10)));
    const hof = createOutline(rect(4, 4, 2, 2));
    hof.subtract = true;
    eg.shapes.push(hof);
    const balkon = createOutline(rect(10, 0, 2, 4));
    balkon.umschliessung = 'S';
    eg.shapes.push(balkon);
    const csv = projectToCsv(p, computeProject(p));
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('Summe;;96,00;8,00;104,00');
  });
});

describe('Projektdaten in Excel-Vorlagen', () => {
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
