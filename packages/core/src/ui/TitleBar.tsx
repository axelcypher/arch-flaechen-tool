import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isTauri } from '../platform/files';
import { getEntries, logger, logVersion, subscribe } from '../platform/log';
import { useTheme } from '../platform/theme';
import type { ThemeWahl } from '../platform/theme';

const log = logger('fenster');

type AppWindow = import('@tauri-apps/api/window').Window;

/**
 * Eigene Titelleiste (die Windows-Titelleiste ist ausgeblendet, decorations: false):
 * Ziehen zum Verschieben, Doppelklick maximiert, rechts Schema, Protokoll und Fensterknöpfe.
 * Im Browser ohne Fensterknöpfe.
 */
export interface TitleBarProps {
  /** Name der Anwendung, z. B. „Flächenrechner“ */
  app: string;
  /** Name des geöffneten Projekts */
  name: string;
  /** ungespeicherte Änderungen */
  dirty: boolean;
  onOpenLog: () => void;
}

export function TitleBar({ app, name, dirty, onOpenLog }: TitleBarProps) {
  const desktop = isTauri();
  const [win, setWin] = useState<AppWindow | null>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    let off: (() => void) | undefined;
    let alive = true;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      if (!alive) return;
      setWin(w);
      setMaximized(await w.isMaximized());
      off = await w.onResized(async () => setMaximized(await w.isMaximized()));
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [desktop]);

  // Fehler seit dem letzten Öffnen des Protokolls
  const version = useSyncExternalStore(subscribe, logVersion);
  const [seen, setSeen] = useState(0);
  const errors = getEntries().filter((e) => e.level === 'error' && e.id > seen).length;
  void version;

  const close = async () => {
    if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen und beenden?')) return;
    log.info('Fenster wird geschlossen');
    await win?.close();
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <img className="titlebar-icon" src="./favicon.svg" alt="" data-tauri-drag-region />
      <span className="titlebar-app" data-tauri-drag-region>
        {app}
      </span>
      <span className="titlebar-sep" data-tauri-drag-region>
        ·
      </span>
      <span className="titlebar-project" data-tauri-drag-region title={name}>
        {name}
        {dirty && <span className="titlebar-dirty" title="Ungespeicherte Änderungen"> ●</span>}
      </span>
      <span className="titlebar-drag" data-tauri-drag-region />
      <ThemeMenu />
      <button
        className="titlebar-btn"
        title="Protokoll (Fehlersuche)"
        onClick={() => {
          setSeen(getEntries().at(-1)?.id ?? 0);
          onOpenLog();
        }}
      >
        <span aria-hidden>≡</span> Protokoll
        {errors > 0 && <span className="titlebar-badge">{errors}</span>}
      </button>
      {desktop && win && (
        <div className="window-controls">
          <button className="wc-btn" title="Minimieren" aria-label="Minimieren" onClick={() => void win.minimize()}>
            <svg viewBox="0 0 10 10" aria-hidden>
              <path d="M0 5.5h10" />
            </svg>
          </button>
          <button className="wc-btn" title={maximized ? 'Verkleinern' : 'Maximieren'} aria-label="Maximieren" onClick={() => void win.toggleMaximize()}>
            {maximized ? (
              <svg viewBox="0 0 10 10" aria-hidden>
                <path d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z" />
              </svg>
            ) : (
              <svg viewBox="0 0 10 10" aria-hidden>
                <path d="M0.5 0.5h9v9h-9z" />
              </svg>
            )}
          </button>
          <button className="wc-btn wc-close" title="Schließen" aria-label="Schließen" onClick={() => void close()}>
            <svg viewBox="0 0 10 10" aria-hidden>
              <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
}

const WAHL: { id: ThemeWahl; label: string; icon: string }[] = [
  { id: 'system', label: 'wie System', icon: '◐' },
  { id: 'hell', label: 'Hell', icon: '☀' },
  { id: 'dunkel', label: 'Dunkel', icon: '☾' },
];

function ThemeMenu() {
  const { wahl, setWahl, canvasDunkel, setCanvasDunkel } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const cur = WAHL.find((w) => w.id === wahl)!;
  return (
    <div className="titlebar-menu" ref={ref}>
      <button className="titlebar-btn" title={`Farbschema: ${cur.label}`} onClick={() => setOpen(!open)}>
        <span aria-hidden>{cur.icon}</span>
      </button>
      {open && (
        <div className="titlebar-dropdown" role="menu">
          <div className="titlebar-dropdown-head">Farbschema</div>
          {WAHL.map((w) => (
            <button
              key={w.id}
              role="menuitemradio"
              aria-checked={wahl === w.id}
              className={wahl === w.id ? 'active' : ''}
              onClick={() => {
                setWahl(w.id);
                setOpen(false);
              }}
            >
              <span className="tb-icon">{w.icon}</span> {w.label}
            </button>
          ))}
          <label className="toggle block">
            <input type="checkbox" checked={canvasDunkel} onChange={(e) => setCanvasDunkel(e.target.checked)} />
            Zeichenfläche im dunklen Schema abdunkeln
          </label>
        </div>
      )}
    </div>
  );
}
