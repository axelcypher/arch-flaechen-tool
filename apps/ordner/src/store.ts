import { create } from 'zustand';
import type { Stammdaten } from './stammdaten';
import { leereStammdaten } from './stammdaten';
import type { Struktur } from './struktur';
import { STANDARD, strukturAusJson } from './struktur';

/**
 * Zustand des Tools: die Stammdaten des Projekts, das gerade angelegt wird, die Struktur (Konfiguration)
 * und die zuletzt gewählten Ordner. Alles bleibt im Browserspeicher der Anwendung erhalten.
 */

const KEY = 'projektordner:zustand';

interface Gespeichert {
  stamm: Stammdaten;
  struktur: Struktur;
  stammordner: string;
  vorlagenordner: string;
}

interface OrdnerState extends Gespeichert {
  setStamm: (patch: Partial<Stammdaten>) => void;
  setStruktur: (s: Struktur) => void;
  setStammordner: (p: string) => void;
  setVorlagenordner: (p: string) => void;
  /** Formular für das nächste Projekt leeren; Bearbeiter bleibt */
  neuesProjekt: () => void;
}

function lade(): Gespeichert {
  const vorgabe: Gespeichert = { stamm: leereStammdaten(), struktur: STANDARD, stammordner: '', vorlagenordner: '' };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return vorgabe;
    const o = JSON.parse(raw) as Partial<Gespeichert>;
    return {
      stamm: { ...leereStammdaten(), ...(o.stamm ?? {}) },
      struktur: o.struktur ? strukturAusJson(JSON.stringify(o.struktur)) : STANDARD,
      stammordner: typeof o.stammordner === 'string' ? o.stammordner : '',
      vorlagenordner: typeof o.vorlagenordner === 'string' ? o.vorlagenordner : '',
    };
  } catch {
    return vorgabe;
  }
}

export const useOrdner = create<OrdnerState>()((set, get) => ({
  ...lade(),
  setStamm: (patch) => set({ stamm: { ...get().stamm, ...patch } }),
  setStruktur: (struktur) => set({ struktur }),
  setStammordner: (stammordner) => set({ stammordner }),
  setVorlagenordner: (vorlagenordner) => set({ vorlagenordner }),
  neuesProjekt: () => set({ stamm: { ...leereStammdaten(), bearbeiter: get().stamm.bearbeiter } }),
}));

useOrdner.subscribe((s) => {
  try {
    const g: Gespeichert = { stamm: s.stamm, struktur: s.struktur, stammordner: s.stammordner, vorlagenordner: s.vorlagenordner };
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    // ohne Speicher gilt der Zustand nur bis zum Schließen
  }
});
