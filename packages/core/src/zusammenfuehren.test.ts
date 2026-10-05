import { describe, expect, it } from 'vitest';
import { readProjectFile, writeArchive } from './archive';
import type { Project } from './model';
import { addDatei, createOutline, createProject, createRoom } from './model';
import { gleichesProjekt, merge3, zusammenfuehren } from './zusammenfuehren';

function projekt(): Project {
  const p = createProject('Haus');
  p.storeys[0].shapes = [
    createOutline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ]),
    createRoom(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
      '1',
      'Wohnen',
    ),
  ];
  return p;
}

/** wie eine App das Projekt nach Öffnen der Datei hat */
const ausDatei = (p: Project) => readProjectFile(writeArchive(p));

describe('Zusammenführen beim Speichern', () => {
  it('Flächenrechner speichert nach dem GRZ-Nachweis: Festsetzungen und Lageplan bleiben', () => {
    const basis = ausDatei(projekt());
    // Flächenrechner: Raum umbenannt, Geschosshöhe geändert
    const flaechen: Project = {
      ...basis,
      storeys: basis.storeys.map((s) => ({ ...s, hoehe: 2.9, shapes: s.shapes.map((x) => (x.kind === 'room' ? { ...x, name: 'Wohnen/Essen' } : x)) })),
    };
    // GRZ-Nachweis hat inzwischen gespeichert: Festsetzungen, Vollgeschoss, Lageplan
    const grz = ausDatei({
      ...basis,
      massNutzung: { grz: 0.4, gfz: 0.8 },
      storeys: basis.storeys.map((s) => ({ ...s, vollgeschoss: true })),
      lageplan: { flaechen: [{ id: 'lp1', name: 'Zufahrt', points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 5 }], nutzung: 'zufahrt', versiegelung: 'voll' }] },
    });
    expect(gleichesProjekt(basis, grz)).toBe(true);
    const r = zusammenfuehren(basis, flaechen, grz);
    expect(r.massNutzung).toEqual({ grz: 0.4, gfz: 0.8 });
    expect(r.lageplan?.flaechen.map((f) => f.name)).toEqual(['Zufahrt']);
    expect(r.storeys[0].vollgeschoss).toBe(true);
    expect(r.storeys[0].hoehe).toBe(2.9);
    expect(r.storeys[0].shapes.find((x) => x.kind === 'room')!.name).toBe('Wohnen/Essen');
  });

  it('Listen nach id: neue Einträge beider Seiten, Löschungen und eigene Änderungen', () => {
    const basis = { l: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }] };
    const eigen = { l: [{ id: 'a', v: 2 }, { id: 'c', v: 1 }, { id: 'e', v: 1 }] }; // b gelöscht, e neu
    const datei = { l: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'd', v: 1 }] }; // c gelöscht, d neu
    expect(merge3(basis, eigen, datei)).toEqual({ l: [{ id: 'a', v: 2 }, { id: 'd', v: 1 }, { id: 'e', v: 1 }] });
  });

  it('beide ändern denselben Wert: der eigene gilt', () => {
    expect(merge3({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 4 })).toEqual({ x: 2, y: 4 });
  });

  it('Dateien (Excel-Vorlagen) anderer Apps bleiben erhalten', () => {
    const basis = ausDatei(projekt());
    const datei = ausDatei(addDatei(basis, 'grz.xlsx', 'vorlage-grz', new Uint8Array([1, 2, 3])).project);
    const r = zusammenfuehren(basis, { ...basis, name: 'Haus 2' }, datei);
    expect(r.name).toBe('Haus 2');
    expect(r.dateien?.map((d) => d.art)).toEqual(['vorlage-grz']);
  });

  it('anderes Projekt wird nicht zusammengeführt', () => {
    expect(gleichesProjekt(projekt(), projekt())).toBe(false);
  });
});
