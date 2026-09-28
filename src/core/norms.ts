import type { Nutzungsgruppe, ProjectSettings, Raumumschliessung, WoflAngaben, WoflKategorie } from './model';

/** Nutzungsgruppen der Netto-Raumfläche nach DIN 277 (Tabelle 1). */
export const NUTZUNGSGRUPPEN: { id: Nutzungsgruppe; kurz: string; label: string; bereich: 'NUF' | 'TF' | 'VF'; color: string }[] = [
  { id: 'NUF1', kurz: 'NUF 1', label: 'Wohnen und Aufenthalt', bereich: 'NUF', color: '#f4c95d' },
  { id: 'NUF2', kurz: 'NUF 2', label: 'Büroarbeit', bereich: 'NUF', color: '#8ecae6' },
  { id: 'NUF3', kurz: 'NUF 3', label: 'Produktion, Hand- und Maschinenarbeit, Forschung und Entwicklung', bereich: 'NUF', color: '#b5838d' },
  { id: 'NUF4', kurz: 'NUF 4', label: 'Lagern, Verteilen und Verkaufen', bereich: 'NUF', color: '#cdb4db' },
  { id: 'NUF5', kurz: 'NUF 5', label: 'Bildung, Unterricht und Kultur', bereich: 'NUF', color: '#90be6d' },
  { id: 'NUF6', kurz: 'NUF 6', label: 'Heilen und Pflegen', bereich: 'NUF', color: '#f28482' },
  { id: 'NUF7', kurz: 'NUF 7', label: 'Sonstige Nutzungen', bereich: 'NUF', color: '#e9c46a' },
  { id: 'TF', kurz: 'TF 8', label: 'Technische Anlagen', bereich: 'TF', color: '#a8a8a8' },
  { id: 'VF', kurz: 'VF 9', label: 'Verkehrserschließung und -sicherung', bereich: 'VF', color: '#f5a65b' },
];

export const NUF_IDS: Nutzungsgruppe[] = ['NUF1', 'NUF2', 'NUF3', 'NUF4', 'NUF5', 'NUF6', 'NUF7'];

export function nutzungInfo(id: Nutzungsgruppe) {
  return NUTZUNGSGRUPPEN.find((n) => n.id === id) ?? NUTZUNGSGRUPPEN[0];
}

export const UMSCHLIESSUNG: { id: Raumumschliessung; label: string }[] = [
  { id: 'R', label: 'R – Regelfall (allseitig umschlossen, überdeckt)' },
  { id: 'S', label: 'S – Sonderfall (z. B. Balkon, Loggia, Terrasse)' },
];

export const WOFL_KATEGORIEN: { id: WoflKategorie; label: string; faktor: number | null }[] = [
  { id: 'keine', label: 'keine Wohnfläche', faktor: 0 },
  { id: 'voll', label: 'lichte Höhe ≥ 2 m (100 %)', faktor: 1 },
  { id: 'halb', label: 'lichte Höhe 1–2 m (50 %)', faktor: 0.5 },
  { id: 'null', label: 'lichte Höhe < 1 m (0 %)', faktor: 0 },
  { id: 'wintergarten', label: 'unbeheizter Wintergarten / Schwimmbad (50 %)', faktor: 0.5 },
  { id: 'freisitz', label: 'Balkon, Loggia, Dachgarten, Terrasse (25–50 %)', faktor: null },
  { id: 'individuell', label: 'individueller Faktor', faktor: null },
];

/** Anrechnungsfaktor nach WoFlV § 4 für einen Raum. */
export function woflFaktor(w: WoflAngaben, settings: ProjectSettings): number {
  switch (w.kategorie) {
    case 'keine':
    case 'null':
      return 0;
    case 'voll':
      return 1;
    case 'halb':
    case 'wintergarten':
      return 0.5;
    case 'freisitz': {
      // WoFlV: "in der Regel zu einem Viertel, höchstens jedoch zur Hälfte"
      const f = w.faktor ?? settings.freisitzFaktor;
      return clamp(f, 0, 0.5);
    }
    case 'individuell':
      return clamp(w.faktor ?? 1, 0, 1);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
