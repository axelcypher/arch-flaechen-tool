import { useMemo } from 'react';
import { fmt2 } from '../core/format';
import type { Point } from '../core/geometry';
import { bounds } from '../core/geometry';
import { LAGEPLAN_NUTZUNGEN, nutzungLabel, VERSIEGELUNGEN, versiegelungInfo } from '../core/lageplan';
import type { Anrechnung, Kennzahl, Nachweis, Status } from '../core/massNutzung';
import { anrechnungRegel, BAUNVO_FASSUNGEN, BAUO_FASSUNGEN, baunvoLabel, bauoLabel, massNachweis, recht } from '../core/massNutzung';
import type { BauNVOFassung, BauOFassung, FlaecheShape, LageplanNutzung, MassNutzung, Versiegelung } from '../core/model';
import { createStorey } from '../core/model';
import { mapShape, useEditor } from '../store/store';
import { Field, NumberField } from './fields';

/**
 * Tab „GRZ/GFZ“: Festsetzungen des Bebauungsplans, Lageplan mit Flächen und der Nachweis
 * nach der für das Plandatum maßgebenden BauNVO und Bauordnung NRW.
 */
export function GrzGfzView() {
  const project = useEditor((s) => s.project);
  const n = useMemo(() => massNachweis(project), [project]);
  const m = project.massNutzung ?? {};
  const st = useEditor.getState();
  const setM = (patch: Partial<MassNutzung>) =>
    st.update((p) => {
      const next: MassNutzung = { ...(p.massNutzung ?? {}), ...patch };
      for (const k of Object.keys(next) as (keyof MassNutzung)[]) if (next[k] === undefined) delete next[k];
      return { ...p, massNutzung: next };
    });
  const auto = recht({ ...m, baunvo: undefined, bauo: undefined });
  const lageplan = project.storeys.find((s) => s.lageplan);
  const flaechen = project.storeys.filter((s) => s.lageplan).flatMap((s) => s.shapes.filter((x): x is FlaecheShape => x.kind === 'flaeche').map((f) => ({ f, storeyId: s.id })));
  const offeneNutzungen = LAGEPLAN_NUTZUNGEN.filter((x) => anrechnungRegel(x.id, n.recht.baunvo) === 'pruefen' && flaechen.some(({ f }) => !f.nachbar && f.nutzung === x.id));

  const lageplanAnlegen = () => {
    const lp = createStorey('Lageplan', 0);
    lp.lageplan = true;
    lp.elevation = Math.min(0, ...project.storeys.map((s) => s.elevation ?? 0));
    st.update((p) => ({ ...p, storeys: [lp, ...p.storeys] }));
    st.setActiveStorey(lp.id);
    st.setMainView('2d');
  };
  const imGrundriss = (storeyId: string, shapeId?: string) => {
    st.setActiveStorey(storeyId);
    if (shapeId) st.select(shapeId);
    st.setMainView('2d');
  };
  const updFlaeche = (storeyId: string, id: string, patch: Partial<FlaecheShape>) => st.update((p) => mapShape(p, storeyId, id, (s) => (s.kind === 'flaeche' ? { ...s, ...patch } : s)));

  return (
    <div className="grz-view">
      <section className="grz-col grz-fest">
        <h2>Festsetzungen</h2>
        <Field label="Bebauungsplan in Kraft seit" hint="leer = aktuelles Recht (§ 34/35 BauGB)">
          <input type="date" value={m.planDatum ?? ''} onChange={(e) => setM({ planDatum: e.target.value || undefined })} />
        </Field>
        <Field label="BauNVO-Fassung">
          <select value={m.baunvo ?? 'auto'} onChange={(e) => setM({ baunvo: e.target.value === 'auto' ? undefined : (e.target.value as BauNVOFassung) })}>
            <option value="auto">automatisch ({baunvoLabel(auto.baunvo)})</option>
            {BAUNVO_FASSUNGEN.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} ({f.zeitraum})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vollgeschossbegriff">
          <select value={m.bauo ?? 'auto'} onChange={(e) => setM({ bauo: e.target.value === 'auto' ? undefined : (e.target.value as BauOFassung) })}>
            <option value="auto">automatisch ({bauoLabel(auto.bauo)})</option>
            {BAUO_FASSUNGEN.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} ({f.zeitraum})
              </option>
            ))}
          </select>
        </Field>
        <div className="field-row">
          <Field label="GRZ zulässig">
            <NumberField value={m.grz} allowEmpty min={0} max={1} onChange={(v) => setM({ grz: v })} />
          </Field>
          <Field label="GFZ zulässig">
            <NumberField value={m.gfz} allowEmpty min={0} max={10} onChange={(v) => setM({ gfz: v })} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Vollgeschosse höchstens">
            <NumberField value={m.vollgeschosseMax} allowEmpty min={0} max={40} digits={0} onChange={(v) => setM({ vollgeschosseMax: v === undefined ? undefined : Math.round(v) })} />
          </Field>
          {n.recht.baunvo === '1990' && (
            <Field label="GRZ II höchstens" hint="leer = 1,5 × GRZ, max. 0,8">
              <NumberField value={m.grzIIMax} allowEmpty min={0} max={1} onChange={(v) => setM({ grzIIMax: v })} />
            </Field>
          )}
        </div>
        <Field label="Grundstücksfläche [m²]" hint={n.grundstueck.ausLageplan !== undefined ? `aus dem Lageplan: ${fmt2(n.grundstueck.ausLageplan)} m²` : 'wie in den Projektdaten'}>
          <NumberField
            value={project.meta.grundstueck.flaeche}
            allowEmpty
            min={0}
            placeholder={n.grundstueck.ausLageplan !== undefined ? fmt2(n.grundstueck.ausLageplan) : ''}
            onChange={(v) => st.update((p) => ({ ...p, meta: { ...p.meta, grundstueck: { ...p.meta.grundstueck, flaeche: v } } }))}
          />
        </Field>
        <Field
          label={n.recht.bauo === 'nw1962' ? 'festgelegte Geländeoberfläche [m]' : 'Geländeoberfläche [m]'}
          hint={m.gelaende === undefined ? (n.gelaende.quelle === 'lageplan' ? `aus dem Lageplan: ${fmt2(n.gelaende.hoehe)} m` : 'unbekannt: ±0,00 angenommen') : 'über ±0,00'}
        >
          <NumberField value={m.gelaende} allowEmpty placeholder={fmt2(n.gelaende.hoehe)} onChange={(v) => setM({ gelaende: v })} />
        </Field>
        <div className="field-row">
          <Field label="Dachaufbau [m]" hint="lichte Höhe = Dachhaut − Aufbau">
            <NumberField value={m.dachaufbau} allowEmpty min={0} max={2} placeholder="0,30" onChange={(v) => setM({ dachaufbau: v })} />
          </Field>
          {n.recht.baunvo !== '1990' && (
            <Field label="Wandzuschlag [m]" hint="Umfassungswände der Aufenthaltsräume">
              <NumberField value={m.wandzuschlag} allowEmpty min={0} max={2} placeholder="0,25" onChange={(v) => setM({ wandzuschlag: v })} />
            </Field>
          )}
        </div>
        {n.recht.bauo === 'nw1962' && (
          <label className="toggle block">
            <input type="checkbox" checked={!!m.einfamilienhaus} onChange={(e) => setM({ einfamilienhaus: e.target.checked || undefined })} />
            Einfamilienhaus (lichte Höhe für Aufenthaltsräume 2,30 statt 2,50 m)
          </label>
        )}
        {offeneNutzungen.length > 0 && (
          <>
            <h3>Einstufung offener Fälle</h3>
            <p className="muted small-text">{baunvoLabel(n.recht.baunvo)} regelt diese Nutzungen nicht eindeutig. Mit der Bauaufsicht klären und hier festlegen.</p>
            {offeneNutzungen.map((x) => (
              <Field key={x.id} label={x.label}>
                <select
                  value={m.einstufung?.[x.id] ?? 'offen'}
                  onChange={(e) => {
                    const einstufung = { ...(m.einstufung ?? {}) };
                    if (e.target.value === 'offen') delete einstufung[x.id];
                    else einstufung[x.id] = e.target.value as 'ja' | 'nein';
                    setM({ einstufung });
                  }}
                >
                  <option value="offen">offen – ohne und mit rechnen</option>
                  <option value="ja">zählt zur Grundfläche</option>
                  <option value="nein">zählt nicht</option>
                </select>
              </Field>
            ))}
          </>
        )}
      </section>

      <section className="grz-col grz-plan">
        <div className="section-head">
          <h2>Lageplan</h2>
          {lageplan ? (
            <button className="small" onClick={() => imGrundriss(lageplan.id)}>
              Im Grundriss bearbeiten
            </button>
          ) : (
            <button className="small" onClick={lageplanAnlegen}>
              Lageplan-Geschoss anlegen
            </button>
          )}
        </div>
        <LageplanSkizze n={n} flaechen={flaechen.map((x) => x.f)} />
        {!flaechen.length && (
          <p className="muted small-text">
            Noch keine Lageplan-Flächen. Beim IFC-Import kommen sie aus dem Geschoss „Lageplan“ und dem Gelände; sonst ein Lageplan-Geschoss anlegen und Zufahrten, Stellplätze,
            Terrassen und Grünflächen einzeichnen.
          </p>
        )}
        {flaechen.length > 0 && (
          <div className="tbl-wrap">
            <table className="grz-table">
              <thead>
                <tr>
                  <th>Fläche</th>
                  <th>Nutzung</th>
                  <th>Versiegelung</th>
                  <th className="num">m²</th>
                  <th>Grundfläche</th>
                </tr>
              </thead>
              <tbody>
                {flaechen.map(({ f, storeyId }) => {
                  const post = n.lageplan.find((x) => x.id === f.id);
                  return (
                    <tr key={f.id} className={f.nachbar ? 'nachbar' : ''}>
                      <td>
                        <button className="link" onClick={() => imGrundriss(storeyId, f.id)} title="Im Grundriss zeigen">
                          {f.name || 'Fläche'}
                        </button>
                        <label className="toggle small-text">
                          <input type="checkbox" checked={!!f.nachbar} onChange={(e) => updFlaeche(storeyId, f.id, { nachbar: e.target.checked || undefined })} />
                          Nachbar
                        </label>
                      </td>
                      <td>
                        <select value={f.nutzung} disabled={f.nachbar} onChange={(e) => updFlaeche(storeyId, f.id, { nutzung: e.target.value as LageplanNutzung })}>
                          {LAGEPLAN_NUTZUNGEN.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select value={f.versiegelung} disabled={f.nachbar} onChange={(e) => updFlaeche(storeyId, f.id, { versiegelung: e.target.value as Versiegelung })}>
                          {VERSIEGELUNGEN.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num">{fmt2(post?.flaeche ?? 0)}</td>
                      <td>{f.nachbar ? <span className="muted small-text">Nachbar</span> : <AnrechnungPill a={post?.anrechnung ?? 'nein'} baunvo={n.recht.baunvo} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grz-col grz-nachweis">
        <h2>Nachweis</h2>
        <p className="muted small-text">
          {baunvoLabel(n.recht.baunvo)} · Vollgeschosse nach {bauoLabel(n.recht.bauo)}
          {n.grundstueck.flaeche !== undefined && ` · Grundstück ${fmt2(n.grundstueck.flaeche)} m²${n.grundstueck.quelle === 'lageplan' ? ' (aus dem Lageplan)' : ''}`}
        </p>
        <div className="kpis">
          <KpiZeile titel={n.recht.baunvo === '1990' ? 'GRZ I' : 'GRZ'} k={n.grz} einheit="Grundfläche" flaeche={n.grz.wert * (n.grundstueck.flaeche ?? 0)} />
          {n.grz2 && <KpiZeile titel="GRZ II" k={n.grz2} einheit="mit § 19 Abs. 4" flaeche={n.grz2.wert * (n.grundstueck.flaeche ?? 0)} />}
          <KpiZeile titel="GFZ" k={n.gfz} einheit="Geschossfläche" flaeche={n.gf} />
          <div className="kpi">
            <div className="kpi-head">
              <span>Vollgeschosse</span>
              <StatusPill s={n.vollgeschosse.status} />
            </div>
            <div className="kpi-value">{roemisch(n.vollgeschosse.anzahl)}</div>
            <div className="kpi-sub">
              {n.vollgeschosse.zulaessig !== undefined ? `zulässig ${roemisch(n.vollgeschosse.zulaessig)} · ` : ''}
              {n.geschosse.filter((g) => g.vollgeschoss).map((g) => g.name).join(', ') || 'keine'}
            </div>
          </div>
        </div>
        {n.garagenFrei !== undefined && n.garagenFrei > 0 && (
          <p className="small-text">Garagen und überdachte Stellplätze: {fmt2(n.garagenFrei)} m² anrechnungsfrei (§ 21a Abs. 3, bis 0,1 der Grundstücksfläche).</p>
        )}

        <h3>Vollgeschosse</h3>
        <table className="grz-table">
          <thead>
            <tr>
              <th>Geschoss</th>
              <th className="num">über Gelände</th>
              <th className="num">Anteil</th>
              <th>Ergebnis</th>
            </tr>
          </thead>
          <tbody>
            {n.geschosse.map((g) => (
              <tr key={g.storeyId} title={g.begruendung}>
                <td>{g.name}</td>
                <td className="num">{fmt2(g.ueberGelaende)} m</td>
                <td className="num">{g.oberirdisch ? `${Math.round(g.anteil * 100)} %` : '–'}</td>
                <td>
                  {g.vollgeschoss ? 'Vollgeschoss' : 'kein Vollgeschoss'}
                  {!g.automatisch && <span className="muted small-text"> (festgelegt)</span>}
                  <div className="muted small-text">{g.begruendung}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Geschossfläche</h3>
        <table className="grz-table">
          <tbody>
            {n.gfJeGeschoss.map((g) => (
              <tr key={g.storeyId}>
                <td>{g.name}</td>
                <td className="muted small-text">{g.art === 'vollgeschoss' ? 'Vollgeschoss, Außenmaße (ohne Balkone, Loggien, Terrassen)' : g.art === 'aufenthalt' ? 'Aufenthaltsräume mit Treppenräumen und Umfassungswänden' : 'zählt nicht'}</td>
                <td className="num">{fmt2(g.flaeche)} m²</td>
              </tr>
            ))}
            <tr className="sum">
              <td>Summe</td>
              <td />
              <td className="num">{fmt2(n.gf)} m²</td>
            </tr>
          </tbody>
        </table>

        {flaechen.some(({ f }) => !f.nachbar) && (
          <>
            <h3>Flächenbilanz</h3>
            <table className="grz-table">
              <tbody>
                <tr>
                  <td>Gebäude</td>
                  <td className="num">{fmt2(n.bilanz.gebaeude)} m²</td>
                </tr>
                {VERSIEGELUNGEN.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <span className="swatch" style={{ background: v.color }} /> {v.label}
                    </td>
                    <td className="num">{fmt2(n.bilanz[v.id])} m²</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td>Summe</td>
                  <td className="num">{fmt2(n.bilanz.summe)} m²</td>
                </tr>
                {n.bilanz.differenz !== undefined && Math.abs(n.bilanz.differenz) > 0.5 && (
                  <tr>
                    <td className="warning">nicht erfasst bzw. überlappend</td>
                    <td className="num warning">{fmt2(n.bilanz.differenz)} m²</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {n.hinweise.length > 0 && (
          <>
            <h3>Hinweise</h3>
            <ul className="grz-hinweise">
              {n.hinweise.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </>
        )}
        <p className="muted small-text">Das Tool rechnet nach und zeigt die angewandte Fassung; die Verantwortung für den Nachweis bleibt bei der Entwurfsverfasserin bzw. dem Entwurfsverfasser.</p>
      </section>
    </div>
  );
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  ok: { label: 'eingehalten', cls: 'ok' },
  ueberschritten: { label: 'überschritten', cls: 'bad' },
  pruefen: { label: 'prüfen', cls: 'warn' },
  offen: { label: 'Festsetzung fehlt', cls: 'off' },
};

function StatusPill({ s }: { s: Status }) {
  return <span className={`pill ${STATUS[s].cls}`}>{STATUS[s].label}</span>;
}

const ANRECHNUNG: Record<Anrechnung, string> = {
  hauptanlage: 'zählt',
  grz2: 'GRZ II',
  garage01: 'bis 0,1 frei',
  nein: 'zählt nicht',
  pruefen: 'prüfen',
};

function AnrechnungPill({ a, baunvo }: { a: Anrechnung; baunvo: BauNVOFassung }) {
  const cls = a === 'pruefen' ? 'warn' : a === 'nein' ? 'off' : 'ok';
  return (
    <span className={`pill ${cls}`} title={`${baunvoLabel(baunvo)}`}>
      {ANRECHNUNG[a]}
    </span>
  );
}

const zahl = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function KpiZeile({ titel, k, einheit, flaeche }: { titel: string; k: Kennzahl; einheit: string; flaeche: number }) {
  return (
    <div className={`kpi${k.status === 'ueberschritten' ? ' alarm' : ''}`}>
      <div className="kpi-head">
        <span>{titel}</span>
        <StatusPill s={k.status} />
      </div>
      <div className="kpi-value" title={k.wert.toLocaleString('de-DE', { maximumFractionDigits: 4 })}>
        {zahl(k.wert)}
        {k.mitOffenen !== undefined && <small> bis {zahl(k.mitOffenen)}</small>}
      </div>
      <div className="kpi-sub">
        {einheit} {fmt2(flaeche)} m²
        {k.zulaessig !== undefined && ` · zulässig ${zahl(k.zulaessig)}`}
        {k.reserve !== undefined && ` · ${k.reserve >= 0 ? 'Reserve' : 'zu viel'} ${fmt2(Math.abs(k.reserve))} m²`}
      </div>
    </div>
  );
}

function roemisch(n: number): string {
  const r = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return n >= 0 && n <= 10 ? r[n] || '0' : String(n);
}

/** Lageplan-Skizze: Grundstück, Flächen nach Versiegelung, Gebäude schraffiert */
function LageplanSkizze({ n, flaechen }: { n: Nachweis; flaechen: FlaecheShape[] }) {
  const alle: Point[] = [...n.hauptanlagePolygone.flat(), ...flaechen.flatMap((f) => f.points)];
  if (!alle.length) return <div className="grz-skizze empty muted small-text">Noch kein Gebäude und kein Lageplan.</div>;
  const b = bounds(alle);
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.05 + 0.5;
  const vb = `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  const sw = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 400;
  const d = (pts: Point[]) => `M${pts.map((p) => `${p.x} ${p.y}`).join('L')}Z`;
  return (
    <svg className="grz-skizze" viewBox={vb} preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="grz-hatch" width={sw * 8} height={sw * 8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={sw * 8} stroke="#2a5bd7" strokeWidth={sw * 2} strokeOpacity={0.5} />
        </pattern>
      </defs>
      {flaechen.map((f) => (
        <path
          key={f.id}
          d={d(f.points)}
          fill={versiegelungInfo(f.versiegelung).color}
          fillOpacity={f.nachbar ? 0.15 : 0.55}
          stroke={f.nachbar ? '#9aa0a6' : '#5b6068'}
          strokeWidth={sw}
          strokeDasharray={f.nachbar ? `${sw * 4} ${sw * 3}` : undefined}
        >
          <title>{`${f.name} · ${nutzungLabel(f.nutzung)} · ${versiegelungInfo(f.versiegelung).label}${f.nachbar ? ' · Nachbar' : ''}`}</title>
        </path>
      ))}
      {n.hauptanlagePolygone.map((pts, i) => (
        <path key={`h${i}`} d={d(pts)} fill="url(#grz-hatch)" stroke="#1d3f96" strokeWidth={sw * 2} fillRule="evenodd" />
      ))}
      {n.grundstueckPolygone.map((pts, i) => (
        <path key={`g${i}`} d={d(pts)} fill="none" stroke="#1f2328" strokeWidth={sw * 2.5} strokeDasharray={`${sw * 10} ${sw * 3} ${sw * 2} ${sw * 3}`} />
      ))}
    </svg>
  );
}
