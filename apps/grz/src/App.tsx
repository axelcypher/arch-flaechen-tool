import { useEffect, useState } from 'react';
import { isTauri } from '@core/platform/files';
import { logger } from '@core/platform/log';
import { LogDialog } from '@core/ui/LogDialog';
import { TitleBar } from '@core/ui/TitleBar';
import { GrzGfzView } from './components/GrzGfzView';
import { oeffnen, speichern } from './datei';
import { useGrz } from './store';

const log = logger('app');

export function App() {
  const name = useGrz((s) => s.project.name);
  const dirty = useGrz((s) => s.dirty);
  const hatGebaeude = useGrz((s) => s.project.storeys.some((st) => st.shapes.some((x) => x.kind === 'outline')));
  const canUndo = useGrz((s) => s.past.length > 0);
  const canRedo = useGrz((s) => s.future.length > 0);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [bericht, setBericht] = useState<string[]>([]);

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${name} – GRZ-Nachweis`;
  }, [name, dirty]);

  const onOpen = async () => {
    if (useGrz.getState().dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
    try {
      const r = await oeffnen(setBusy);
      if (r) {
        useGrz.getState().load(r.project, r.datei);
        setBericht(r.bericht);
      }
    } catch (e) {
      log.error('Öffnen fehlgeschlagen', e instanceof Error ? e.message : String(e));
      alert(`Datei konnte nicht geöffnet werden: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    const { project, datei } = useGrz.getState();
    try {
      const saved = await speichern(project, datei);
      if (saved) useGrz.getState().markSaved(saved);
    } catch (e) {
      log.error('Speichern fehlgeschlagen', e instanceof Error ? e.message : String(e));
      alert(`Speichern fehlgeschlagen: ${String(e)}`);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void onSave();
      } else if (k === 'o') {
        e.preventDefault();
        void onOpen();
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useGrz.getState().undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        useGrz.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useGrz.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="app">
      <TitleBar app="GRZ-Nachweis" name={name} dirty={dirty} onOpenLog={() => setLogOpen(true)} />
      <div className="toolbar">
        <div className="tb-group">
          <button onClick={onOpen} title="Projekt des Flächenrechners (.oap/.akhp) oder IFC-Modell öffnen (Strg+O)">
            Öffnen
          </button>
          <button onClick={onSave} title={isTauri() ? 'Projekt speichern (Strg+S)' : 'Projekt als Datei herunterladen (Strg+S)'}>
            Speichern{dirty ? ' •' : ''}
          </button>
        </div>
        <div className="tb-group">
          <button onClick={() => useGrz.getState().undo()} disabled={!canUndo} title="Rückgängig (Strg+Z)">
            ↶
          </button>
          <button onClick={() => useGrz.getState().redo()} disabled={!canRedo} title="Wiederholen (Strg+Y)">
            ↷
          </button>
        </div>
        {busy && <span className="busy">{busy}</span>}
      </div>
      <main className="grz-main">
        {bericht.length > 0 && (
          <div className="grz-bericht">
            <strong>IFC-Import:</strong>
            <ul>
              {bericht.map((z, i) => (
                <li key={i}>{z}</li>
              ))}
            </ul>
            <button className="small" onClick={() => setBericht([])}>
              Schließen
            </button>
          </div>
        )}
        {!hatGebaeude && (
          <div className="grz-leer">
            <h2>GRZ-Nachweis</h2>
            <p>
              Ein Projekt des Flächenrechners (<code>.oap</code>/<code>.akhp</code>) oder direkt ein IFC-Modell öffnen. Gebäudeumrisse, Geschosse und Geschossflächen kommen aus
              dem Projekt, den Lageplan pflegt dieses Tool; gespeichert wird in dieselbe Projektdatei.
            </p>
            <button className="primary" onClick={onOpen}>
              Projekt oder IFC öffnen …
            </button>
          </div>
        )}
        <GrzGfzView />
      </main>
      {logOpen && <LogDialog onClose={() => setLogOpen(false)} />}
    </div>
  );
}
