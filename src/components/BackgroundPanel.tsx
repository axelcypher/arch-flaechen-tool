import { useState } from 'react';
import { bgScale } from '../core/background';
import { DXF_UNITS, decodeDxfText, importDxf } from '../core/dxf';
import { fmt2 } from '../core/format';
import type { Background, Storey } from '../core/model';
import { imageSize, pickFile, readAsDataUrl } from '../platform/files';
import type { PdfDocumentHandle } from '../platform/pdf';
import { openPdf } from '../platform/pdf';
import { mapStorey, useEditor } from '../store/store';
import { Field, NumberField } from './fields';

const ACCEPT = '.pdf,.dxf,image/png,image/jpeg,image/webp,image/gif,image/bmp';

/** Hintergrundplan eines Geschosses: laden (Bild, PDF, DXF), Maßstab, Lage, Layer. */
export function BackgroundPanel({ storey }: { storey: Storey }) {
  const st = useEditor.getState();
  const bg = storey.background;
  const [busy, setBusy] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ doc: PdfDocumentHandle; name: string } | null>(null);

  const setBg = (b: Background | undefined) => st.update((p) => mapStorey(p, storey.id, (s) => ({ ...s, background: b })));
  const patchBg = (patch: Partial<Background>) => bg && setBg({ ...bg, ...patch } as Background);

  const afterLoad = (calibrate: boolean) => {
    st.requestFit();
    if (calibrate) st.setTool('calibrate');
  };

  const load = async () => {
    const f = await pickFile(ACCEPT);
    if (!f) return;
    const ext = f.name.toLowerCase().split('.').pop();
    try {
      if (ext === 'pdf') {
        setBusy('PDF wird geöffnet …');
        const doc = await openPdf(await f.arrayBuffer());
        setPdf({ doc, name: f.name });
      } else if (ext === 'dxf') {
        setBusy('DXF wird gelesen …');
        await new Promise((r) => setTimeout(r, 20));
        const res = importDxf(decodeDxfText(await f.arrayBuffer()), f.name);
        setBg(res.background);
        afterLoad(false);
        if (!res.unitDetected) {
          alert(
            `Die DXF-Datei enthält keine Einheitenangabe. Angenommen: ${DXF_UNITS.find((u) => u.scale === res.background.scale)?.label ?? 'Meter'}. Bitte unter „Einheit“ prüfen oder kalibrieren.`,
          );
        }
      } else {
        setBusy('Bild wird geladen …');
        const dataUrl = await readAsDataUrl(f);
        const { width, height } = await imageSize(dataUrl);
        // Startmaßstab: Bildbreite ≈ 20 m, danach kalibrieren
        setBg({ type: 'raster', name: f.name, dataUrl, widthPx: width, heightPx: height, x: 0, y: 0, metersPerPixel: 20 / width, opacity: 0.6, visible: true });
        afterLoad(true);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const importPdfPage = async (page: number, massstab: number | null) => {
    if (!pdf) return;
    setBusy(`Seite ${page} wird gerendert …`);
    try {
      const r = await pdf.doc.render(page);
      const mpp = massstab ? r.metersPerPixelAt1 * massstab : 20 / r.width;
      setBg({
        type: 'raster',
        name: pdf.doc.numPages > 1 ? `${pdf.name} (S. ${page})` : pdf.name,
        dataUrl: r.dataUrl,
        widthPx: r.width,
        heightPx: r.height,
        x: 0,
        y: 0,
        metersPerPixel: mpp,
        opacity: 0.6,
        visible: true,
        pdf: { page, metersPerPixelAt1: r.metersPerPixelAt1 },
      });
      pdf.doc.destroy();
      setPdf(null);
      afterLoad(!massstab);
    } catch (e) {
      alert(`PDF konnte nicht gerendert werden: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h3>Hintergrundplan</h3>
      {busy && <p className="busy">{busy}</p>}
      {!bg && !busy && (
        <>
          <p className="muted small-text">
            Grundriss als <strong>PDF</strong>, <strong>DXF</strong> oder Bild (PNG/JPG) laden und Flächen darauf nachzeichnen oder per Klick erkennen
            lassen.
          </p>
          <button onClick={load}>Plan laden …</button>
        </>
      )}
      {bg && (
        <>
          <p className="small-text">
            <strong>{bg.type === 'vector' ? (bg.source === 'ifc' ? 'IFC' : 'DXF') : bg.pdf ? 'PDF' : 'Bild'}:</strong> {bg.name}
            {bg.type === 'raster' && (
              <span className="muted">
                {' '}
                ({bg.widthPx} × {bg.heightPx} px)
              </span>
            )}
          </p>

          {bg.type === 'raster' && bg.pdf && (
            <Field label="Planmaßstab 1:" hint="Maßstab, in dem das PDF geplottet wurde">
              <NumberField
                value={bg.metersPerPixel / bg.pdf.metersPerPixelAt1}
                digits={1}
                min={1}
                onChange={(v) => v && bg.pdf && patchBg({ metersPerPixel: bg.pdf.metersPerPixelAt1 * v })}
              />
            </Field>
          )}
          {bg.type === 'raster' && !bg.pdf && (
            <Field label="Auflösung [mm/px]">
              <NumberField value={bg.metersPerPixel * 1000} digits={3} min={0.0001} onChange={(v) => v && patchBg({ metersPerPixel: v / 1000 })} />
            </Field>
          )}
          {bg.type === 'vector' && bg.source !== 'ifc' && (
            <Field label="Einheit der DXF-Zeichnung">
              <select
                value={DXF_UNITS.some((u) => Math.abs(u.scale - bg.scale) < 1e-12) ? bg.scale : 'custom'}
                onChange={(e) => e.target.value !== 'custom' && patchBg({ scale: Number(e.target.value) })}
              >
                {DXF_UNITS.map((u) => (
                  <option key={u.label} value={u.scale}>
                    {u.label}
                  </option>
                ))}
                {!DXF_UNITS.some((u) => Math.abs(u.scale - bg.scale) < 1e-12) && <option value="custom">kalibriert (1 Einheit = {fmt2(bg.scale * 1000)} mm)</option>}
              </select>
            </Field>
          )}

          <div className="field-row">
            <Field label="Versatz X [m]">
              <NumberField value={bg.x} onChange={(v) => v !== undefined && patchBg({ x: v })} />
            </Field>
            <Field label="Versatz Y [m]">
              <NumberField value={bg.y} onChange={(v) => v !== undefined && patchBg({ y: v })} />
            </Field>
          </div>
          <Field label={`Deckkraft (${Math.round(bg.opacity * 100)} %)`}>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={bg.opacity}
              onChange={(e) =>
                st.updateSilent((p) => mapStorey(p, storey.id, (s) => (s.background ? { ...s, background: { ...s.background, opacity: Number(e.target.value) } } : s)))
              }
            />
          </Field>
          <div className="button-row">
            <button className="small" onClick={() => st.setTool('calibrate')} title="Zwei Punkte mit bekanntem Abstand anklicken">
              Kalibrieren
            </button>
            <button className="small" onClick={() => patchBg({ visible: !bg.visible })}>
              {bg.visible ? 'Ausblenden' : 'Einblenden'}
            </button>
            <button className="small" onClick={load}>
              Ersetzen
            </button>
            <button className="small danger" onClick={() => window.confirm('Hintergrundplan entfernen?') && setBg(undefined)}>
              Entfernen
            </button>
          </div>
          <p className="muted small-text">1 Einheit = {fmt2(bgScale(bg) * 1000)} mm</p>

          {bg.type === 'vector' && (
            <details className="layer-list">
              <summary>Layer ({bg.layers.filter((l) => l.visible).length}/{bg.layers.length} sichtbar)</summary>
              <div className="button-row">
                <button className="small" onClick={() => patchBg({ layers: bg.layers.map((l) => ({ ...l, visible: true })) })}>
                  alle
                </button>
                <button className="small" onClick={() => patchBg({ layers: bg.layers.map((l) => ({ ...l, visible: false })) })}>
                  keine
                </button>
              </div>
              <p className="muted small-text">Ausgeblendete Layer werden weder angezeigt noch für Fang und Raumerkennung verwendet (z. B. Möblierung, Bemaßung).</p>
              <ul className="list">
                {bg.layers.map((l, i) => (
                  <li key={l.name}>
                    <label className="toggle grow-text">
                      <input
                        type="checkbox"
                        checked={l.visible}
                        onChange={(e) => patchBg({ layers: bg.layers.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x)) })}
                      />
                      <span className="swatch" style={{ background: l.color }} />
                      {l.name}
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {pdf && <PdfImportDialog doc={pdf.doc} name={pdf.name} onImport={importPdfPage} onCancel={() => (pdf.doc.destroy(), setPdf(null))} />}
    </>
  );
}

function PdfImportDialog({
  doc,
  name,
  onImport,
  onCancel,
}: {
  doc: PdfDocumentHandle;
  name: string;
  onImport: (page: number, massstab: number | null) => void;
  onCancel: () => void;
}) {
  const [page, setPage] = useState(1);
  const [known, setKnown] = useState(true);
  const [massstab, setMassstab] = useState<number | undefined>(100);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          onImport(page, known && massstab ? massstab : null);
        }}
      >
        <h3>PDF importieren</h3>
        <p className="small-text">{name}</p>
        <Field label={`Seite (1–${doc.numPages})`}>
          <input type="number" min={1} max={doc.numPages} value={page} onChange={(e) => setPage(Math.min(doc.numPages, Math.max(1, Number(e.target.value) || 1)))} />
        </Field>
        <label className="toggle">
          <input type="checkbox" checked={known} onChange={(e) => setKnown(e.target.checked)} />
          Plan ist maßstäblich geplottet
        </label>
        {known && (
          <Field label="Maßstab 1:">
            <NumberField value={massstab} digits={1} min={1} onChange={setMassstab} />
          </Field>
        )}
        <p className="muted small-text">
          {known
            ? 'Der Plan wird direkt im richtigen Maßstab platziert. Zur Kontrolle eine bekannte Strecke nachmessen.'
            : 'Nach dem Import zwei Punkte mit bekanntem Abstand anklicken, um den Plan zu kalibrieren.'}
        </p>
        <div className="dialog-buttons">
          <button type="button" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="primary">
            Importieren
          </button>
        </div>
      </form>
    </div>
  );
}
