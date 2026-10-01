import { useEffect, useState } from 'react';
import { isTauri } from '@core/platform/files';
import { logger } from '@core/platform/log';
import { LogDialog } from '@core/ui/LogDialog';
import { TitleBar } from '@core/ui/TitleBar';
import { ExcelDialog } from './components/ExcelDialog';
import { KatalogDialog } from './components/KatalogDialog';
import { KostenDruck } from './components/KostenDruck';
import { KostenView } from './components/KostenView';
import { oeffnen, speichern } from './datei';
import { useKosten } from './store';

const log = logger('app');

export function App() {
  const name = useKosten((s) => s.project.name);
  const dirty = useKosten((s) => s.dirty);
  const hatGebaeude = useKosten((s) => s.project.storeys.some((st) => st.shapes.some((x) => x.kind === 'outline')));
  const hatPositionen = useKosten((s) => (s.project.kosten?.positionen.length ?? 0) > 0);
  const canUndo = useKosten((s) => s.past.length > 0);
  const canRedo = useKosten((s) => s.future.length > 0);
  const [logOpen, setLogOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  const [druckOpen, setDruckOpen] = useState(false);
  const [katalogOpen, setKatalogOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [bericht, setBericht] = useState<string[]>([]);

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${name} – Kostenermittlung`;
  }, [name, dirty]);

  const onOpen = async () => {
    if (useKosten.getState().dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
    try {
      const r = await oeffnen(setBusy);
      if (r) {
        useKosten.getState().load(r.project, r.datei);
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
    const { project, datei } = useKosten.getState();
    try {
      const saved = await speichern(project, datei);
      if (saved) useKosten.getState().markSaved(saved);
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
      } else if (k === 'p' && hatPositionen) {
        e.preventDefault();
        setDruckOpen(true);
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useKosten.getState().undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        useKosten.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useKosten.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="app">
      <TitleBar app="Kostenermittlung" name={name} dirty={dirty} onOpenLog={() => setLogOpen(true)} />
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
          <button onClick={() => setKatalogOpen(true)} title="Kennwertkatalog laden, speichern und Kennwerte als Positionen übernehmen">
            Kennwertkatalog …
          </button>
        </div>
        <div className="tb-group">
          <button onClick={() => setDruckOpen(true)} disabled={!hatPositionen} title="Druckbare Kostenermittlung – über den Druckdialog auch als PDF (Strg+P)">
            Kosten drucken
          </button>
          <button onClick={() => setExcelOpen(true)} disabled={!hatPositionen} title="Kostenermittlung als Excel-Datei – Standardlayout oder eigene Vorlage">
            Excel …
          </button>
        </div>
        <div className="tb-group">
          <button onClick={() => useKosten.getState().undo()} disabled={!canUndo} title="Rückgängig (Strg+Z)">
            ↶
          </button>
          <button onClick={() => useKosten.getState().redo()} disabled={!canRedo} title="Wiederholen (Strg+Y)">
            ↷
          </button>
        </div>
        {busy && <span className="busy">{busy}</span>}
      </div>
      <main className="ko-main">
        {bericht.length > 0 && (
          <div className="ko-bericht">
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
        {!hatGebaeude && !hatPositionen && (
          <div className="ko-leer">
            <h2>Kostenermittlung nach DIN 276</h2>
            <p>
              Ein Projekt des Flächenrechners (<code>.oap</code>/<code>.akhp</code>) oder direkt ein IFC-Modell öffnen. BGF, BRI, Nutzungs- und Wohnflächen sowie grobe
              Bauteilmengen kommen aus dem Projekt; Kennwerte, Positionen und Kostenstände pflegt dieses Tool. Gespeichert wird in dieselbe Projektdatei.
            </p>
            <p className="muted small-text">Ohne Gebäudemodell lassen sich die Mengen auch von Hand eintragen.</p>
            <button className="primary" onClick={onOpen}>
              Projekt oder IFC öffnen …
            </button>
          </div>
        )}
        <KostenView onKatalog={() => setKatalogOpen(true)} />
      </main>
      {druckOpen && <KostenDruck onClose={() => setDruckOpen(false)} />}
      {excelOpen && <ExcelDialog onClose={() => setExcelOpen(false)} />}
      {katalogOpen && <KatalogDialog onClose={() => setKatalogOpen(false)} />}
      {logOpen && <LogDialog onClose={() => setLogOpen(false)} />}
    </div>
  );
}
