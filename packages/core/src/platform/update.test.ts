import { beforeEach, describe, expect, it, vi } from 'vitest';

type Fortschritt = { event: 'Started'; data: { contentLength?: number } } | { event: 'Progress'; data: { chunkLength: number } } | { event: 'Finished' };

const { check, relaunch } = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }));

const { starteUpdatePruefung, useUpdate } = await import('./update');

const desktop = (an: boolean) => {
  if (an) (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
  else delete (globalThis as { window?: unknown }).window;
};

const update = (downloadAndInstall: (onEvent: (e: Fortschritt) => void) => Promise<void> = vi.fn(async () => undefined)) => ({
  version: '1.2.0',
  currentVersion: '1.1.0',
  body: ' Neues Werkzeug \n',
  downloadAndInstall,
});

beforeEach(() => {
  check.mockReset();
  relaunch.mockClear();
  useUpdate.setState({ status: 'aus', version: undefined, notizen: undefined, geladen: 0, gesamt: undefined, fehler: undefined });
  desktop(true);
});

describe('Updates', () => {
  it('im Browser wird nicht gesucht', async () => {
    desktop(false);
    await useUpdate.getState().suchen();
    expect(check).not.toHaveBeenCalled();
    expect(useUpdate.getState().status).toBe('aus');
    expect(starteUpdatePruefung()).toBeTypeOf('function');
  });

  it('meldet ein gefundenes Update mit Version und Beschreibung', async () => {
    check.mockResolvedValue(update());
    await useUpdate.getState().suchen();
    expect(useUpdate.getState()).toMatchObject({ status: 'verfuegbar', version: '1.2.0', notizen: 'Neues Werkzeug' });
    // die stille Prüfung lässt ein gefundenes Update stehen
    await useUpdate.getState().suchen(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('ohne Update: von Hand „aktuell“, still ohne Meldung', async () => {
    check.mockResolvedValue(null);
    await useUpdate.getState().suchen();
    expect(useUpdate.getState().status).toBe('aktuell');
    await useUpdate.getState().suchen(true);
    expect(useUpdate.getState().status).toBe('aus');
  });

  it('Fehler bei der Suche: still ohne Meldung, von Hand mit Fehlertext', async () => {
    check.mockRejectedValue(new Error('offline'));
    await useUpdate.getState().suchen(true);
    expect(useUpdate.getState()).toMatchObject({ status: 'aus', fehler: undefined });
    await useUpdate.getState().suchen();
    expect(useUpdate.getState()).toMatchObject({ status: 'fehler', fehler: 'offline' });
  });

  it('Suche von Hand während der stillen Prüfung: deren Ergebnis wird gemeldet', async () => {
    let fertig!: (v: null) => void;
    check.mockReturnValue(new Promise((r) => (fertig = r)));
    const still = useUpdate.getState().suchen(true);
    await Promise.resolve();
    expect(useUpdate.getState().status).toBe('sucht');
    await useUpdate.getState().suchen(); // kehrt sofort zurück, startet keine zweite Anfrage
    fertig(null);
    await still;
    expect(check).toHaveBeenCalledTimes(1);
    expect(useUpdate.getState().status).toBe('aktuell');
  });

  it('Zeitgrenze: eine hängende Anfrage endet mit einer Meldung statt endloser Suche', async () => {
    vi.useFakeTimers();
    try {
      check.mockReturnValue(new Promise(() => undefined));
      const suche = useUpdate.getState().suchen();
      await vi.advanceTimersByTimeAsync(31_000);
      await suche;
      expect(check).toHaveBeenCalledWith({ timeout: 20_000 });
      expect(useUpdate.getState()).toMatchObject({ status: 'fehler', fehler: 'keine Antwort nach 30 s' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lädt mit Fortschritt, installiert und startet neu', async () => {
    const schritte: [number, number | undefined][] = [];
    const laden = vi.fn(async (onEvent: (e: Fortschritt) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 300 } });
      onEvent({ event: 'Progress', data: { chunkLength: 100 } });
      onEvent({ event: 'Progress', data: { chunkLength: 200 } });
      schritte.push([useUpdate.getState().geladen, useUpdate.getState().gesamt]);
      expect(useUpdate.getState().status).toBe('laedt');
      onEvent({ event: 'Finished' });
    });
    check.mockResolvedValue(update(laden));
    await useUpdate.getState().installieren();
    expect(laden).not.toHaveBeenCalled(); // ohne gefundenes Update passiert nichts
    await useUpdate.getState().suchen();
    await useUpdate.getState().installieren();
    expect(schritte).toEqual([[300, 300]]);
    expect(useUpdate.getState().status).toBe('installiert');
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it('Fehler beim Laden: Meldung, kein Neustart', async () => {
    check.mockResolvedValue(
      update(
        vi.fn(async () => {
          throw new Error('Signatur ungültig');
        }),
      ),
    );
    await useUpdate.getState().suchen();
    await useUpdate.getState().installieren();
    expect(useUpdate.getState()).toMatchObject({ status: 'fehler', fehler: 'Signatur ungültig' });
    expect(relaunch).not.toHaveBeenCalled();
  });
});
