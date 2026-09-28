import { useState } from 'react';
import { computeProject } from '../core/calc';
import { fmt2 } from '../core/format';
import type { IfcExtract } from '../core/ifcData';
import type { IfcImportOptions } from '../core/ifcImport';
import { buildFromIfc } from '../core/ifcImport';
import { createProject } from '../core/model';
import { pickFile } from '../platform/files';
import { useEditor } from '../store/store';
import { NumberField } from './fields';

type Step = { kind: 'start' } | { kind: 'loading'; msg: string } | { kind: 'options'; x: IfcExtract; file: string } | { kind: 'done'; report: string[] };

/** IFC-Import (z. B. Archicad): Geschosse, Zonen → Räume, BGF-Umrisse, Dach für den BRI. */
export function IfcImportDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'start' });
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<IfcImportOptions & { replace: boolean }>({
    rooms: true,
    outlines: true,
    roof: true,
    wohnflaeche: false,
    planSchnitthoehe: 1,
    replace: true,
  });

  const choose = async () => {
    setError(null);
    const f = await pickFile('.ifc');
    if (!f) return;
    setStep({ kind: 'loading', msg: 'Datei wird gelesen …' });
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      const { loadIfc } = await import('../platform/ifc');
      const x = await loadIfc(data, (msg) => setStep({ kind: 'loading', msg }));
      setStep({ kind: 'options', x, file: f.name });
    } catch (e) {
      setError(`IFC-Datei konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`);
      setStep({ kind: 'start' });
    }
  };

  const doImport = async (x: IfcExtract, file: string) => {
    setStep({ kind: 'loading', msg: 'Flächen werden ermittelt …' });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const r = buildFromIfc(x, opts);
      const st = useEditor.getState();
      if (opts.replace) {
        if (st.dirty && !window.confirm('Ungespeicherte Änderungen am aktuellen Projekt verwerfen?')) {
          setStep({ kind: 'options', x, file });
          return;
        }
        const p = createProject(x.projectName || file.replace(/\.ifc$/i, ''));
        p.storeys = r.storeys;
        p.dachModell = r.dachModell;
        st.loadProject(p);
      } else {
        st.update((p) => ({ ...p, storeys: [...p.storeys, ...r.storeys], dachModell: r.dachModell ?? p.dachModell }));
      }
      const { ifcReference } = await import('../platform/ifc');
      st.setIfcModel(ifcReference(x, file));
      const res = computeProject(useEditor.getState().project);
      setStep({
        kind: 'done',
        report: [
          ...r.report,
          `Ergebnis: BGF ${fmt2(res.total.bgf.total)} m², BRI ${fmt2(res.total.bri.total)} m³, NRF ${fmt2(res.total.nrf.total)} m²${res.total.wofl ? `, WoFl ${fmt2(res.total.wofl)} m²` : ''}.`,
        ],
      });
    } catch (e) {
      setError(`Import fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      setStep({ kind: 'options', x, file });
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <h3>IFC-Import</h3>
        {step.kind === 'start' && (
          <>
            <p className="small-text">
              Übernimmt aus einem IFC-Modell (z. B. Archicad, Revit, Vectorworks) die <strong>Geschosse</strong>, die <strong>Zonen/Räume</strong> (IfcSpace)
              als Räume, die <strong>BGF-Umrisse</strong> aus den Außenbauteilen und die <strong>Dachhaut</strong> für den Brutto-Rauminhalt.
            </p>
            <p className="muted small-text">
              Archicad: Datei → Speichern unter → IFC, mit einem Übersetzer, der Zonen exportiert (siehe docs/archicad-ifc.md). Die Datei wird nur lokal
              verarbeitet.
            </p>
            <div className="dialog-buttons">
              <button onClick={onClose}>Abbrechen</button>
              <button className="primary" onClick={choose}>
                IFC-Datei wählen …
              </button>
            </div>
          </>
        )}
        {step.kind === 'loading' && <p className="busy">{step.msg}</p>}
        {step.kind === 'options' && (
          <>
            <p className="small-text">
              <strong>{step.file}</strong> ({step.x.schema}) – {step.x.storeys.length} Geschosse, {step.x.spaces.length} Räume/Zonen, {step.x.elements.length} Bauteile
            </p>
            <ul className="ifc-storeys">
              {[...step.x.storeys]
                .sort((a, b) => a.elevation - b.elevation)
                .map((s) => (
                  <li key={s.expressId}>
                    {s.name} <span className="muted">(± {fmt2(s.elevation)} m, {step.x.spaces.filter((sp) => step.x.storeys[sp.storey] === s).length} Räume)</span>
                  </li>
                ))}
            </ul>
            <label className="toggle block">
              <input type="checkbox" checked={opts.rooms} onChange={(e) => setOpts({ ...opts, rooms: e.target.checked })} />
              Räume aus Zonen (IfcSpace) – Nummer, Name, Putzabzug wie im Modell
            </label>
            <label className="toggle block indent">
              <input type="checkbox" checked={opts.wohnflaeche} disabled={!opts.rooms} onChange={(e) => setOpts({ ...opts, wohnflaeche: e.target.checked })} />
              als Wohnfläche anrechnen (WoFlV-Faktor aus den lichten Raumhöhen, Wohnung = Geschoss)
            </label>
            <label className="toggle block">
              <input type="checkbox" checked={opts.outlines} onChange={(e) => setOpts({ ...opts, outlines: e.target.checked })} />
              BGF-Umrisse aus Wänden, Stützen, Fenstern und Türen je Geschoss
            </label>
            <label className="toggle block">
              <input type="checkbox" checked={opts.roof} onChange={(e) => setOpts({ ...opts, roof: e.target.checked })} />
              Dach aus dem Modell für den BRI (Volumen bis zur Dachhaut)
            </label>
            <label className="toggle block">
              <input
                type="checkbox"
                checked={!!opts.planSchnitthoehe}
                onChange={(e) => setOpts({ ...opts, planSchnitthoehe: e.target.checked ? 1 : 0 })}
              />
              Geschossschnitt als Plan hinterlegen (zum Prüfen und Korrigieren im Grundriss)
            </label>
            {!!opts.planSchnitthoehe && (
              <label className="toggle block indent">
                Schnitthöhe über Fußboden
                <span className="inline-num">
                  <NumberField value={opts.planSchnitthoehe} min={0.1} max={5} onChange={(v) => v && setOpts({ ...opts, planSchnitthoehe: v })} />
                </span>
                m
              </label>
            )}
            <hr />
            <label className="toggle block">
              <input type="radio" checked={opts.replace} onChange={() => setOpts({ ...opts, replace: true })} />
              als neues Projekt öffnen
            </label>
            <label className="toggle block">
              <input type="radio" checked={!opts.replace} onChange={() => setOpts({ ...opts, replace: false })} />
              Geschosse zum aktuellen Projekt hinzufügen
            </label>
            <div className="dialog-buttons">
              <button onClick={onClose}>Abbrechen</button>
              <button className="primary" onClick={() => doImport(step.x, step.file)}>
                Importieren
              </button>
            </div>
          </>
        )}
        {step.kind === 'done' && (
          <>
            <ul className="ifc-report">
              {step.report.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <p className="muted small-text">
              Bitte die übernommenen Flächen prüfen: Räume ohne passende Nutzungsgruppe stehen auf NUF 1; Dachflächen und Umrisse sind im 3D-Modell zu sehen.
            </p>
            <div className="dialog-buttons">
              <button onClick={onClose}>Schließen</button>
              <button
                className="primary"
                onClick={() => {
                  useEditor.getState().setMainView('3d');
                  onClose();
                }}
              >
                3D-Ansicht öffnen
              </button>
            </div>
          </>
        )}
        {error && <p className="warning">{error}</p>}
      </div>
    </div>
  );
}
