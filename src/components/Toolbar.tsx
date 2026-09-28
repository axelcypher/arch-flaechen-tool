import { computeProject } from '../core/calc';
import { projectToCsv } from '../core/export';
import { parseProject, ProjectFormatError, serializeProject } from '../core/serialize';
import { isTauri, openTextFile, saveTextFile } from '../platform/files';
import type { Tool } from '../store/store';
import { useEditor } from '../store/store';

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Auswählen', key: 'V', icon: '⬉' },
  { id: 'polygon', label: 'Polygon', key: 'P', icon: '⬠' },
  { id: 'rect', label: 'Rechteck', key: 'R', icon: '▭' },
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

  const onNew = () => {
    if (confirmDiscard()) st.newProject();
  };

  const onOpen = async () => {
    if (!confirmDiscard()) return;
    const f = await openTextFile('.json,application/json');
    if (!f) return;
    try {
      st.loadProject(parseProject(f.text));
    } catch (e) {
      alert(e instanceof ProjectFormatError ? e.message : `Datei konnte nicht geladen werden: ${String(e)}`);
    }
  };

  const onSave = async () => {
    const p = useEditor.getState().project;
    try {
      const ok = await saveTextFile({
        defaultName: `${safeFileName(p.name)}.flaeche.json`,
        contents: serializeProject(p),
        filterName: 'Flächenprojekt',
        extension: 'json',
        mime: 'application/json',
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
      </div>
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
        <button className="primary" onClick={() => st.setReportOpen(true)}>
          Flächenaufstellung
        </button>
      </div>
    </div>
  );
}

