import { useMemo } from 'react';
import { computeProject, computeStorey } from '../core/calc';
import { fmt2 } from '../core/format';
import { isSelfIntersecting, perimeter, polygonArea } from '../core/geometry';
import type { Nutzungsgruppe, Raumumschliessung, Shape, WoflKategorie } from '../core/model';
import { NUTZUNGSGRUPPEN, UMSCHLIESSUNG, WOFL_KATEGORIEN, woflFaktor } from '../core/norms';
import { mapShape, mapStorey, useActiveStorey, useEditor, useSelectedShape } from '../store/store';
import { BackgroundPanel } from './BackgroundPanel';
import { Field, NumberField, TextField } from './fields';

/** Rechte Seitenleiste: Eigenschaften der Auswahl bzw. des Geschosses + Kurzauswertung. */
export function Properties() {
  const shape = useSelectedShape();
  return (
    <aside className="sidebar sidebar-right">
      {shape ? <ShapeProperties shape={shape} /> : <StoreyProperties />}
      <Summary />
    </aside>
  );
}

function ShapeProperties({ shape }: { shape: Shape }) {
  const storey = useActiveStorey();
  const project = useEditor((s) => s.project);
  const st = useEditor.getState();
  const upd = (fn: (s: Shape) => Shape) => st.update((p) => mapShape(p, storey.id, shape.id, fn));

  const area = polygonArea(shape.points);
  const selfX = isSelfIntersecting(shape.points);

  return (
    <section>
      <div className="section-head">
        <h2>{shape.kind === 'outline' ? 'BGF-Umriss' : 'Raum'}</h2>
        <button
          className="small danger"
          onClick={() => {
            st.update((p) => mapStorey(p, storey.id, (s) => ({ ...s, shapes: s.shapes.filter((x) => x.id !== shape.id) })));
            st.select(null);
          }}
        >
          Löschen
        </button>
      </div>

      <div className="metric-row">
        <div className="metric">
          <span>Fläche</span>
          <strong>
            {shape.subtract ? '−' : ''}
            {fmt2(area)} m²
          </strong>
        </div>
        <div className="metric">
          <span>Umfang</span>
          <strong>{fmt2(perimeter(shape.points))} m</strong>
        </div>
      </div>
      {selfX && <p className="warning">Das Polygon überschneidet sich selbst – die Fläche ist so nicht korrekt.</p>}

      {shape.kind === 'room' && (
        <div className="field-row">
          <Field label="Nr.">
            <TextField value={shape.nummer} onChange={(v) => upd((s) => ({ ...s, nummer: v }))} />
          </Field>
          <Field label="Bezeichnung">
            <TextField value={shape.name} onChange={(v) => upd((s) => ({ ...s, name: v }))} />
          </Field>
        </div>
      )}
      {shape.kind === 'outline' && (
        <Field label="Bezeichnung">
          <TextField value={shape.name} onChange={(v) => upd((s) => ({ ...s, name: v }))} />
        </Field>
      )}

      <Field label="Raumumschließung (DIN 277)">
        <select value={shape.umschliessung} onChange={(e) => upd((s) => ({ ...s, umschliessung: e.target.value as Raumumschliessung }))}>
          {UMSCHLIESSUNG.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </Field>

      <label className="toggle">
        <input type="checkbox" checked={shape.subtract} onChange={(e) => upd((s) => ({ ...s, subtract: e.target.checked }))} />
        Abzugsfläche (wird abgezogen, z. B. Innenhof, Schacht, Treppenloch)
      </label>

      {shape.kind === 'outline' && (
        <Field label="Abweichende Höhe für BRI [m]" hint={`leer = Geschosshöhe (${fmt2(storey.hoehe)} m)`}>
          <NumberField value={shape.hoehe} allowEmpty min={0} onChange={(v) => upd((s) => ({ ...s, hoehe: v }))} placeholder={fmt2(storey.hoehe)} />
        </Field>
      )}

      {shape.kind === 'room' && (
        <>
          <Field label="Nutzungsgruppe (DIN 277)">
            <select value={shape.nutzung} onChange={(e) => upd((s) => ({ ...s, nutzung: e.target.value as Nutzungsgruppe }))}>
              {NUTZUNGSGRUPPEN.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.kurz} – {n.label}
                </option>
              ))}
            </select>
          </Field>
          <h3>Wohnfläche (WoFlV)</h3>
          <Field label="Anrechnung">
            <select
              value={shape.wofl.kategorie}
              onChange={(e) =>
                upd((s) => (s.kind === 'room' ? { ...s, wofl: { ...s.wofl, kategorie: e.target.value as WoflKategorie, faktor: undefined } } : s))
              }
            >
              {WOFL_KATEGORIEN.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          {(shape.wofl.kategorie === 'freisitz' || shape.wofl.kategorie === 'individuell') && (
            <Field
              label="Faktor"
              hint={shape.wofl.kategorie === 'freisitz' ? `leer = Projektstandard (${fmt2(project.settings.freisitzFaktor)}), max. 0,50` : '0 … 1'}
            >
              <NumberField
                value={shape.wofl.faktor}
                allowEmpty
                min={0}
                max={shape.wofl.kategorie === 'freisitz' ? 0.5 : 1}
                onChange={(v) => upd((s) => (s.kind === 'room' ? { ...s, wofl: { ...s.wofl, faktor: v } } : s))}
              />
            </Field>
          )}
          {shape.wofl.kategorie !== 'keine' && (
            <>
              <Field label="Wohnung">
                <TextField
                  value={shape.wofl.wohnung}
                  placeholder="z. B. WE 01"
                  onChange={(v) => upd((s) => (s.kind === 'room' ? { ...s, wofl: { ...s.wofl, wohnung: v } } : s))}
                />
              </Field>
              <p className="muted">
                Anrechenbar: {fmt2(area * woflFaktor(shape.wofl, project.settings) * (shape.subtract ? -1 : 1))} m² (Faktor{' '}
                {fmt2(woflFaktor(shape.wofl, project.settings))})
              </p>
            </>
          )}
        </>
      )}

      <Field label="Bemerkung">
        <TextField value={shape.bemerkung ?? ''} onChange={(v) => upd((s) => ({ ...s, bemerkung: v || undefined }))} />
      </Field>

      <details className="points-editor">
        <summary>Eckpunkte ({shape.points.length})</summary>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>X [m]</th>
              <th>Y [m]</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shape.points.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <NumberField
                    value={p.x}
                    digits={3}
                    onChange={(v) => v !== undefined && upd((s) => ({ ...s, points: s.points.map((q, j) => (j === i ? { ...q, x: v } : q)) }))}
                  />
                </td>
                <td>
                  <NumberField
                    value={p.y}
                    digits={3}
                    onChange={(v) => v !== undefined && upd((s) => ({ ...s, points: s.points.map((q, j) => (j === i ? { ...q, y: v } : q)) }))}
                  />
                </td>
                <td>
                  <button
                    className="small icon"
                    disabled={shape.points.length <= 3}
                    title="Punkt entfernen"
                    onClick={() => upd((s) => ({ ...s, points: s.points.filter((_, j) => j !== i) }))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function StoreyProperties() {
  const storey = useActiveStorey();
  const st = useEditor.getState();
  const upd = (fn: Parameters<typeof mapStorey>[2]) => st.update((p) => mapStorey(p, storey.id, fn));

  return (
    <section>
      <h2>Geschoss</h2>
      <div className="field-row">
        <Field label="Bezeichnung">
          <TextField value={storey.name} onChange={(v) => upd((s) => ({ ...s, name: v }))} />
        </Field>
        <Field label="Geschosshöhe [m]">
          <NumberField value={storey.hoehe} min={0} onChange={(v) => v !== undefined && upd((s) => ({ ...s, hoehe: v }))} />
        </Field>
      </div>
      <p className="muted small-text">Die Geschosshöhe (OK Rohfußboden bis OK Rohfußboden darüber bzw. OK Dachbelag) wird für den BRI verwendet.</p>

      <BackgroundPanel storey={storey} />
    </section>
  );
}

function Summary() {
  const project = useEditor((s) => s.project);
  const storey = useActiveStorey();
  const sr = useMemo(() => computeStorey(storey, project), [storey, project]);
  const pr = useMemo(() => computeProject(project), [project]);

  const rows: [string, number, number, string][] = [
    ['BGF', sr.bgf.total, pr.total.bgf.total, 'm²'],
    ['BRI', sr.bri.total, pr.total.bri.total, 'm³'],
    ['NUF', sr.nuf.total, pr.total.nuf.total, 'm²'],
    ['TF', sr.tf.total, pr.total.tf.total, 'm²'],
    ['VF', sr.vf.total, pr.total.vf.total, 'm²'],
    ['NRF', sr.nrf.total, pr.total.nrf.total, 'm²'],
    ['KGF', sr.kgf.total, pr.total.kgf.total, 'm²'],
    ['WoFl', sr.wofl, pr.total.wofl, 'm²'],
  ];

  return (
    <section className="summary">
      <h2>Auswertung</h2>
      <table className="summary-table">
        <thead>
          <tr>
            <th />
            <th>{storey.name}</th>
            <th>Gesamt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b, u]) => (
            <tr key={k} className={k === 'NRF' || k === 'BGF' ? 'strong' : ''}>
              <td>{k}</td>
              <td className="num">{fmt2(a)}</td>
              <td className="num">
                {fmt2(b)} <small>{u}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sr.bgf.total === 0 && sr.nrf.total > 0 ? (
        <p className="warning">Für dieses Geschoss ist noch kein BGF-Umriss gezeichnet.</p>
      ) : (
        sr.kgf.total < -0.005 && <p className="warning">NRF ist größer als BGF – Raumflächen oder Umriss prüfen.</p>
      )}
      {sr.bgf.total > 0 && (
        <p className="muted small-text">
          NRF/BGF: {fmt2((sr.nrf.total / sr.bgf.total) * 100)} % · KGF/BGF: {fmt2((sr.kgf.total / sr.bgf.total) * 100)} %
        </p>
      )}
    </section>
  );
}
