import { useMemo } from 'react';
import { computeProject, computeStorey } from '../core/calc';
import { fmt2 } from '../core/format';
import { isSelfIntersecting, perimeter } from '../core/geometry';
import type { Nutzungsgruppe, Raumumschliessung, Shape, WoflKategorie } from '../core/model';
import type { LageplanNutzung, Versiegelung } from '../core/model';
import { istDachgeschoss, shapeArea } from '../core/model';
import { LAGEPLAN_NUTZUNGEN, VERSIEGELUNGEN } from '../core/lageplan';
import { istAufenthaltsraum, massNachweis } from '../core/massNutzung';
import { NUTZUNGSGRUPPEN, UMSCHLIESSUNG, WOFL_KATEGORIEN, woflArt, woflFaktor } from '../core/norms';
import { mapShape, mapStorey, useActiveStorey, useEditor, useSelectedShape } from '../store/store';
import { BackgroundPanel } from './BackgroundPanel';
import { RoofEditor } from './RoofEditor';
import { Field, NumberField, TextField } from './fields';

const AUFENTHALT_LABEL = { ja: 'Aufenthaltsraum', nein: 'kein Aufenthaltsraum', treppe: 'Treppenraum' } as const;

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

  const area = shapeArea(shape);
  const selfX = isSelfIntersecting(shape.points);

  return (
    <section>
      <div className="section-head">
        <h2>{shape.kind === 'outline' ? 'BGF-Umriss' : shape.kind === 'flaeche' ? 'Lageplan-Fläche' : 'Raum'}</h2>
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
      {shape.kind !== 'room' && (
        <Field label="Bezeichnung">
          <TextField value={shape.name} onChange={(v) => upd((s) => ({ ...s, name: v }))} />
        </Field>
      )}

      {shape.kind === 'flaeche' && (
        <>
          <div className="field-row">
            <Field label="Nutzung" hint="maßgebend für die Grundfläche (GRZ)">
              <select value={shape.nutzung} onChange={(e) => upd((s) => (s.kind === 'flaeche' ? { ...s, nutzung: e.target.value as LageplanNutzung } : s))}>
                {LAGEPLAN_NUTZUNGEN.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Versiegelung" hint="für die Flächenbilanz">
              <select value={shape.versiegelung} onChange={(e) => upd((s) => (s.kind === 'flaeche' ? { ...s, versiegelung: e.target.value as Versiegelung } : s))}>
                {VERSIEGELUNGEN.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Höhe der Oberfläche [m]" hint="über ±0,00 – ergibt die Geländeoberfläche an den Außenwänden">
            <NumberField value={shape.hoehe} allowEmpty onChange={(v) => upd((s) => (s.kind === 'flaeche' ? { ...s, hoehe: v } : s))} />
          </Field>
          <label className="toggle">
            <input type="checkbox" checked={!!shape.nachbar} onChange={(e) => upd((s) => (s.kind === 'flaeche' ? { ...s, nachbar: e.target.checked || undefined } : s))} />
            Nachbargrundstück (nur Darstellung, zählt nicht mit)
          </label>
        </>
      )}

      {shape.kind !== 'flaeche' && (
        <Field label="Raumumschließung (DIN 277)">
          <select value={shape.umschliessung} onChange={(e) => upd((s) => ({ ...s, umschliessung: e.target.value as Raumumschliessung }))}>
            {UMSCHLIESSUNG.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {shape.kind !== 'flaeche' && (
        <label className="toggle">
          <input type="checkbox" checked={shape.subtract} onChange={(e) => upd((s) => ({ ...s, subtract: e.target.checked }))} />
          Abzugsfläche (wird abgezogen, z. B. Innenhof, Schacht, Treppenloch)
        </label>
      )}

      {shape.kind === 'outline' && (
        <Field label="Abweichende Höhe für BRI [m]" hint={`leer = Geschosshöhe (${fmt2(storey.hoehe)} m)`}>
          <NumberField value={shape.hoehe} allowEmpty min={0} onChange={(v) => upd((s) => ({ ...s, hoehe: v }))} placeholder={fmt2(storey.hoehe)} />
        </Field>
      )}
      {shape.kind === 'outline' && <RoofEditor shape={shape} storey={storey} project={project} onChange={(dach) => upd((s) => (s.kind === 'outline' ? { ...s, dach } : s))} />}

      {shape.kind === 'room' && (
        <>
          <Field label="Nutzungsgruppe (DIN 277)">
            <select value={shape.nutzung} onChange={(e) => upd((s) => (s.kind === 'room' ? { ...s, nutzung: e.target.value as Nutzungsgruppe } : s))}>
              {NUTZUNGSGRUPPEN.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.kurz} – {n.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Putzabzug [%]" hint="z. B. 3 % bei Flächen aus Rohbaumaßen (wie Archicad-Zonen)">
            <NumberField
              value={shape.putzabzug}
              allowEmpty
              min={0}
              max={20}
              digits={1}
              onChange={(v) => upd((s) => (s.kind === 'room' ? { ...s, putzabzug: v || undefined } : s))}
            />
          </Field>
          <Field label="Aufenthaltsraum" hint="zählt bei Bebauungsplänen vor 1990 in Nicht-Vollgeschossen zur Geschossfläche">
            <select
              value={shape.aufenthalt ?? 'auto'}
              onChange={(e) => upd((s) => (s.kind === 'room' ? { ...s, aufenthalt: e.target.value === 'auto' ? undefined : (e.target.value as 'ja' | 'nein' | 'treppe') } : s))}
            >
              <option value="auto">automatisch ({AUFENTHALT_LABEL[istAufenthaltsraum({ ...shape, aufenthalt: undefined })]})</option>
              <option value="ja">Aufenthaltsraum</option>
              <option value="treppe">Treppenraum</option>
              <option value="nein">kein Aufenthaltsraum</option>
            </select>
          </Field>
          <h3>Wohnfläche (WoFlV)</h3>
          <Field label="Anrechnung">
            <select
              value={shape.wofl.kategorie}
              onChange={(e) => upd((s) => (s.kind === 'room' ? { ...s, wofl: { ...s.wofl, kategorie: e.target.value as WoflKategorie, faktor: undefined } } : s))}
            >
              {WOFL_KATEGORIEN.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          {(shape.wofl.kategorie === 'freisitz' || shape.wofl.kategorie === 'individuell') && (
            <Field label="Faktor" hint={shape.wofl.kategorie === 'freisitz' ? `leer = Projektstandard (${fmt2(project.settings.freisitzFaktor)}), max. 0,50` : '0 … 1'}>
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
                <TextField value={shape.wofl.wohnung} placeholder="z. B. WE 01" onChange={(v) => upd((s) => (s.kind === 'room' ? { ...s, wofl: { ...s.wofl, wohnung: v } } : s))} />
              </Field>
              <p className="muted">
                Anrechenbar: {fmt2(area * woflFaktor(shape.wofl, project.settings) * (shape.subtract ? -1 : 1))} m² (Faktor {fmt2(woflFaktor(shape.wofl, project.settings))})
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
                  <NumberField value={p.x} digits={3} onChange={(v) => v !== undefined && upd((s) => ({ ...s, points: s.points.map((q, j) => (j === i ? { ...q, x: v } : q)) }))} />
                </td>
                <td>
                  <NumberField value={p.y} digits={3} onChange={(v) => v !== undefined && upd((s) => ({ ...s, points: s.points.map((q, j) => (j === i ? { ...q, y: v } : q)) }))} />
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

/** Vollgeschoss: automatisch nach der maßgebenden Bauordnung oder festgelegt */
function VollgeschossFeld() {
  const storey = useActiveStorey();
  const project = useEditor((s) => s.project);
  const st = useEditor.getState();
  const pr = useMemo(
    () =>
      massNachweis({ ...project, storeys: project.storeys.map((s) => (s.id === storey.id ? { ...s, vollgeschoss: undefined } : s)) }).geschosse.find(
        (g) => g.storeyId === storey.id,
      ),
    [project, storey.id],
  );
  return (
    <Field label="Vollgeschoss" hint={pr ? pr.begruendung : undefined}>
      <select
        value={storey.vollgeschoss === undefined ? 'auto' : storey.vollgeschoss ? 'ja' : 'nein'}
        onChange={(e) => st.update((p) => mapStorey(p, storey.id, (s) => ({ ...s, vollgeschoss: e.target.value === 'auto' ? undefined : e.target.value === 'ja' })))}
      >
        <option value="auto">automatisch ({pr?.vollgeschoss ? 'Vollgeschoss' : 'kein Vollgeschoss'})</option>
        <option value="ja">Vollgeschoss</option>
        <option value="nein">kein Vollgeschoss</option>
      </select>
    </Field>
  );
}

function StoreyProperties() {
  const storey = useActiveStorey();
  const project = useEditor((s) => s.project);
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
      <label className="toggle block">
        <input type="checkbox" checked={!!storey.lageplan} onChange={(e) => upd((s) => ({ ...s, lageplan: e.target.checked || undefined }))} />
        Lageplan (kein Gebäudegeschoss: Flächen des Grundstücks für GRZ und Flächenbilanz)
      </label>
      {!storey.lageplan && <VollgeschossFeld />}
      {!storey.lageplan && (
        <Field label="Geschossart" hint="für Excel-Vorlagen: Normalgeschosse als Höhe × BGF, Dachgeschosse mit Dachformeln (Filter [normal] / [dg])">
          <select
            value={storey.dachgeschoss === undefined ? 'auto' : storey.dachgeschoss ? 'dg' : 'normal'}
            onChange={(e) => upd((s) => ({ ...s, dachgeschoss: e.target.value === 'auto' ? undefined : e.target.value === 'dg' }))}
          >
            <option value="auto">automatisch ({istDachgeschoss({ ...storey, dachgeschoss: undefined }) ? 'Dachgeschoss' : 'Normalgeschoss'})</option>
            <option value="normal">Normalgeschoss</option>
            <option value="dg">Dachgeschoss</option>
          </select>
        </Field>
      )}
      {project.dachModell && (
        <label className="toggle block" title="Ohne Haken reicht der Rauminhalt dort, wo darüber keine BGF liegt (z. B. Dachspitze als eigenes Geschoss), bis unter die Dachhaut.">
          <input type="checkbox" checked={!!storey.geschosshoeheBegrenzt} onChange={(e) => upd((s) => ({ ...s, geschosshoeheBegrenzt: e.target.checked || undefined }))} />
          BRI auf Geschosshöhe begrenzen (nicht bis unter die Dachhaut)
        </label>
      )}

      {storey.shapes.some((s) => s.kind === 'room') && (
        <div className="field">
          <span className="field-label">Wohnfläche aller Räume dieses Geschosses</span>
          <div className="button-row">
            <button
              title="Nach Raumname: Keller, Technik, Treppen, Garage, Dachboden … keine Wohnfläche; Balkon/Terrasse als Freisitz; übrige Räume anrechnen"
              onClick={() =>
                upd((s) => ({
                  ...s,
                  shapes: s.shapes.map((sh) => {
                    if (sh.kind !== 'room') return sh;
                    const art = woflArt(sh.name, s.name, sh.nutzung);
                    const wohnung = sh.wofl.wohnung || s.name;
                    if (art === 'keine') return { ...sh, wofl: { ...sh.wofl, kategorie: 'keine' as const } };
                    if (art === 'freisitz') return { ...sh, wofl: { ...sh.wofl, kategorie: 'freisitz' as const, wohnung } };
                    return sh.wofl.kategorie === 'keine' || sh.wofl.kategorie === 'freisitz'
                      ? { ...sh, wofl: { ...sh.wofl, kategorie: 'voll' as const, wohnung } }
                      : { ...sh, wofl: { ...sh.wofl, wohnung } };
                  }),
                }))
              }
            >
              automatisch nach Raumname
            </button>
            <button onClick={() => upd((s) => ({ ...s, shapes: s.shapes.map((sh) => (sh.kind === 'room' ? { ...sh, wofl: { ...sh.wofl, kategorie: 'keine' as const } } : sh)) }))}>
              keine
            </button>
          </div>
        </div>
      )}

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
