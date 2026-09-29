import type { ProjectResult, RS } from './calc';
import { fmtPlain } from './format';
import type { Project } from './model';
import { anschriftEinzeilig, flurText } from './model';
import { NUF_IDS, nutzungInfo, WOFL_KATEGORIEN } from './norms';

/**
 * CSV-Export der Flächenaufstellung. Semikolon als Trennzeichen und Dezimalkomma,
 * damit die Datei in einem deutschsprachigen Excel direkt korrekt geöffnet wird.
 */
export function projectToCsv(project: Project, result: ProjectResult): string {
  const rows: (string | number)[][] = [];
  const n = (v: number, d = 2) => fmtPlain(v, d);

  rows.push(['Projekt', project.name]);
  if (project.meta.projektcode) rows.push(['Projektcode', project.meta.projektcode]);
  const adresse = anschriftEinzeilig(project.meta.adresse);
  if (adresse) rows.push(['Adresse', adresse]);
  const flur = flurText(project.meta.grundstueck);
  if (flur) rows.push(['Grundstück', flur]);
  if (project.meta.grundstueck.flaeche) rows.push(['Grundstücksfläche [m²]', n(project.meta.grundstueck.flaeche)]);
  if (project.meta.bauherr.name) rows.push(['Bauherr', [project.meta.bauherr.name, anschriftEinzeilig(project.meta.bauherr.adresse)].filter(Boolean).join(', ')]);
  if (project.meta.bearbeiter) rows.push(['Bearbeiter', project.meta.bearbeiter]);
  rows.push([]);

  rows.push(['Flächen und Rauminhalte nach DIN 277']);
  rows.push(['Geschoss', 'Höhe [m]', 'BGF R [m²]', 'BGF S [m²]', 'BGF [m²]', 'BRI R [m³]', 'BRI S [m³]', 'BRI [m³]', 'NUF [m²]', 'TF [m²]', 'VF [m²]', 'NRF [m²]', 'KGF [m²]']);
  const line = (name: string, h: string, t: { bgf: RS; bri: RS; nuf: RS; tf: RS; vf: RS; nrf: RS; kgf: RS }) => [
    name,
    h,
    n(t.bgf.R),
    n(t.bgf.S),
    n(t.bgf.total),
    n(t.bri.R),
    n(t.bri.S),
    n(t.bri.total),
    n(t.nuf.total),
    n(t.tf.total),
    n(t.vf.total),
    n(t.nrf.total),
    n(t.kgf.total),
  ];
  for (const s of result.storeys) rows.push(line(s.name, n(s.hoehe), s));
  rows.push(line('Summe', '', result.total));
  rows.push([]);

  rows.push(['Netto-Raumfläche nach Nutzungsgruppen']);
  rows.push(['Geschoss', ...NUF_IDS.map((id) => nutzungInfo(id).kurz), 'TF 8', 'VF 9']);
  for (const s of result.storeys) rows.push([s.name, ...NUF_IDS.map((id) => n(s.nutzung[id])), n(s.nutzung.TF), n(s.nutzung.VF)]);
  rows.push(['Summe', ...NUF_IDS.map((id) => n(result.total.nutzung[id])), n(result.total.nutzung.TF), n(result.total.nutzung.VF)]);
  rows.push([]);

  rows.push(['Raumliste']);
  rows.push(['Geschoss', 'Nr.', 'Raum', 'Nutzungsgruppe', 'R/S', 'Fläche [m²]', 'WoFlV-Anrechnung', 'Faktor', 'Wohnfläche [m²]', 'Wohnung']);
  for (const s of result.storeys) {
    for (const r of s.rooms) {
      rows.push([
        r.storeyName,
        r.nummer,
        r.subtract ? `${r.name} (Abzug)` : r.name,
        nutzungInfo(r.nutzung).kurz,
        r.umschliessung,
        n(r.area),
        WOFL_KATEGORIEN.find((k) => k.id === r.woflKategorie)?.label ?? '',
        n(r.woflFaktor),
        n(r.woflArea),
        r.wohnung,
      ]);
    }
  }
  rows.push([]);

  rows.push(['Wohnflächen nach WoFlV']);
  rows.push(['Wohnung', 'Grundfläche [m²]', 'Wohnfläche [m²]']);
  for (const w of result.wohnungen) rows.push([w.wohnung, n(w.grundflaeche), n(w.wofl)]);
  rows.push(['Summe', '', n(result.total.wofl)]);

  // BOM, damit Excel UTF-8 erkennt (Umlaute, m²)
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
