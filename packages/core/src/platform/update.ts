import { create } from 'zustand';
import { isTauri } from './files';
import { logger } from './log';

/**
 * Automatische Updates der Desktop-Apps (Tauri-Updater). Jede App fragt ihr eigenes Manifest ab
 * (apps/<app>/src-tauri/tauri.conf.json → plugins.updater.endpoints); die Installer sind signiert und
 * werden vor der Installation gegen den öffentlichen Schlüssel der App geprüft.
 * Im Browser gibt es keine Updates – dort ist immer die ausgelieferte Version aktuell.
 */

const log = logger('update');

export type UpdateStatus = 'aus' | 'sucht' | 'aktuell' | 'verfuegbar' | 'laedt' | 'installiert' | 'fehler';

type Update = import('@tauri-apps/plugin-updater').Update;

interface UpdateState {
  status: UpdateStatus;
  /** verfügbare Version */
  version?: string;
  /** Beschreibung des Releases */
  notizen?: string;
  /** geladene Bytes und Gesamtgröße (falls der Server sie nennt) */
  geladen: number;
  gesamt?: number;
  fehler?: string;
  /** Sucht nach einem Update; `still`: Fehler (z. B. offline) nur protokollieren */
  suchen: (still?: boolean) => Promise<void>;
  /** Lädt das gefundene Update, installiert es und startet die Anwendung neu */
  installieren: () => Promise<void>;
}

let gefunden: Update | null = null;

const meldung = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useUpdate = create<UpdateState>()((set, get) => ({
  status: 'aus',
  geladen: 0,

  suchen: async (still = false) => {
    const { status } = get();
    if (!isTauri() || status === 'sucht' || status === 'laedt' || status === 'installiert') return;
    // ein bereits gefundenes Update bleibt bei der stillen Prüfung stehen
    if (still && status === 'verfuegbar') return;
    set({ status: 'sucht', fehler: undefined });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      gefunden = await check();
      if (gefunden) {
        log.info(`Update verfügbar: ${gefunden.version}`, { installiert: gefunden.currentVersion });
        set({ status: 'verfuegbar', version: gefunden.version, notizen: gefunden.body?.trim() || undefined });
      } else {
        log.debug('Kein Update verfügbar');
        set({ status: still ? 'aus' : 'aktuell', version: undefined, notizen: undefined });
      }
    } catch (e) {
      log.warn('Suche nach Updates fehlgeschlagen', meldung(e));
      set(still ? { status: 'aus' } : { status: 'fehler', fehler: meldung(e) });
    }
  },

  installieren: async () => {
    if (!gefunden || get().status !== 'verfuegbar') return;
    set({ status: 'laedt', geladen: 0, gesamt: undefined, fehler: undefined });
    try {
      await gefunden.downloadAndInstall((ev) => {
        if (ev.event === 'Started') set({ gesamt: ev.data.contentLength });
        else if (ev.event === 'Progress') set({ geladen: get().geladen + ev.data.chunkLength });
      });
      log.info(`Update ${gefunden.version} installiert – Neustart`);
      set({ status: 'installiert' });
      // unter Windows beendet der Installer die Anwendung selbst und startet sie neu
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      log.error('Update fehlgeschlagen', meldung(e));
      set({ status: 'fehler', fehler: meldung(e) });
    }
  },
}));

const ERSTE_PRUEFUNG = 5_000;
const INTERVALL = 6 * 60 * 60 * 1000;

/**
 * Prüft kurz nach dem Start und danach alle sechs Stunden still auf Updates.
 * Liefert eine Funktion zum Beenden. Im Browser und im Entwicklungsmodus passiert nichts.
 */
export function starteUpdatePruefung(): () => void {
  if (!isTauri() || import.meta.env?.DEV) return () => undefined;
  const pruefen = () => void useUpdate.getState().suchen(true);
  const erste = setTimeout(pruefen, ERSTE_PRUEFUNG);
  const laufend = setInterval(pruefen, INTERVALL);
  return () => {
    clearTimeout(erste);
    clearInterval(laufend);
  };
}
