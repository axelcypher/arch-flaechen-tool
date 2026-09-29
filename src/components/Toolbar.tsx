import { useState } from 'react';
import { computeProject } from '../core/calc';
import { projectToCsv } from '../core/export';
import { ARCHIV_ENDUNGEN, readProjectFile, writeArchive } from '../core/archive';
import { ProjectFormatError } from '../core/serialize';
import { isTauri, pickFile, saveBinaryFile, saveTextFile } from '../platform/files';
import { mitVorlage } from '../platform/vorlage';
import type { Tool } from '../store/store';
import { restoreIfcModel, useEditor } from '../store/store';
import { IfcImportDialog } from './IfcImportDialog';

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
      const p = readProjectFile(new Uint8Array(await f.arrayBuffer()));
      st.loadProject(p);
      void restoreIfcModel(p);
    } catch (e) {
      alert(e instanceof ProjectFormatError ? e.message : `Datei konnte nicht geladen werden: ${String(e)}`);
    }
  };

  const onSave = async () => {
    const p = useEditor.getState().project;
    try {
      const ok = await saveBinaryFile({
        defaultName: `${safeFileName(p.name)}.${ARCHIV_ENDUNGEN[0]}`,
        data: writeArchive(mitVorlage(p), { app: __APP_VERSION__ }),
        filterName: 'Flächenprojekt',
        extension: ARCHIV_ENDUNGEN[0],
        moreExtensions: ARCHIV_ENDUNGEN.slice(1),
        mime: 'application/zip',
      });
      if (ok) st.markSaved();
    } catch (e) {
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

