import { useState } from 'react';
import { computeProject } from '@core/calc';
import { projectToCsv } from '../core/export';
import { ARCHIV_ENDUNGEN, readProjectFile } from '@core/archive';
import { ProjectFormatError } from '@core/serialize';
import { isTauri, pickFile, saveTextFile } from '@core/platform/files';
import { projektSpeichern } from '@core/platform/projektDatei';
import { mitVorlage } from '../platform/vorlage';
import type { Tool } from '../store/store';
import { restoreIfcModel, useEditor } from '../store/store';
import { IfcImportDialog } from './IfcImportDialog';
import { logger } from '@core/platform/log';

const log = logger('datei');

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Auswählen', key: 'V', icon: '⬉' },
  { id: 'polygon', label: 'Polygon', key: 'P', icon: '⬠' },
  { id: 'rect', label: 'Rechteck', key: 'R', icon: '▭' },
  { id: 'detect', label: 'Erkennen', key: 'E', icon: '⊡' },
  { id: 'measure', label: 'Messen', key: 'M', icon: '📏' },
  { id: 'calibrate', label: 'Kalibrieren', key: '', icon: '⇔' },
];

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Projekt';
}

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const drawKind = useEditor((s) => s.drawKind);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const dirty = useEditor((s) => s.dirty);
  const st = useEditor.getState();

  const confirmDiscard = () => !useEditor.getState().dirty || window.confirm('Ungespeicherte Änderungen verwerfen?');

  const [ifcOpen, setIfcOpen] = useState(false);

  const onNew = () => {
    if (confirmDiscard()) st.newProject();
  };

  const onOpen = async () => {
    if (!confirmDiscard()) return;
    const f = await pickFile(`${ARCHIV_ENDUNGEN.map((e) => `.${e}`).join(',')},.json,application/json`);
    if (!f) return;
    try {
      const done = log.time(`Öffnen: ${f.name}`);
      const p = readProjectFile(new Uint8Array(await f.arrayBuffer()));
      st.loadProject(p, p);
      done({ bytes: f.size, geschosse: p.storeys.length, dateien: p.dateien?.length ?? 0 });
      void restoreIfcModel(p);
    } catch (e) {
      log.error(`Öffnen fehlgeschlagen: ${f.name}`, e);
      alert(e instanceof ProjectFormatError ? e.message : `Datei konnte nicht geladen werden: ${String(e)}`);
    }
  };

  const onSave = async () => {
    const { project: p, basis } = useEditor.getState();
    try {
      const r = await projektSpeichern({ project: p, basis, app: __APP_VERSION__, filterName: 'Flächenprojekt', fuerDatei: mitVorlage });
      if (r) {
        // während des Dialogs weitergezeichnet? Dann bleibt der neue Stand ungespeichert.
        if (useEditor.getState().project === p) useEditor.getState().markSaved(r.project);
        log.info('Projekt gespeichert', { name: p.name, zusammengefuehrt: r.zusammengefuehrt });
        if (r.zusammengefuehrt) alert('In der Datei standen Änderungen aus einer anderen App (z. B. GRZ-Nachweis oder Kostenermittlung). Sie wurden übernommen, nicht überschrieben.');
      }
    } catch (e) {
      log.error('Speichern fehlgeschlagen', e);
      alert(`Speichern fehlgeschlagen: ${String(e)}`);
    }
  };

  const onCsv = async () => {
    const p = useEditor.getState().project;
    try {
      await saveTextFile({
        defaultName: `${safeFileName(p.name)} Flächen.csv`,
        contents: projectToCsv(p, computeProject(p)),
        filterName: 'CSV (Excel)',
        extension: 'csv',
        mime: 'text/csv;charset=utf-8',
      });
    } catch (e) {
      log.error('CSV-Export fehlgeschlagen', e);
      alert(`Export fehlgeschlagen: ${String(e)}`);
    }
  };

  return (
    <div className="toolbar">
      <div className="tb-group">
        <button onClick={onNew} title="Neues Projekt">
          Neu
        </button>
        <button onClick={onOpen} title="Projekt öffnen">
          Öffnen
        </button>
        <button onClick={onSave} title={isTauri() ? 'Projekt speichern' : 'Projekt als Datei herunterladen'}>
          Speichern{dirty ? ' •' : ''}
        </button>
        <button onClick={() => setIfcOpen(true)} title="Gebäudemodell aus Archicad, Revit & Co. importieren">
          IFC-Import
        </button>
      </div>
      {ifcOpen && <IfcImportDialog onClose={() => setIfcOpen(false)} />}
      <div className="tb-group">
        <button onClick={st.undo} disabled={!canUndo} title="Rückgängig (Strg+Z)">
          ↶
        </button>
        <button onClick={st.redo} disabled={!canRedo} title="Wiederholen (Strg+Y)">
          ↷
        </button>
      </div>
      <div className="tb-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'active' : ''}
            onClick={() => st.setTool(t.id)}
            title={`${t.label}${t.key ? ` (${t.key})` : ''}`}
          >
            <span className="tb-icon">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
      <div className="tb-group" title="Art der neu gezeichneten Fläche">
        <span className="tb-label">als</span>
        <button className={drawKind === 'outline' ? 'active kind-outline' : ''} onClick={() => st.setDrawKind('outline')} title="BGF-Umriss (B)">
          BGF-Umriss
        </button>
        <button className={drawKind === 'room' ? 'active kind-room' : ''} onClick={() => st.setDrawKind('room')} title="Raum / NRF (N)">
          Raum
        </button>
      </div>
      <div className="tb-spacer" />
      <div className="tb-group">
        <button onClick={onCsv} title="Flächenaufstellung als CSV exportieren">
          CSV
        </button>
        <button onClick={() => st.setExcelOpen(true)} title="Excel-Export (Standardlayout oder eigene Vorlage)">
          Excel
        </button>
        <button className="primary" onClick={() => st.setReportOpen(true)}>
          Flächenaufstellung
        </button>
      </div>
    </div>
  );
}

