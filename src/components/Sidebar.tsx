import { useMemo } from 'react';
import { computeStorey } from '../core/calc';
import { fmt2 } from '../core/format';
import { shapeArea } from '../core/model';
import { nutzungInfo } from '../core/norms';
import { nutzungLabel, versiegelungInfo } from '../core/lageplan';
import { addStorey, duplicateStorey, moveStorey, removeStorey, useActiveStorey, useEditor } from '../store/store';
import { Field, NumberField } from './fields';
import { ProjektInfo } from './ProjektDialog';

/** Linke Seitenleiste: Projekt, Geschosse, Flächenliste des aktiven Geschosses. */
export function Sidebar() {
  const project = useEditor((s) => s.project);
  const storey = useActiveStorey();
  const selectedId = useEditor((s) => s.selectedShapeId);
  const view = useEditor((s) => s.view);
  const st = useEditor.getState();

  const outlines = storey.shapes.filter((s) => s.kind === 'outline');
  const rooms = storey.shapes.filter((s) => s.kind === 'room');
  const flaechen = storey.shapes.filter((s) => s.kind === 'flaeche');

  return (
    <aside className="sidebar sidebar-left">
      <section>
        <h2>Projekt</h2>
        <ProjektInfo />
        <div className="field-row projekt-settings">
          <Field label="Raster [m]">
            <NumberField
              value={project.settings.gridStep}
              min={0.001}
              digits={3}
              onChange={(v) => v && st.update((p) => ({ ...p, settings: { ...p.settings, gridStep: v } }))}
            />
          </Field>
          <Field label="Balkonfaktor">
            <NumberField
              value={project.settings.freisitzFaktor}
              min={0}
              max={0.5}
              onChange={(v) => v !== undefined && st.update((p) => ({ ...p, settings: { ...p.settings, freisitzFaktor: v } }))}
            />
          </Field>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Geschosse</h2>
          <button
            className="small"
            onClick={() => {
              const r = addStorey(project, `${project.storeys.length}. OG`);
              st.update(() => r.project);
              st.setActiveStorey(r.id);
            }}
            title="Geschoss hinzufügen"
          >
            + Neu
          </button>
        </div>
        <ul className="list">
          {[...project.storeys].reverse().map((s) => (
            <StoreyRow key={s.id} id={s.id} name={s.name} active={s.id === storey.id} />
          ))}
        </ul>
        <div className="button-row">
          <button
            className="small"
            onClick={() => {
              const r = duplicateStorey(project, storey.id);
              st.update(() => r.project);
              st.setActiveStorey(r.id);
            }}
            title="Aktives Geschoss inkl. aller Flächen kopieren"
          >
            Duplizieren
          </button>
          <button className="small" onClick={() => st.update((p) => moveStorey(p, storey.id, 1))} title="Nach oben">
            ▲
          </button>
          <button className="small" onClick={() => st.update((p) => moveStorey(p, storey.id, -1))} title="Nach unten">
            ▼
          </button>
          <button
            className="small danger"
            disabled={project.storeys.length <= 1}
            onClick={() => window.confirm(`Geschoss „${storey.name}“ löschen?`) && st.update((p) => removeStorey(p, storey.id))}
          >
            Löschen
          </button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={view.showGhost} onChange={(e) => st.setView({ showGhost: e.target.checked })} />
          darunterliegendes Geschoss einblenden
        </label>
      </section>

      <section className="grow">
        <h2>Flächen – {storey.name}</h2>
        <div className="layer-toggles">
          <label className="toggle">
            <input type="checkbox" checked={view.showOutlines} onChange={(e) => st.setView({ showOutlines: e.target.checked })} />
            BGF-Umrisse
          </label>
          <label className="toggle">
            <input type="checkbox" checked={view.showRooms} onChange={(e) => st.setView({ showRooms: e.target.checked })} />
            Räume
          </label>
          <label className="toggle">
            <input type="checkbox" checked={view.showDimensions} onChange={(e) => st.setView({ showDimensions: e.target.checked })} />
            Maße
          </label>
        </div>
        {storey.shapes.length === 0 && <p className="muted">Noch keine Flächen. Werkzeug „Polygon“ oder „Rechteck“ wählen und zeichnen.</p>}
        {outlines.length > 0 && <h3>BGF-Umrisse</h3>}
        <ul className="list shape-list">
          {outlines.map((s) => (
            <li key={s.id} className={s.id === selectedId ? 'active' : ''} onClick={() => st.select(s.id)}>
              <span className="swatch" style={{ background: s.subtract ? '#c0392b' : '#2a5bd7' }} />
              <span className="grow-text">
                {s.name} <small>({s.umschliessung})</small>
              </span>
              <span className="num">{fmt2(shapeArea(s) * (s.subtract ? -1 : 1))}</span>
            </li>
          ))}
        </ul>
        {flaechen.length > 0 && <h3>Lageplan-Flächen</h3>}
        <ul className="list shape-list">
          {flaechen.map((s) =>
            s.kind === 'flaeche' ? (
              <li key={s.id} className={s.id === selectedId ? 'active' : ''} onClick={() => st.select(s.id)}>
                <span className="swatch" style={{ background: versiegelungInfo(s.versiegelung).color, opacity: s.nachbar ? 0.4 : 1 }} />
                <span className="grow-text">
                  {s.name} <small>{s.nachbar ? 'Nachbar' : nutzungLabel(s.nutzung)}</small>
                </span>
                <span className="num">{fmt2(shapeArea(s))}</span>
              </li>
            ) : null,
          )}
        </ul>
        {rooms.length > 0 && <h3>Räume</h3>}
        <ul className="list shape-list">
          {rooms.map((s) => (
            <li key={s.id} className={s.id === selectedId ? 'active' : ''} onClick={() => st.select(s.id)}>
              <span className="swatch" style={{ background: s.subtract ? '#c0392b' : nutzungInfo(s.nutzung).color }} />
              <span className="grow-text">
                <small>{s.nummer}</small> {s.name}
              </span>
              <span className="num">{fmt2(shapeArea(s) * (s.subtract ? -1 : 1))}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function StoreyRow({ id, name, active }: { id: string; name: string; active: boolean }) {
  const project = useEditor((s) => s.project);
  const storey = project.storeys.find((s) => s.id === id)!;
  const bgf = useMemo(() => computeStorey(storey, project).bgf.total, [storey, project]);
  return (
    <li className={active ? 'active' : ''} onClick={() => useEditor.getState().setActiveStorey(id)}>
      <span className="grow-text">{name}</span>
      <span className="num muted">{fmt2(bgf)} m²</span>
    </li>
  );
}
