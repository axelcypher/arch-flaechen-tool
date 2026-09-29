import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { isTauri, saveTextFile } from '../platform/files';
import type { LogLevel } from '../platform/log';
import { clearLog, formatTime, getEntries, isDebugEnabled, levelRank, logText, logVersion, setDebugEnabled, subscribe } from '../platform/log';

const FILTER: { id: LogLevel; label: string }[] = [
  { id: 'debug', label: 'Alles' },
  { id: 'info', label: 'Info' },
  { id: 'warn', label: 'Warnungen' },
  { id: 'error', label: 'Fehler' },
];

/** Protokoll-Fenster: Einträge filtern, kopieren, als Datei speichern */
export function LogDialog({ onClose }: { onClose: () => void }) {
  const version = useSyncExternalStore(subscribe, logVersion);
  const [min, setMin] = useState<LogLevel>('info');
  const [q, setQ] = useState('');
  const [logDir, setLogDir] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState('');

  useEffect(() => {
    if (!isTauri()) return;
    void import('@tauri-apps/api/path').then((p) => p.appLogDir()).then(setLogDir, () => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return getEntries().filter(
      (e) => levelRank(e.level) >= levelRank(min) && (!s || `${e.scope} ${e.message} ${e.data ?? ''}`.toLowerCase().includes(s)),
    );
    // version: neu filtern, sobald Einträge hinzukommen
  }, [min, q, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logText(list));
      setHinweis('In die Zwischenablage kopiert.');
    } catch {
      setHinweis('Kopieren nicht möglich – bitte „Speichern …“ verwenden.');
    }
  };

  const save = async () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    await saveTextFile({
      defaultName: `flaechenrechner-protokoll_${stamp}.log`,
      contents: `Flächenrechner ${__APP_VERSION__} · ${navigator.userAgent}\n\n${logText()}\n`,
      filterName: 'Protokoll',
      extension: 'log',
      mime: 'text/plain;charset=utf-8',
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-log" role="dialog" aria-label="Protokoll">
        <div className="log-head">
          <h3>Protokoll</h3>
          <div className="button-row">
            {FILTER.map((f) => (
              <button key={f.id} className={min === f.id ? 'active' : ''} onClick={() => setMin(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <input className="log-search" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="log-list" role="log">
          {list.length === 0 && <p className="muted">Keine Einträge.</p>}
          {list.map((e) => (
            <div key={e.id} className={`log-entry log-${e.level}`}>
              <span className="log-time">{formatTime(e.time)}</span>
              <span className="log-level">{e.level.toUpperCase()}</span>
              <span className="log-scope">{e.scope}</span>
              <span className="log-msg">
                {e.message}
                {e.data && <pre className="log-data">{e.data}</pre>}
              </span>
            </div>
          ))}
        </div>
        <label className="toggle block">
          <input type="checkbox" checked={isDebugEnabled()} onChange={(e) => setDebugEnabled(e.target.checked)} />
          Debug-Meldungen aufzeichnen (ausführlicher, für die Fehlersuche)
        </label>
        {logDir && (
          <p className="muted small-text">
            Logdatei: <code>{logDir}</code>
          </p>
        )}
        {hinweis && <p className="muted small-text">{hinweis}</p>}
        <div className="button-row log-actions">
          <button onClick={() => void copy()}>Kopieren</button>
          <button onClick={() => void save()}>Speichern …</button>
          <button onClick={clearLog}>Leeren</button>
          <span className="tb-spacer" />
          <button className="primary" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
