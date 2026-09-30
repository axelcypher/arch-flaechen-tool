import type { ExportContext, PlaceholderDocs, Row, Value } from '@core/excel/context';
import { PROJEKT_DOCS, projektWerte } from '@core/excel/projekt';
import { polygonArea } from '@core/geometry';
import { nutzungLabel, versiegelungInfo } from '@core/lageplan';
import type { Project, RoomShape } from '@core/model';
import type { Kennzahl, Nachweis } from '../massNutzung';
import { baunvoLabel, bauoLabel, istAufenthaltsraum, massNachweis } from '../massNutzung';
import { ANRECHNUNG, AUFENTHALT, GF_ART, HAFTUNG, roemisch, STATUS } from '../texte';

/**
 * Datengrundlage für Excel-Export und Vorlagen des GRZ-Nachweises (Syntax siehe docs/excel-vorlagen.md).
 *
 *   {{grz}}, {{gfz}}, {{vollgeschosse}}   Kennzahlen
 *   {{geschoss.name}}                     Zeile je Geschoss (ebenso lageplan, raum, hinweis)
 *   {{lageplan[eigen].name}}              mit Filter
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const opt = (v: number | undefined, f = r4): Value => (v === undefined ? '' : f(v));

const FILTERS: Record<string, (r: Row) => boolean> = {
  vollgeschoss: (r) => r.vollgeschoss === 'ja',
  oberirdisch: (r) => r.oberirdisch === 'ja',
  eigen: (r) => r.nachbar !== 'ja',
  nachbar: (r) => r.nachbar === 'ja',
  zaehlt: (r) => r._anrechnung === 'hauptanlage',
  'zählt': (r) => r._anrechnung === 'hauptanlage',
  grz2: (r) => r._anrechnung === 'grz2',
  pruefen: (r) => r._anrechnung === 'pruefen',
  'prüfen': (r) => r._anrechnung === 'pruefen',
  voll: (r) => r._versiegelung === 'voll',
  teil: (r) => r._versiegelung === 'teil',
  gruen: (r) => r._versiegelung === 'gruen',
  'grün': (r) => r._versiegelung === 'gruen',
  aufenthalt: (r) => r._aufenthalt === 'ja' || r._aufenthalt === 'treppe',
  gf: (r) => r._gf === 'ja',
};

function zugehoerig(child: string, row: Row, parent: string, p: Row): boolean {
  if (parent === 'geschoss' && child === 'raum') return row._geschossId === p._id;
  if (parent === 'raum' && child === 'geschoss') return row._id === p._geschossId;
  return true;
}

function kennzahlWerte(prefix: string, k: Kennzahl | undefined, flaeche: number | undefined): Record<string, Value> {
  return {
    [prefix]: k ? r4(k.wert) : '',
    [`${prefix}.zulaessig`]: opt(k?.zulaessig),
    [`${prefix}.flaeche`]: k && flaeche !== undefined ? r2(flaeche) : '',
    [`${prefix}.mit_offenen`]: opt(k?.mitOffenen),
    [`${prefix}.reserve`]: opt(k?.reserve, r2),
    [`${prefix}.status`]: k ? STATUS[k.status].label : '',
  };
}

export function buildGrzContext(project: Project, date = new Date(), n: Nachweis = massNachweis(project)): ExportContext {
  const G = n.grundstueck.flaeche;
  const scalars: Record<string, Value> = {
    ...projektWerte(project, date),
    'bplan.datum': project.massNutzung?.planDatum ? new Date(project.massNutzung.planDatum).toLocaleDateString('de-DE') : '',
    'baunvo.fassung': baunvoLabel(n.recht.baunvo),
    'bauo.fassung': bauoLabel(n.recht.bauo),
    'recht.hinweise': n.recht.hinweise.join(' '),
    'grundstueck.flaeche_nachweis': opt(G, r2),
    'grundstueck.quelle': n.grundstueck.quelle === 'lageplan' ? 'aus dem Lageplan' : n.grundstueck.quelle === 'projektdaten' ? 'Projektdaten' : 'fehlt',
    gelaende: r2(n.gelaende.hoehe),
    'gelaende.quelle': n.gelaende.quelle === 'festgelegt' ? 'festgelegt' : n.gelaende.quelle === 'lageplan' ? 'aus dem Lageplan' : 'angenommen (±0,00)',
    'grz.bezeichnung': n.recht.baunvo === '1990' ? 'GRZ I' : 'GRZ',
    'grz.ii.bezeichnung': n.grz2 ? 'GRZ II (§ 19 Abs. 4)' : '',
    'aufenthalt.titel': n.recht.baunvo === '1990' ? '' : 'Aufenthaltsräume in Nicht-Vollgeschossen',
    hauptanlage: r2(n.hauptanlage),
    ...kennzahlWerte('grz', n.grz, G !== undefined ? n.grz.wert * G : undefined),
    ...kennzahlWerte('grz.ii', n.grz2, n.grz2 && G !== undefined ? n.grz2.wert * G : undefined),
    'garagen.frei': opt(n.garagenFrei, r2),
    gf: r2(n.gf),
    'gf.aufenthalt': r2(n.gfAufenthalt),
    ...kennzahlWerte('gfz', n.gfz, n.gf),
    vollgeschosse: n.vollgeschosse.anzahl,
    'vollgeschosse.roemisch': roemisch(n.vollgeschosse.anzahl),
    'vollgeschosse.zulaessig': n.vollgeschosse.zulaessig ?? '',
    'vollgeschosse.status': STATUS[n.vollgeschosse.status].label,
    'vollgeschosse.namen': n.geschosse.filter((g) => g.vollgeschoss).map((g) => g.name).join(', '),
    'bilanz.gebaeude': r2(n.bilanz.gebaeude),
    'bilanz.vollversiegelt': r2(n.bilanz.voll),
    'bilanz.teilversiegelt': r2(n.bilanz.teil),
    'bilanz.gruen': r2(n.bilanz.gruen),
    'bilanz.summe': r2(n.bilanz.summe),
    'bilanz.differenz': opt(n.bilanz.differenz, r2),
    hinweise: n.hinweise.join('\n'),
    haftung: HAFTUNG,
  };

  const geschoss: Row[] = n.geschosse.map((g, i) => {
    const gf = n.gfJeGeschoss.find((x) => x.storeyId === g.storeyId);
    return {
      _id: g.storeyId,
      nr: i + 1,
      name: g.name,
      ueber_gelaende: r2(g.ueberGelaende),
      oberirdisch: g.oberirdisch ? 'ja' : '',
      anteil: g.oberirdisch ? r4(g.anteil) : '',
      anteil_soll: r4(g.anteilSoll),
      hoehe_soll: r2(g.hoeheSoll),
      flaeche_hoch: r2(g.flaecheHoch),
      bezugsflaeche: r2(g.bezugsflaeche),
      vollgeschoss: g.vollgeschoss ? 'ja' : '',
      ergebnis: g.vollgeschoss ? 'Vollgeschoss' : 'kein Vollgeschoss',
      festlegung: g.automatisch ? 'automatisch' : 'festgelegt',
      begruendung: g.begruendung,
      gf: r2(gf?.flaeche ?? 0),
      gf_art: gf ? GF_ART[gf.art] : '',
    };
  });

  const lageplan: Row[] = n.lageplan.map((l, i) => {
    const f = project.lageplan?.flaechen.find((x) => x.id === l.id);
    return {
      _anrechnung: l.anrechnung,
      _versiegelung: l.versiegelung,
      nr: i + 1,
      name: l.name,
      nutzung: nutzungLabel(l.nutzung),
      versiegelung: versiegelungInfo(l.versiegelung).label,
      flaeche: r2(l.flaeche),
      flaeche_aussen: r2(l.flaecheAussen),
      anrechnung: l.nachbar ? 'Nachbar' : ANRECHNUNG[l.anrechnung],
      nachbar: l.nachbar ? 'ja' : '',
      hoehe: f?.hoehe !== undefined ? r2(f.hoehe) : '',
    };
  });

  const vg = new Map(n.geschosse.map((g) => [g.storeyId, g.vollgeschoss]));
  const vor1990 = n.recht.baunvo !== '1990';
  let nr = 0;
  const raum: Row[] = project.storeys
    .filter((s) => vg.has(s.id))
    .flatMap((s) =>
      s.shapes
        .filter((r): r is RoomShape => r.kind === 'room' && !r.subtract)
        .map((r) => {
          const a = istAufenthaltsraum(r);
          return {
            _geschossId: s.id,
            _aufenthalt: a,
            // vor 1990 zählen Aufenthaltsräume in Nicht-Vollgeschossen zur Geschossfläche
            _gf: vor1990 && !vg.get(s.id) ? 'ja' : '',
            nr: ++nr,
            geschoss: s.name,
            vollgeschoss: vg.get(s.id) ? 'ja' : '',
            nummer: r.nummer,
            name: r.name,
            flaeche: r2(polygonArea(r.points)),
            aufenthalt: AUFENTHALT[a],
            festlegung: r.aufenthalt ? 'festgelegt' : 'automatisch',
          };
        }),
    );

  const hinweis: Row[] = n.hinweise.map((text, i) => ({ nr: i + 1, text }));

  return {
    scalars,
    collections: { geschoss, lageplan, raum, hinweis },
    byName: { geschoss: new Map(geschoss.map((g) => [String(g.name), g])) },
    filters: FILTERS,
    belongsTo: zugehoerig,
  };
}

/** Beschreibung aller Platzhalter – Grundlage für Hilfe-Tabelle und Musterdatei. */
export const GRZ_PLACEHOLDER_DOCS: PlaceholderDocs = [
  {
    group: 'Blöcke, Filter, Modifikatoren',
    keys: [
      ['#geschoss … /geschoss', 'Zeilenblock je Geschoss; raum-Zeilen darin nur für dieses Geschoss'],
      ['geschoss[vollgeschoss] / geschoss[!vollgeschoss] / [oberirdisch]', 'Filter: Vollgeschosse, Nicht-Vollgeschosse, oberirdische Geschosse'],
      ['lageplan[eigen] / lageplan[nachbar]', 'Filter: Flächen des eigenen Grundstücks bzw. der Nachbarn'],
      ['lageplan[zaehlt] / [grz2] / [pruefen]', 'Filter nach Anrechnung auf die Grundfläche'],
      ['lageplan[voll] / [teil] / [gruen]', 'Filter nach Versiegelung'],
      ['raum[aufenthalt]', 'Filter: Aufenthalts- und Treppenräume'],
      ['raum[gf]', 'Filter: Räume der Nicht-Vollgeschosse, deren Aufenthaltsräume vor 1990 zur Geschossfläche zählen'],
      ['[feld=wert] [!filter]', 'weitere Filter, mehrere mit Komma: raum[aufenthalt,vollgeschoss!=ja]'],
      ['…|einmal', 'Wert nur in der ersten Zeile der Wiederholung'],
    ],
  },
  PROJEKT_DOCS,
  {
    group: 'Grundlagen',
    keys: [
      ['bplan.datum', 'Datum des Bebauungsplans'],
      ['baunvo.fassung, bauo.fassung', 'angewandte BauNVO-Fassung und Vollgeschossbegriff'],
      ['recht.hinweise', 'Hinweise zur Wahl der Fassung'],
      ['grundstueck.flaeche_nachweis, grundstueck.quelle', 'maßgebende Grundstücksfläche [m²] und Herkunft'],
      ['gelaende, gelaende.quelle', 'Geländeoberfläche [m] über ±0,00 und Herkunft'],
      ['hauptanlage', 'Grundfläche der Hauptanlage [m²]'],
    ],
  },
  {
    group: 'Kennzahlen',
    keys: [
      ['grz.bezeichnung, grz.ii.bezeichnung', '„GRZ“ (vor 1990) bzw. „GRZ I“; „GRZ II (§ 19 Abs. 4)“ oder leer'],
      ['aufenthalt.titel', '„Aufenthaltsräume in Nicht-Vollgeschossen“ vor 1990, sonst leer'],
      ['grz, grz.zulaessig, grz.flaeche, grz.reserve, grz.status', 'GRZ, zulässig, angerechnete Grundfläche [m²], Reserve [m²], Ergebnis'],
      ['grz.mit_offenen', 'GRZ einschließlich der noch nicht eingestuften Flächen („prüfen“)'],
      ['grz.ii, grz.ii.zulaessig, grz.ii.flaeche, grz.ii.reserve, grz.ii.status, grz.ii.mit_offenen', 'GRZ II nach § 19 Abs. 4 BauNVO 1990 (sonst leer)'],
      ['garagen.frei', 'anrechnungsfreie Garagenfläche nach § 21a Abs. 3 (1968/1977) [m²]'],
      ['gf, gf.aufenthalt', 'Geschossfläche [m²]; davon Aufenthaltsräume in Nicht-Vollgeschossen'],
      ['gfz, gfz.zulaessig, gfz.reserve, gfz.status', 'GFZ, zulässig, Reserve [m²], Ergebnis'],
      ['vollgeschosse, vollgeschosse.roemisch, vollgeschosse.zulaessig, vollgeschosse.status', 'Zahl der Vollgeschosse'],
      ['vollgeschosse.namen', 'Namen der Vollgeschosse, mit Komma getrennt'],
      ['bilanz.gebaeude, bilanz.vollversiegelt, bilanz.teilversiegelt, bilanz.gruen, bilanz.summe', 'Flächenbilanz des Grundstücks [m²]'],
      ['bilanz.differenz', 'Grundstücksfläche − Summe (nicht erfasst bzw. überlappend) [m²]'],
      ['hinweise, haftung', 'alle Hinweise (eine Zelle); Haftungshinweis'],
    ],
  },
  {
    group: 'geschoss.* (Zeile je Geschoss) bzw. geschoss:NAME.*',
    keys: [
      ['geschoss.nr, geschoss.name', 'laufende Nummer, Bezeichnung'],
      ['geschoss.ueber_gelaende, geschoss.oberirdisch', 'Deckenoberkante über Gelände im Mittel [m]; „ja“ bei oberirdischen Geschossen'],
      ['geschoss.anteil, geschoss.anteil_soll, geschoss.hoehe_soll', 'Anteil mit der geforderten Höhe, geforderter Anteil, geforderte Höhe [m]'],
      ['geschoss.flaeche_hoch, geschoss.bezugsflaeche', 'Fläche mit der geforderten Höhe, Bezugsfläche [m²]'],
      ['geschoss.vollgeschoss, geschoss.ergebnis, geschoss.festlegung', '„ja“ bei Vollgeschossen; Ergebnis als Text; automatisch oder festgelegt'],
      ['geschoss.begruendung', 'Begründung der Vollgeschossprüfung'],
      ['geschoss.gf, geschoss.gf_art', 'Geschossfläche des Geschosses [m²] und wie sie ermittelt wurde'],
    ],
  },
  {
    group: 'lageplan.* (Zeile je Lageplan-Fläche)',
    keys: [
      ['lageplan.nr, lageplan.name, lageplan.nutzung, lageplan.versiegelung', 'laufende Nummer, Bezeichnung, Nutzung, Versiegelung'],
      ['lageplan.flaeche, lageplan.flaeche_aussen', 'Fläche und davon außerhalb des Gebäudes [m²]'],
      ['lageplan.anrechnung', 'Anrechnung auf die Grundfläche (zählt, GRZ II, bis 0,1 frei, zählt nicht, prüfen, Nachbar)'],
      ['lageplan.nachbar, lageplan.hoehe', '„ja“ bei Nachbargrundstücken; Höhe der Oberfläche [m]'],
    ],
  },
  {
    group: 'raum.* (Zeile je Raum) und hinweis.*',
    keys: [
      ['raum.nr, raum.geschoss, raum.nummer, raum.name, raum.flaeche', 'Raumangaben, Fläche ohne Putzabzug [m²]'],
      ['raum.vollgeschoss', '„ja“, wenn der Raum in einem Vollgeschoss liegt'],
      ['raum.aufenthalt, raum.festlegung', 'Aufenthaltsraum, Treppenraum oder kein Aufenthaltsraum; automatisch oder festgelegt'],
      ['hinweis.nr, hinweis.text', 'Zeile je Hinweis'],
    ],
  },
];
