import { useState } from 'react';
import { computeProject } from '../core/calc';
import { PLACEHOLDER_DOCS } from '../core/exportData';
import { base64ToBytes, bytesToBase64, pickFile, saveBinaryFile } from '../platform/files';
import { useEditor } from '../store/store';

const TEMPLATE_KEY = 'arch-flaechen-tool:excel-template';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface StoredTemplate {
  name: string;
  base64: string;
  date: string;
}

function loadTemplate(): StoredTemplate | null {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY);
    return raw ? (JSON.parse(raw) as StoredTemplate) : null;
  } catch {
    return null;
  }
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Projekt';
}

/** Excel-Export: Standardlayout oder eigene Vorlage (.xlsx mit Platzhaltern). */
export function ExcelDialog() {
  const setOpen = useEditor((s) => s.setExcelOpen);
  const [template, setTemplate] = useState<StoredTemplate | null>(loadTemplate);
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
    const t: StoredTemplate = { name: f.name, base64: bytesToBase64(new Uint8Array(await f.arrayBuffer())), date: new Date().toLocaleDateString('de-DE') };
    try {
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(t));
    } catch {
      setError('Die Vorlage ist zu groß, um sie dauerhaft zu speichern – sie gilt nur für diesen Export.');
    }
    setTemplate(t);
    setMode('template');
    setError(null);
  };

  const removeTemplate = () => {
    localStorage.removeItem(TEMPLATE_KEY);
    setTemplate(null);
    setMode('default');
  };

  const downloadSample = async () => {
    setBusy(true);
    try {
      const { buildSampleTemplate } = await import('../platform/excel');
      await saveBinaryFile({ defaultName: 'Flächen-Vorlage.xlsx', data: await buildSampleTemplate(), filterName: 'Excel-Arbeitsmappe', extension: 'xlsx', mime: XLSX_MIME });
    } catch (e) {
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
      const data = mode === 'template' && template ? await exportWithTemplate(base64ToBytes(template.base64), p, result) : await exportDefault(p, result);
      const ok = await saveBinaryFile({ defaultName: `${safeFileName(p.name)} Flächen.xlsx`, data, filterName: 'Excel-Arbeitsmappe', extension: 'xlsx', mime: XLSX_MIME });
      if (ok) setOpen(false);
    } catch (e) {
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
                {template.name} <span className="muted">(hinterlegt am {template.date})</span>
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
