import { useEffect, useState } from 'react';
import { starteUpdatePruefung, useUpdate } from '../platform/update';

const mb = (bytes: number) => (bytes / 1024 / 1024).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Knopf in der Titelleiste der Desktop-Apps: zeigt die installierte Version, sucht auf Klick nach Updates
 * und meldet ein gefundenes Update. Die Installation läuft über den Dialog.
 */
export function UpdateKnopf({ app, dirty }: { app: string; dirty: boolean }) {
  const status = useUpdate((s) => s.status);
  const version = useUpdate((s) => s.version);
  const [open, setOpen] = useState(false);

  useEffect(() => starteUpdatePruefung(), []);

  const verfuegbar = status === 'verfuegbar' || status === 'laedt' || status === 'installiert';
  return (
    <>
      <button
        className={`titlebar-btn${verfuegbar ? ' titlebar-update' : ''}`}
        title={verfuegbar ? `Version ${version} ist verfügbar – installiert ist ${__APP_VERSION__}` : `${app} ${__APP_VERSION__} – nach Updates suchen`}
        onClick={() => {
          setOpen(true);
          if (!verfuegbar) void useUpdate.getState().suchen();
        }}
      >
        {verfuegbar ? (
          <>
            <span aria-hidden>↑</span> Update {version}
          </>
        ) : (
          `v${__APP_VERSION__}`
        )}
      </button>
      {open && <UpdateDialog app={app} dirty={dirty} onClose={() => setOpen(false)} />}
    </>
  );
}

function UpdateDialog({ app, dirty, onClose }: { app: string; dirty: boolean; onClose: () => void }) {
  const { status, version, notizen, geladen, gesamt, fehler, suchen, installieren } = useUpdate();
  const laeuft = status === 'laedt' || status === 'installiert';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !laeuft && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, laeuft]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !laeuft && onClose()}>
      <div className="modal">
        <h3>{app} aktualisieren</h3>
        {status === 'sucht' && <p>Suche nach Updates …</p>}
        {(status === 'aktuell' || status === 'aus') && (
          <p>
            Version <strong>{__APP_VERSION__}</strong> ist aktuell.
          </p>
        )}
        {status === 'verfuegbar' && (
          <>
            <p>
              Version <strong>{version}</strong> ist verfügbar (installiert: {__APP_VERSION__}).
            </p>
            {notizen && <pre className="update-notizen">{notizen}</pre>}
            {dirty && <p className="warning">Es gibt ungespeicherte Änderungen. Bitte vorher speichern – die Anwendung wird für das Update beendet und neu gestartet.</p>}
          </>
        )}
        {status === 'laedt' && (
          <>
            <p>
              Version {version} wird geladen … {mb(geladen)}
              {gesamt ? ` von ${mb(gesamt)}` : ''} MB
            </p>
            <progress className="update-fortschritt" max={gesamt || undefined} value={gesamt ? Math.min(geladen, gesamt) : undefined} />
          </>
        )}
        {status === 'installiert' && <p>Version {version} ist installiert – die Anwendung wird neu gestartet …</p>}
        {status === 'fehler' && (
          <p className="warning">
            Das Update konnte nicht geladen werden: {fehler}
            <br />
            Die Installer stehen auch auf der Release-Seite bereit.
          </p>
        )}
        <div className="dialog-buttons">
          {!laeuft && <button onClick={onClose}>{status === 'verfuegbar' ? 'Später' : 'Schließen'}</button>}
          {status === 'fehler' && <button onClick={() => void suchen()}>Erneut suchen</button>}
          {status === 'verfuegbar' && (
            <button className="primary" onClick={() => void installieren()}>
              Jetzt installieren
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
