import { describe, expect, it } from 'vitest';
import { rectPoints } from './geometry';
import type { FlaecheShape, Project, Storey } from './model';
import { createFlaeche, createOutline, createProject, createRoom, createStorey } from './model';
import { anrechnung, massNachweis, recht } from './massNutzung';

/** Haus wie HSA: UG (Keller), EG, OG je 11,25 × 12 m, DG unter Walmdach 45° ab Fußboden; Grundstück 612,50 m² */
function haus(planDatum?: string): Project {
  const p = createProject('Test');
  const rect = rectPoints({ x: 0, y: 0 }, { x: 12, y: 11.25 });
  const st = (name: string, e: number, h: number) => {
    const s: Storey = { ...createStorey(name, h), elevation: e };
    s.shapes.push(createOutline(rect));
    return s;
  };
  const ug = st('UG', -2.5, 2.5);
  const eg = st('EG', 0, 3.45);
  const og = st('OG', 3.45, 3.2);
  const dg = st('DG', 6.65, 3);
  const dgO = dg.shapes[0];
  if (dgO.kind === 'outline') dgO.dach = { typ: 'walm', traufhoehe: 0, neigung: 45, neigungWalm: 45, firstrichtung: 0 };
  // Aufenthaltsräume im DG (Zimmer mittig) und ein Abstellraum
  dg.shapes.push(createRoom(rectPoints({ x: 3, y: 3 }, { x: 9, y: 8.25 }), '1', 'Zimmer I'), createRoom(rectPoints({ x: 1, y: 1 }, { x: 2, y: 2 }), '2', 'Abstellraum'));
  p.storeys = [ug, eg, og, dg];
  p.meta.grundstueck.flaeche = 612.5;
  p.massNutzung = { planDatum, grz: 0.4, gfz: 0.8, vollgeschosseMax: 2, gelaende: -0.2 };
  return p;
}

function lageplan(p: Project, ...f: FlaecheShape[]) {
  const lp: Storey = { ...createStorey('Lageplan', 0), elevation: -2.5, lageplan: true, shapes: f };
  p.storeys.unshift(lp);
}

const flaeche = (x0: number, y0: number, x1: number, y1: number, patch: Partial<FlaecheShape>): FlaecheShape => ({ ...createFlaeche(rectPoints({ x: x0, y: y0 }, { x: x1, y: y1 })), ...patch });

describe('Maß der baulichen Nutzung: anzuwendendes Recht', () => {
  it('wählt BauNVO und Bauordnung nach dem Plandatum', () => {
    expect(recht({ planDatum: '1967-03-14' })).toMatchObject({ baunvo: '1962', bauo: 'nw1962', ausDatum: true });
    expect(recht({ planDatum: '1978-06-01' })).toMatchObject({ baunvo: '1968', bauo: 'nw1962' });
    expect(recht({ planDatum: '1989-05-01' })).toMatchObject({ baunvo: '1968', bauo: 'nw1985' });
    expect(recht({ planDatum: '1990-01-27' })).toMatchObject({ baunvo: '1990', bauo: 'nw1985' });
    expect(recht({ planDatum: '2019-01-01' })).toMatchObject({ baunvo: '1990', bauo: 'nrw2019' });
    expect(recht({})).toMatchObject({ baunvo: '1990', bauo: 'nrw2019', ausDatum: false });
    expect(recht({ planDatum: '1967-03-14', baunvo: '1990' })).toMatchObject({ baunvo: '1990', bauo: 'nw1962', ausDatum: false });
  });

  it('Anrechnung je Fassung, offene Fälle über die Einstufung', () => {
    expect(anrechnung('garage', '1962')).toBe('hauptanlage');
    expect(anrechnung('garage', '1968')).toBe('garage01');
    expect(anrechnung('terrasse', '1968')).toBe('nein');
    expect(anrechnung('zufahrt', '1990')).toBe('grz2');
    expect(anrechnung('terrasse', '1990')).toBe('pruefen');
    expect(anrechnung('terrasse', '1990', { terrasse: 'ja' })).toBe('grz2');
    expect(anrechnung('zufahrt', '1962', { zufahrt: 'nein' })).toBe('nein');
    expect(anrechnung('garten', '1962', { garten: 'ja' })).toBe('nein');
  });
});

describe('Maß der baulichen Nutzung: Nachweis', () => {
  it('heutiges Recht: GRZ I/II, Vollgeschosse EG und OG, GFZ ohne DG', () => {
    const p = haus('2020-05-01');
    lageplan(
      p,
      flaeche(12, 0, 15, 10, { name: 'Zufahrt', nutzung: 'zufahrt', versiegelung: 'teil', hoehe: -0.2 }),
      flaeche(-3, 0, 0, 5, { name: 'Terrasse', nutzung: 'terrasse', versiegelung: 'voll', hoehe: -0.2 }),
    );
    const n = massNachweis(p);
    const A = 12 * 11.25;
    expect(n.recht).toMatchObject({ baunvo: '1990', bauo: 'nrw2019' });
    expect(n.hauptanlage).toBeCloseTo(A, 6); // Überdeckung, nicht Summe der Geschosse
    expect(n.grz.wert).toBeCloseTo(A / 612.5, 6);
    expect(n.grz.status).toBe('ok');
    expect(n.grz2!.wert).toBeCloseTo((A + 30) / 612.5, 6);
    expect(n.grz2!.mitOffenen).toBeCloseTo((A + 30 + 15) / 612.5, 6);
    expect(n.grz2!.zulaessig).toBeCloseTo(0.6, 9);
    expect(n.geschosse.map((g) => [g.name, g.vollgeschoss])).toEqual([
      ['UG', false],
      ['EG', true],
      ['OG', true],
      ['DG', false],
    ]);
    expect(n.geschosse[0].oberirdisch).toBe(false);
    expect(n.vollgeschosse).toMatchObject({ anzahl: 2, status: 'ok' });
    expect(n.gf).toBeCloseTo(2 * A, 6);
    expect(n.gfz.wert).toBeCloseTo((2 * A) / 612.5, 6);
  });

  it('Plan von 1967: Aufenthaltsräume im DG zählen zur GF (mit Wandzuschlag), Abstellraum nicht', () => {
    const n = massNachweis(haus('1967-03-14'));
    expect(n.recht).toMatchObject({ baunvo: '1962', bauo: 'nw1962' });
    const dg = n.gfJeGeschoss.find((g) => g.name === 'DG')!;
    expect(dg.art).toBe('aufenthalt');
    // Zimmer 6 × 5,25 m, um 0,25 m erweitert (Ecken gerundet)
    expect(dg.flaeche).toBeCloseTo(6.5 * 5.75 - (4 - Math.PI) * 0.25 ** 2, 0);
    expect(n.gf).toBeCloseTo(2 * 12 * 11.25 + dg.flaeche, 6);
  });

  it('BauO NW 1962: Vollgeschoss im Dachraum ab zwei Dritteln der eigenen Grundfläche mit 2,30 m', () => {
    const p = haus('1967-03-14');
    const dg = p.storeys[3].shapes[0];
    // flaches Dach mit Kniestock 3,00 m: überall hoch genug
    if (dg.kind === 'outline') dg.dach = { typ: 'flach', traufhoehe: 3, neigung: 0 };
    expect(massNachweis(p).geschosse.find((g) => g.name === 'DG')!.vollgeschoss).toBe(true);
  });

  it('BauO NW 1984–2018: Höhe bis OK Dachhaut über mehr als drei Viertel der eigenen Grundfläche', () => {
    const p = haus('1995-01-01');
    const dg = p.storeys[3].shapes[0];
    // Satteldach mit hohem Kniestock: 2,30 m bis Dachhaut auf fast der ganzen Fläche
    if (dg.kind === 'outline') dg.dach = { typ: 'sattel', traufhoehe: 2.2, neigung: 40, firstrichtung: 0 };
    const pr = massNachweis(p).geschosse.find((g) => g.name === 'DG')!;
    expect(pr.licht).toBe(false);
    expect(pr.bezug).toBe('eigene');
    expect(pr.anteilSoll).toBe(0.75);
    // Höhe ≥ 2,30 ab 0,1/tan40 ≈ 0,12 m von der Traufe: Anteil ≈ 1 − 2·0,12/11,25
    expect(pr.anteil).toBeGreaterThan(0.97);
    expect(pr.vollgeschoss).toBe(true);
  });

  it('BauNVO 1968/77: Garagen bis 0,1 der Grundstücksfläche anrechnungsfrei, Terrassen nicht', () => {
    const p = haus('1978-06-01');
    lageplan(p, flaeche(12, 0, 15, 6, { nutzung: 'garage' }), flaeche(-3, 0, 0, 5, { nutzung: 'terrasse' }));
    const n = massNachweis(p);
    expect(n.garagenFrei).toBeCloseTo(18, 6);
    expect(n.grz.wert).toBeCloseTo((12 * 11.25) / 612.5, 6);
    expect(n.grz2).toBeUndefined();
    // Überschreitet die Garage 0,1 · G, zählt der Rest
    p.meta.grundstueck.flaeche = 150;
    const n2 = massNachweis(p);
    expect(n2.garagenFrei).toBeCloseTo(15, 6);
    expect(n2.grz.wert).toBeCloseTo((12 * 11.25 + 3) / 150, 6);
  });

  it('Grundstück, Geländehöhe und Flächenbilanz aus den Lageplan-Flächen', () => {
    const p = haus();
    p.meta.grundstueck.flaeche = undefined;
    delete p.massNutzung!.gelaende;
    lageplan(
      p,
      flaeche(-5, -5, 17, 0, { nutzung: 'garten', versiegelung: 'gruen', hoehe: -0.3 }),
      flaeche(-5, 11.25, 17, 16, { nutzung: 'garten', versiegelung: 'gruen', hoehe: -0.3 }),
      flaeche(-5, 0, 0, 11.25, { nutzung: 'terrasse', versiegelung: 'voll', hoehe: -0.1 }),
      flaeche(12, 0, 17, 11.25, { nutzung: 'zufahrt', versiegelung: 'teil', hoehe: -0.1 }),
      // Nachbar: zählt nicht
      flaeche(17, -5, 40, 16, { nutzung: 'garten', versiegelung: 'gruen', nachbar: true, hoehe: 0 }),
    );
    const n = massNachweis(p);
    const G = 22 * 21;
    expect(n.grundstueck).toMatchObject({ quelle: 'lageplan' });
    expect(n.grundstueck.flaeche).toBeCloseTo(G, 6);
    expect(n.gelaende.quelle).toBe('lageplan');
    expect(n.gelaende.hoehe).toBeGreaterThan(-0.3);
    expect(n.gelaende.hoehe).toBeLessThan(-0.1);
    expect(n.bilanz.gebaeude).toBeCloseTo(135, 6);
    expect(n.bilanz.voll).toBeCloseTo(5 * 11.25, 6);
    expect(n.bilanz.teil).toBeCloseTo(5 * 11.25, 6);
    expect(n.bilanz.gruen).toBeCloseTo(2 * 22 * 5 - 22 * 0.25, 6);
    expect(n.bilanz.summe).toBeCloseTo(G, 6);
    expect(n.bilanz.differenz).toBeCloseTo(0, 6);
    expect(n.lageplan.find((x) => x.nachbar)!.anrechnung).toBe('nein');
  });

  it('Übersteuerung je Geschoss', () => {
    const p = haus('2020-01-01');
    p.storeys[3].vollgeschoss = true;
    const n = massNachweis(p);
    expect(n.vollgeschosse).toMatchObject({ anzahl: 3, status: 'ueberschritten' });
    expect(n.geschosse[3].automatisch).toBe(false);
  });
});

describe('Maß der baulichen Nutzung: Speichern', () => {
  it('Festsetzungen, Lageplan-Flächen und Kennzeichen überstehen JSON und Archiv', async () => {
    const { parseProject, serializeProject } = await import('./serialize');
    const { readProjectFile, writeArchive } = await import('./archive');
    const p = haus('1967-03-14');
    p.massNutzung = { ...p.massNutzung, einfamilienhaus: true, wandzuschlag: 0.3, einstufung: { terrasse: 'nein' } };
    p.storeys[1].vollgeschoss = true;
    const dg = p.storeys[3];
    const zimmer = dg.shapes.find((s) => s.kind === 'room')!;
    if (zimmer.kind === 'room') zimmer.aufenthalt = 'treppe';
    lageplan(p, flaeche(12, 0, 15, 10, { name: 'Zufahrt', nutzung: 'zufahrt', versiegelung: 'teil', hoehe: -0.2, nachbar: true }));
    for (const back of [parseProject(serializeProject(p)), readProjectFile(writeArchive(p))]) {
      expect(back.massNutzung).toEqual(p.massNutzung);
      expect(back.storeys[0].lageplan).toBe(true);
      expect(back.storeys[0].shapes[0]).toEqual(p.storeys[0].shapes[0]);
      expect(back.storeys[2].vollgeschoss).toBe(true);
      expect(back.storeys[4].shapes.find((s) => s.kind === 'room')).toMatchObject({ aufenthalt: 'treppe' });
      expect(massNachweis(back)).toEqual(massNachweis(p));
    }
  });
});
