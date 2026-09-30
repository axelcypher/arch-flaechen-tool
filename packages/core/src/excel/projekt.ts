import type { Project } from '../model';
import { anschriftEinzeilig, flurText, plzOrt } from '../model';
import type { PlaceholderDocs, Value } from './context';

/** alle Kontakte einer Art, mit Komma getrennt */
function kontakte(project: Project, art: 'email' | 'telefon'): string {
  return project.meta.bauherr.kontakte
    .filter((k) => k.art === art && k.wert.trim())
    .map((k) => k.wert.trim())
    .join(', ');
}

/** Projektangaben als Einzelwerte – in allen Apps gleich */
export function projektWerte(project: Project, date = new Date()): Record<string, Value> {
  return {
    'projekt.name': project.name,
    'projekt.code': project.meta.projektcode,
    'projekt.projektcode': project.meta.projektcode,
    'projekt.adresse': anschriftEinzeilig(project.meta.adresse),
    'projekt.strasse': project.meta.adresse.strasse,
    'projekt.plz': project.meta.adresse.plz,
    'projekt.ort': project.meta.adresse.ort,
    'projekt.plz_ort': plzOrt(project.meta.adresse),
    'projekt.bearbeiter': project.meta.bearbeiter,
    'grundstueck.gemarkung': project.meta.grundstueck.gemarkung,
    'grundstueck.flur': project.meta.grundstueck.flur,
    'grundstueck.flurstueck': project.meta.grundstueck.flurstueck,
    'grundstueck.flurtext': flurText(project.meta.grundstueck),
    'grundstueck.flaeche': project.meta.grundstueck.flaeche ?? '',
    'bauherr.name': project.meta.bauherr.name,
    'bauherr.adresse': anschriftEinzeilig(project.meta.bauherr.adresse),
    'bauherr.strasse': project.meta.bauherr.adresse.strasse,
    'bauherr.plz': project.meta.bauherr.adresse.plz,
    'bauherr.ort': project.meta.bauherr.adresse.ort,
    'bauherr.plz_ort': plzOrt(project.meta.bauherr.adresse),
    'bauherr.email': kontakte(project, 'email'),
    'bauherr.telefon': kontakte(project, 'telefon'),
    datum: date.toLocaleDateString('de-DE'),
  };
}

export const PROJEKT_DOCS: PlaceholderDocs[number] = {
  group: 'projekt / grundstueck / bauherr / datum',
  keys: [
    ['projekt.name', 'Projektbezeichnung'],
    ['projekt.code', 'Projektcode (auch projekt.projektcode)'],
    ['projekt.adresse', 'Adresse in einer Zeile: „Straße Nr., PLZ Ort“'],
    ['projekt.strasse, projekt.plz, projekt.ort, projekt.plz_ort', 'Adresse in Teilen'],
    ['projekt.bearbeiter', 'Bearbeiter'],
    ['grundstueck.gemarkung, grundstueck.flur, grundstueck.flurstueck', 'Grundstücksdaten'],
    ['grundstueck.flurtext', '„Gemarkung …, Flur …, Flurstück …“'],
    ['grundstueck.flaeche', 'Grundstücksfläche [m²] (Projektdaten)'],
    ['bauherr.name', 'Name des Bauherrn'],
    ['bauherr.adresse, bauherr.strasse, bauherr.plz, bauherr.ort, bauherr.plz_ort', 'Adresse des Bauherrn'],
    ['bauherr.email, bauherr.telefon', 'alle E-Mail-Adressen bzw. Telefonnummern, mit Komma getrennt'],
    ['datum', 'Datum des Exports'],
  ],
};
