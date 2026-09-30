import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import type { PlaceholderDocs } from '../excel/context';
import type { VorlagenSpeicher } from '../excel/vorlage';
import type { Project } from '../model';
import { pickFile, saveBinaryFile } from '../platform/files';
import { logger } from '../platform/log';

const log = logger('excel');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Projekt';
}

export interface ExcelDialogProps {
  project: Project;
  /** Änderung am Projekt (Vorlage übernehmen/entfernen) */
  update: (fn: (p: Project) => Project) => void;
  onClose: () => void;
  speicher: VorlagenSpeicher;
  /** Beschreibung des Standardlayouts */
  standardText: string;
  /** Hinweis zu den Wiederholungszeilen (Sammlungen der App) */
  hilfe: ReactNode;
  docs: PlaceholderDocs;
  /** Dateiname ohne Endung, z. B. „Projekt Flächen“ */
  dateiName: (p: Project) => string;
  musterName: string;
  exportDefault: (p: Project) => Promise<Uint8Array>;
  exportWithTemplate: (template: Uint8Array, p: Project) => Promise<Uint8Array>;
  buildSampleTemplate: () => Promise<Uint8Array>;
}

/** Excel-Export: Standardlayout oder eigene Vorlage (.xlsx mit Platzhaltern). */
export function ExcelDialog(props: ExcelDialogProps) {
  const { project, update, onClose, speicher } = props;
  // Zähler, damit Änderungen an der im Browser hinterlegten Vorlage neu gelesen werden
  const [rev, setRev] = useState(0);
  const template = useMemo(() => speicher.aktuelle(project), [project, rev, speicher]);
  const [mode, setMode] = useState<'default' | 'template'>(template ? 'template' : 'default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const chooseTemplate = async () => {
    const f = await pickFile('.xlsx,' + XLSX_MIME);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setError('Bitte eine Excel-Datei im Format .xlsx wählen (.xls wird nicht unterstützt).');
      return;
    }
    const daten = new Uint8Array(await f.arrayBuffer());
    // gehört zum Projekt (wird im Archiv mitgespeichert) und gilt künftig auch für neue Projekte
    update((p) => speicher.setzen(p, f.name, daten));
    setError(speicher.setGlobale(f.name, daten) ? null : 'Die Vorlage ist zu groß, um sie für weitere Projekte zu hinterlegen – sie wird nur mit diesem Projekt gespeichert.');
    setRev(rev + 1);
    setMode('template');
  };

  const removeTemplate = () => {
    update((p) => speicher.entfernen(p));
    speicher.removeGlobale();
    setRev(rev + 1);
    setMode('default');
  };

  const downloadSample = async () => {
    setBusy(true);
    try {
      await saveBinaryFile({ defaultName: props.musterName, data: await props.buildSampleTemplate(), filterName: 'Excel-Arbeitsmappe', extension: 'xlsx', mime: XLSX_MIME });
    } catch (e) {
      log.error('Muster-Vorlage fehlgeschlagen', e);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = log.time(mode === 'template' && template ? `Export mit Vorlage „${template.name}“` : 'Export Standardlayout');
      const data = mode === 'template' && template ? await props.exportWithTemplate(template.daten, project) : await props.exportDefault(project);
      done({ bytes: data.byteLength });
      const ok = await saveBinaryFile({ defaultName: `${safeFileName(props.dateiName(project))}.xlsx`, data, filterName: 'Excel-Arbeitsmappe', extension: 'xlsx', mime: XLSX_MIME });
      if (ok) onClose();
    } catch (e) {
      log.error('Excel-Export fehlgeschlagen', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <h3>Excel-Export</h3>
        <label className="radio-row">
          <input type="radio" checked={mode === 'default'} onChange={() => setMode('default')} />
          <span>
            <strong>Standardlayout</strong>
            <br />
            <span className="muted small-text">{props.standardText}</span>
          </span>
        </label>
        <label className="radio-row">
          <input type="radio" checked={mode === 'template'} disabled={!template} onChange={() => setMode('template')} />
          <span>
            <strong>Eigene Vorlage</strong>
            <br />
            {template ? (
              <span className="small-text">
                {template.name}{' '}
                <span className="muted">
                  ({template.ausProjekt ? 'im Projekt gespeichert' : 'hinterlegt'} am {template.datum})
                </span>
              </span>
            ) : (
              <span className="muted small-text">Noch keine Vorlage hinterlegt.</span>
            )}
          </span>
        </label>
        <div className="button-row indent">
          <button className="small" onClick={chooseTemplate}>
            {template ? 'Andere Vorlage wählen …' : 'Vorlage wählen …'}
          </button>
          {template && (
            <button className="small danger" onClick={removeTemplate}>
              Vorlage entfernen
            </button>
          )}
          <button className="small" onClick={downloadSample} disabled={busy}>
            Muster-Vorlage herunterladen
          </button>
          <button className="small" onClick={() => setShowHelp(!showHelp)}>
            {showHelp ? 'Platzhalter ausblenden' : 'Platzhalter anzeigen'}
          </button>
        </div>

        {showHelp && (
          <div className="placeholder-help">
            <p className="small-text">{props.hilfe}</p>
            {props.docs.map((g) => (
              <div key={g.group}>
                <h4>{g.group}</h4>
                <table>
                  <tbody>
                    {g.keys.map(([k, d]) => (
                      <tr key={k}>
                        <td>
                          <code>{k}</code>
                        </td>
                        <td>{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {error && <p className="warning">{error}</p>}
        <div className="dialog-buttons">
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" onClick={doExport} disabled={busy}>
            {busy ? 'Exportiere …' : 'Exportieren'}
          </button>
        </div>
      </div>
    </div>
  );
}
