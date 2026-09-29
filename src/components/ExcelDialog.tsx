import { useMemo, useState } from 'react';
import { computeProject } from '../core/calc';
import { PLACEHOLDER_DOCS } from '../core/exportData';
import { addDatei } from '../core/model';
import { pickFile, saveBinaryFile } from '../platform/files';
import { aktuelleVorlage, removeGlobaleVorlage, setGlobaleVorlage } from '../platform/vorlage';
import { useEditor } from '../store/store';
import { logger } from '../platform/log';

const log = logger('excel');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Projekt';
}

/** Excel-Export: Standardlayout oder eigene Vorlage (.xlsx mit Platzhaltern). */
export function ExcelDialog() {
  const setOpen = useEditor((s) => s.setExcelOpen);
  const project = useEditor((s) => s.project);
  // Zähler, damit Änderungen an der im Browser hinterlegten Vorlage neu gelesen werden
  const [rev, setRev] = useState(0);
  const template = useMemo(() => aktuelleVorlage(project), [project, rev]);
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
    useEditor.getState().update((p) => addDatei(p, f.name, 'vorlage', daten).project);
    setError(setGlobaleVorlage(f.name, daten) ? null : 'Die Vorlage ist zu groß, um sie für weitere Projekte zu hinterlegen – sie wird nur mit diesem Projekt gespeichert.');
    setRev(rev + 1);
    setMode('template');
  };

  const removeTemplate = () => {
    useEditor.getState().update((p) => (p.dateien?.some((d) => d.art === 'vorlage') ? { ...p, dateien: p.dateien.filter((d) => d.art !== 'vorlage') } : p));
    removeGlobaleVorlage();
    setRev(rev + 1);
    setMode('default');
  };

  const downloadSample = async () => {
    setBusy(true);
    try {
      const { buildSampleTemplate } = await import('../platform/excel');
      await saveBinaryFile({ defaultName: 'Flächen-Vorlage.xlsx', data: await buildSampleTemplate(), filterName: 'Excel-Arbeitsmappe', extension: 'xlsx', mime: XLSX_MIME });
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
      const { exportDefault, exportWithTemplate } = await import('../platform/excel');
      const p = useEditor.getState().project;
      const result = computeProject(p);
      const done = log.time(mode === 'template' && template ? `Export mit Vorlage „${template.name}“` : 'Export Standardlayout');
      const data = mode === 'template' && template ? await exportWithTemplate(template.daten, p, result) : await exportDefault(p, result);
      done({ bytes: data.byteLength });
      const ok = await saveBinaryFile({ defaultName: `${safeFileName(p.name)} Flächen.xlsx`, data, filterName: 'Excel-Arbeitsmappe', extension: 'xlsx', mime: XLSX_MIME });
      if (ok) setOpen(false);
    } catch (e) {
      log.error('Excel-Export fehlgeschlagen', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal modal-wide">
        <h3>Excel-Export</h3>
        <label className="radio-row">
          <input type="radio" checked={mode === 'default'} onChange={() => setMode('default')} />
          <span>
            <strong>Standardlayout</strong>
            <br />
            <span className="muted small-text">Blätter DIN 277, NRF nach Nutzungsgruppen, Raumliste und Wohnflächen – mit Summenformeln.</span>
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
            <p className="small-text">
              Vorlagen sind normale .xlsx-Dateien mit Platzhaltern in doppelten geschweiften Klammern, z. B. <code>{'{{summe.bgf}}'}</code> oder{' '}
              <code>{'{{geschoss:EG.nrf}}'}</code>. Enthält eine Zeile <code>{'{{raum.…}}'}</code>, <code>{'{{geschoss.…}}'}</code>,{' '}
              <code>{'{{wohnung.…}}'}</code> oder <code>{'{{nutzung.…}}'}</code>, wird sie je Eintrag wiederholt. Formatierung bleibt erhalten, Formeln wie{' '}
              <code>=SUMME(C5:C5)</code> werden auf alle eingefügten Zeilen erweitert.
            </p>
            {PLACEHOLDER_DOCS.map((g) => (
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
          <button onClick={() => setOpen(false)}>Abbrechen</button>
          <button className="primary" onClick={doExport} disabled={busy}>
            {busy ? 'Exportiere …' : 'Exportieren'}
          </button>
        </div>
      </div>
    </div>
  );
}
