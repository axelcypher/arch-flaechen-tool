import type { ExportContext, PlaceholderDocs, Row, Value } from '@core/excel/context';
import { PROJEKT_DOCS, projektWerte } from '@core/excel/projekt';
import type { Project } from '@core/model';
import { KOSTEN_STUFEN } from '@core/model';
import { kg1, kgName } from '../din276';
import type { Ergebnis } from '../kosten';
import { berechne, bezugLabel, HAFTUNG, katalogText, stufeLabel } from '../kosten';
import { MENGEN_BEZUEGE, MENGEN_INFO } from '../mengen';

/**
 * Datengrundlage für Excel-Export und Vorlagen der Kostenermittlung (Syntax siehe docs/excel-vorlagen.md).
 *
 *   {{gesamt.brutto}}                       Einzelwert
 *   {{#kg}} … {{/kg}}                       Zeilenblock je Kostengruppe der 1. Ebene
 *   {{position[aktiv].kosten}}              Zeile je Position – im Block nur die der Kostengruppe
 *   {{mengen.bgf}} / {{menge.label}}        Einzelwert bzw. Zeile je Menge
 */

const r0 = (v: number) => Math.round(v);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

function zugehoerig(child: string, row: Row, parent: string, p: Row): boolean {
  if (parent === 'kg' && (child === 'position' || child === 'kg2')) return row._kg1 === p.kg;
  if (parent === 'kg2' && child === 'position') return row._kg2 === p.kg;
  return true;
}

const FILTERS: Record<string, (r: Row) => boolean> = {
  aktiv: (r) => r.aktiv === 'ja',
  aus: (r) => r.aktiv !== 'ja',
  festgelegt: (r) => r.festgelegt === 'ja',
};

export function buildKostenContext(project: Project, date = new Date(), e: Ergebnis = berechne(project)): ExportContext {
  const k = project.kosten;
  const stufe = KOSTEN_STUFEN.find((s) => s.id === (k?.stufe ?? 'schaetzung'));
  const spanne = (name: string, s: [number, number, number]): Record<string, Value> => ({ [name]: r0(s[1]), [`${name}.von`]: r0(s[0]), [`${name}.bis`]: r0(s[2]) });
  const scalars: Record<string, Value> = {
    ...projektWerte(project, date),
    stufe: stufeLabel(k?.stufe ?? 'schaetzung'),
    'stufe.lph': stufe?.lph ?? '',
    preisstand: k?.datum ? new Date(k.datum).toLocaleDateString('de-DE') : '',
    katalog: katalogText(k?.katalog),
    'katalog.name': k?.katalog?.name ?? '',
    'katalog.quelle': k?.katalog?.quelle ?? '',
    'katalog.stand': k?.katalog?.stand ?? '',
    'index.basis': k?.indexBasis ?? '',
    'index.aktuell': k?.indexAktuell ?? '',
    regionalfaktor: k?.regionalfaktor ?? 1,
    faktor: r4(e.faktor),
    mwst: e.mwst,
    ...spanne('gesamt.netto', e.gesamtNetto),
    ...spanne('gesamt.brutto', e.gesamtBrutto),
    'gesamt.mwst': r0(e.gesamtBrutto[1] - e.gesamtNetto[1]),
    hinweise: e.hinweise.join('\n'),
    haftung: HAFTUNG,
  };
  for (const b of MENGEN_BEZUEGE) scalars[`mengen.${b}`] = e.mengen[b].wert;
  // Kennwerte ohne Bezugsmenge bleiben leer (statt als unbekannter Platzhalter stehen zu bleiben)
  for (const b of ['bgf', 'bri', 'nuf', 'wofl']) {
    const kw = e.kennwerte.find((x) => x.kurz.toLowerCase() === b);
    const key = `kennwert.${b}`;
    scalars[key] = kw ? r0(kw.wert[1]) : '';
    scalars[`${key}.von`] = kw ? r0(kw.wert[0]) : '';
    scalars[`${key}.bis`] = kw ? r0(kw.wert[2]) : '';
  }
  for (const s of e.summen) Object.assign(scalars, spanne(`kg${s.kg}`, s.summe));

  const kg: Row[] = e.summen.filter((s) => s.ebene === 1).map((s) => ({ kg: s.kg, name: s.name, von: r0(s.summe[0]), mittel: r0(s.summe[1]), bis: r0(s.summe[2]) }));
  const kg2: Row[] = e.summen
    .filter((s) => s.ebene === 2)
    .map((s) => ({ _kg1: kg1(s.kg), kg: s.kg, name: s.name, von: r0(s.summe[0]), mittel: r0(s.summe[1]), bis: r0(s.summe[2]) }));
  const position: Row[] = e.positionen.map((x, i) => ({
    _kg1: kg1(x.pos.kg),
    _kg2: x.pos.kg[1] !== '0' ? `${x.pos.kg.slice(0, 2)}0` : '',
    nr: i + 1,
    kg: x.pos.kg,
    kg_name: kgName(x.pos.kg),
    bezeichnung: x.pos.bezeichnung,
    bezug: bezugLabel(x.pos),
    menge: x.pos.bezug === 'prozent' ? r0(x.menge) : r2(x.menge),
    einheit: x.pos.bezug === 'prozent' ? '€' : x.einheit,
    kennwert: r2(x.kennwert[1]),
    kennwert_von: r2(x.kennwert[0]),
    kennwert_bis: r2(x.kennwert[2]),
    kosten: r0(x.kosten[1]),
    kosten_von: r0(x.kosten[0]),
    kosten_bis: r0(x.kosten[2]),
    aktiv: x.aktiv ? 'ja' : '',
    quelle: x.pos.quelle ?? '',
    bemerkung: x.pos.bemerkung ?? '',
    hinweis: x.hinweis ?? '',
  }));
  const menge: Row[] = MENGEN_BEZUEGE.map((b) => ({
    kurz: MENGEN_INFO[b].kurz,
    label: MENGEN_INFO[b].label,
    wert: e.mengen[b].wert,
    einheit: MENGEN_INFO[b].einheit,
    ermittlung: e.mengen[b].festgelegt ? 'festgelegt' : MENGEN_INFO[b].ermittlung,
    festgelegt: e.mengen[b].festgelegt ? 'ja' : '',
  }));
  const stand: Row[] = (k?.staende ?? []).map((s, i) => ({
    nr: i + 1,
    datum: new Date(s.datum).toLocaleDateString('de-DE'),
    stufe: stufeLabel(s.stufe),
    bemerkung: s.bemerkung,
    netto: r0(s.gesamtNetto[1]),
    brutto: r0(s.gesamtBrutto[1]),
    brutto_von: r0(s.gesamtBrutto[0]),
    brutto_bis: r0(s.gesamtBrutto[2]),
  }));
  const hinweis: Row[] = e.hinweise.map((text, i) => ({ nr: i + 1, text }));

  return {
    scalars,
    collections: { kg, kg2, position, menge, stand, hinweis },
    byName: { kg: new Map(kg.map((r) => [String(r.kg), r])) },
    filters: FILTERS,
    belongsTo: zugehoerig,
  };
}

export const KOSTEN_PLACEHOLDER_DOCS: PlaceholderDocs = [
  {
    group: 'Blöcke, Filter, Modifikatoren',
    keys: [
      ['#kg … /kg', 'Zeilenblock je Kostengruppe der 1. Ebene; position- und kg2-Zeilen darin nur für diese Kostengruppe'],
      ['#kg2 … /kg2', 'Zeilenblock je Kostengruppe der 2. Ebene (auch innerhalb von #kg)'],
      ['position[aktiv] / position[aus]', 'Filter: gerechnete bzw. ausgeschaltete Positionen'],
      ['menge[festgelegt]', 'Filter: von Hand festgelegte Mengen'],
      ['[feld=wert] [!filter]', 'weitere Filter, z. B. position[aktiv,kg=330]'],
      ['…|einmal', 'Wert nur in der ersten Zeile der Wiederholung'],
    ],
  },
  PROJEKT_DOCS,
  {
    group: 'Grundlagen und Ergebnis',
    keys: [
      ['stufe, stufe.lph, preisstand', 'Stufe der Kostenermittlung (z. B. Kostenschätzung), Leistungsphase, Preisstand'],
      ['katalog, katalog.name, katalog.quelle, katalog.stand', 'Herkunft der Kennwerte: in einer Zeile bzw. in Teilen'],
      ['index.basis, index.aktuell, regionalfaktor, faktor', 'Baupreisindex, Regionalfaktor und daraus der Faktor auf die Kennwerte'],
      ['gesamt.netto, gesamt.brutto, gesamt.mwst, mwst', 'Gesamtkosten (Mittel) netto/brutto, Umsatzsteuer in € bzw. %'],
      ['gesamt.netto.von, gesamt.netto.bis, gesamt.brutto.von, gesamt.brutto.bis', 'Bandbreite'],
      ['kg300, kg300.von, kg300.bis, kg330 …', 'Summe einer Kostengruppe (1. und 2. Ebene, netto)'],
      ['kg:300.mittel', 'dasselbe über das Nachschlagen per Name (Felder wie kg.*)'],
      ['kennwert.bgf, kennwert.bri, kennwert.nuf, kennwert.wofl (+ .von/.bis)', 'Bauwerkskosten KG 300 + 400 brutto je Einheit'],
      ['mengen.bgf, mengen.bri, mengen.awf, mengen.daf …', 'Mengen als Einzelwert (auch nrf, nuf, tf, vf, wofl, grf, bgi, iwf, def, auf, fbg, we)'],
      ['hinweise, haftung', 'alle Hinweise in einer Zelle; Hinweis zur Herkunft der Kennwerte'],
    ],
  },
  {
    group: 'kg.* / kg2.* (Zeile je Kostengruppe)',
    keys: [
      ['kg.kg, kg.name', 'Kostengruppe und Bezeichnung nach DIN 276'],
      ['kg.von, kg.mittel, kg.bis', 'Summe netto'],
    ],
  },
  {
    group: 'position.* (Zeile je Position)',
    keys: [
      ['position.nr, position.kg, position.kg_name, position.bezeichnung', 'laufende Nummer, Kostengruppe, deren Name, Bezeichnung der Position'],
      ['position.bezug, position.menge, position.einheit', 'Bezugsgröße (z. B. „m² BGF“, „% von KG 300 + 400“), Menge und Einheit (bei % die Grundlage in €)'],
      ['position.kennwert, position.kennwert_von, position.kennwert_bis', 'Kennwert netto nach Faktor (bei % der Prozentsatz)'],
      ['position.kosten, position.kosten_von, position.kosten_bis', 'Kosten netto'],
      ['position.aktiv, position.quelle, position.bemerkung, position.hinweis', '„ja“, wenn gerechnet; Herkunft des Kennwerts; Bemerkung; Hinweis (fehlende Menge …)'],
    ],
  },
  {
    group: 'menge.* / stand.* / hinweis.*',
    keys: [
      ['menge.kurz, menge.label, menge.wert, menge.einheit, menge.ermittlung, menge.festgelegt', 'Zeile je Menge'],
      ['stand.datum, stand.stufe, stand.bemerkung, stand.netto, stand.brutto, stand.brutto_von, stand.brutto_bis', 'Zeile je festgehaltenem Kostenstand'],
      ['hinweis.nr, hinweis.text', 'Zeile je Hinweis'],
    ],
  },
];
