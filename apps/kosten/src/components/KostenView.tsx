import { useMemo, useState } from 'react';
import { fmt2 } from '@core/format';
import type { Kosten, KostenBezug, KostenPosition, KostenStufe } from '@core/model';
import { KOSTEN_STUFEN, newId } from '@core/model';
import { Field, NumberField, TextField } from '@core/ui/fields';
import { istKg, kg1, KG_ERSTE_EBENE, kgName, standardBezug } from '../din276';
import { gliederung, gliederungFuer } from '../katalog';
import type { Ergebnis, PositionErgebnis } from '../kosten';
import { berechne, euro, euroSpanne, standAus, stufeLabel, vergleiche } from '../kosten';
import type { MengenBezug } from '../mengen';
import { MENGEN_BEZUEGE, MENGEN_INFO } from '../mengen';
import { addPositionen, mapPosition, removePosition, setKosten, useKosten } from '../store';
import { useBauteile } from '../bauteile';

const zahl = (v: number, d = 2) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Massen- und Kostenermittlung: Grundlagen und Mengen, Positionen nach DIN 276, Übersicht mit Kostenständen */
export function KostenView({ onKatalog, onMenge }: { onKatalog: () => void; onMenge?: (b: MengenBezug) => void }) {
  const project = useKosten((s) => s.project);
  const waende = useBauteile((s) => s.waende);
  const e = useMemo(() => berechne(project, undefined, waende), [project, waende]);
  const k: Kosten = project.kosten ?? { positionen: [] };
  const st = useKosten.getState();
  const setK = (patch: Partial<Kosten>) => st.update((p) => setKosten(p, patch));

  return (
    <div className="ko-view">
      <section className="ko-col">
        <h2>Grundlagen</h2>
        <Field label="Projekt">
          <TextField value={project.name} onChange={(v) => st.update((p) => (v.trim() && v.trim() !== p.name ? { ...p, name: v.trim() } : p))} />
        </Field>
        <div className="field-row">
          <Field label="Stufe">
            <select value={k.stufe ?? 'schaetzung'} onChange={(ev) => setK({ stufe: ev.target.value as KostenStufe })}>
              {KOSTEN_STUFEN.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.lph})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Preisstand">
            <input type="date" value={k.datum ?? ''} onChange={(ev) => setK({ datum: ev.target.value || undefined })} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Baupreisindex Kennwerte" hint={k.katalog?.stand ? `Stand ${k.katalog.stand}` : 'zum Preisstand der Kennwerte'}>
            <NumberField value={k.indexBasis} allowEmpty min={0} digits={1} onChange={(v) => setK({ indexBasis: v })} />
          </Field>
          <Field label="Baupreisindex aktuell">
            <NumberField value={k.indexAktuell} allowEmpty min={0} digits={1} onChange={(v) => setK({ indexAktuell: v })} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Regionalfaktor" hint="1,000 = Bundesdurchschnitt">
            <NumberField value={k.regionalfaktor} allowEmpty min={0} digits={3} placeholder="1,000" onChange={(v) => setK({ regionalfaktor: v })} />
          </Field>
          <Field label="Umsatzsteuer [%]">
            <NumberField value={k.mwst} allowEmpty min={0} max={100} digits={0} placeholder="19" onChange={(v) => setK({ mwst: v })} />
          </Field>
        </div>
        <label className="toggle block">
          <input type="checkbox" checked={!!k.kennwerteBrutto} onChange={(ev) => setK({ kennwerteBrutto: ev.target.checked || undefined })} />
          Kennwerte enthalten die Umsatzsteuer (brutto)
        </label>
        <p className="muted small-text">
          Faktor auf die Kennwerte: <strong>{e.faktor.toLocaleString('de-DE', { maximumFractionDigits: 4 })}</strong>
          {k.katalog && (
            <>
              <br />
              Kennwerte: {k.katalog.name}
              {k.katalog.quelle ? ` (${k.katalog.quelle})` : ''}
              {k.katalog.stand ? `, Stand ${k.katalog.stand}` : ''}
            </>
          )}
        </p>

        <h2>Mengen</h2>
        <table className="ko-table">
          <tbody>
            {MENGEN_BEZUEGE.map((b) => (
              <MengeZeile key={b} b={b} e={e} onMenge={onMenge} />
            ))}
          </tbody>
        </table>
        <p className="muted small-text">
          Mengen kommen aus dem Projekt; ein eingetragener Wert gilt statt des abgeleiteten (leer = wieder abgeleitet).
          {onMenge && ' Ein Klick auf das Kürzel zeigt im Grundriss und im 3D-Modell, woraus sich die Menge zusammensetzt.'}
        </p>
      </section>

      <section className="ko-col ko-positionen">
        <h2>Positionen</h2>
        <div className="button-row">
          <button className="small" onClick={() => st.update((p) => addPositionen(p, [neuePosition('300')]))}>
            + Position
          </button>
          <button
            className="small"
            title="Leere Positionen der 1. Ebene (KG 300, 400, 500, 700) mit üblicher Bezugsgröße"
            onClick={() => st.update((p) => addPositionen(p, gliederung('grob')))}
          >
            Gliederung 1. Ebene
          </button>
          <button
            className="small"
            title="Leere Positionen der 2. Ebene für das Bauwerk (KG 310 … 450) mit Bauteilmengen"
            onClick={() => st.update((p) => addPositionen(p, gliederung('fein')))}
          >
            Gliederung 2. Ebene
          </button>
          <button className="small" onClick={onKatalog}>
            Aus Katalog …
          </button>
        </div>
        {!k.positionen.length ? (
          <p className="muted small-text">
            Noch keine Positionen. Für eine {stufeLabel(k.stufe)} passt die Gliederung {gliederungFuer(k.stufe) === 'grob' ? '1. Ebene (Kennwerte je m² BGF)' : '2. Ebene (Kennwerte je Bauteilmenge)'} –
            die Kennwerte trägst du ein oder übernimmst sie aus dem Kennwertkatalog.
          </p>
        ) : (
          <div className="tbl-wrap">
            <table className="ko-table ko-pos">
              <thead>
                <tr>
                  <th />
                  <th>KG</th>
                  <th>Bezeichnung</th>
                  <th>Bezug</th>
                  <th className="num">Menge</th>
                  <th className="num">von</th>
                  <th className="num">Mittel</th>
                  <th className="num">bis</th>
                  <th className="num">Kosten (Mittel)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {KG_ERSTE_EBENE.filter((g) => e.positionen.some((x) => kg1(x.pos.kg) === g)).map((g) => (
                  <Gruppe key={g} kg={g} e={e} />
                ))}
                {e.positionen
                  .filter((x) => !istKg(x.pos.kg))
                  .map((x) => (
                    <PositionZeile key={x.pos.id} x={x} />
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small-text">
          Kennwerte netto je Einheit (bei Bezug % der Prozentsatz, bei psch der Betrag). Fehlt „von“ oder „bis“, gilt der Mittelwert. Kosten = Menge × Kennwert × Faktor;
          Pauschalen und Prozentsätze werden nicht angepasst.
        </p>
      </section>

      <section className="ko-col ko-uebersicht">
        <Uebersicht e={e} k={k} />
      </section>
    </div>
  );
}

function neuePosition(kg: string): KostenPosition {
  const b = standardBezug(kg);
  return { id: newId('kp'), kg, bezeichnung: kgName(kg), bezug: b.bezug, ...(b.basis ? { basis: b.basis } : {}) };
}

function MengeZeile({ b, e, onMenge }: { b: MengenBezug; e: Ergebnis; onMenge?: (b: MengenBezug) => void }) {
  const info = MENGEN_INFO[b];
  const m = e.mengen[b];
  const st = useKosten.getState();
  const setMenge = (v: number | undefined) =>
    st.update((p) => {
      const mengen = { ...(p.kosten?.mengen ?? {}) };
      if (v === undefined) delete mengen[b];
      else mengen[b] = v;
      return setKosten(p, { mengen: Object.keys(mengen).length ? mengen : undefined });
    });
  return (
    <tr className={m.festgelegt ? 'festgelegt' : ''}>
      <td title={`${info.label}: ${info.ermittlung}`}>
        {onMenge ? (
          <button className="link" onClick={() => onMenge(b)} title={`${info.label} prüfen: ${info.ermittlung}`}>
            <strong>{info.kurz}</strong>
          </button>
        ) : (
          <strong>{info.kurz}</strong>
        )}{' '}
        <span className="muted small-text">{info.label}</span>
      </td>
      <td className="num ko-menge">
        <NumberField value={m.festgelegt ? m.wert : undefined} allowEmpty min={0} digits={b === 'we' ? 0 : 2} placeholder={b === 'we' ? String(m.abgeleitet) : fmt2(m.abgeleitet)} onChange={setMenge} />
      </td>
      <td className="muted small-text">{info.einheit}</td>
    </tr>
  );
}

function Gruppe({ kg, e }: { kg: string; e: Ergebnis }) {
  const summe = e.summen.find((s) => s.kg === kg);
  return (
    <>
      <tr className="ko-gruppe">
        <td />
        <td>{kg}</td>
        <td colSpan={6}>{kgName(kg)}</td>
        <td className="num">{summe ? euro(summe.summe[1]) : ''}</td>
        <td />
      </tr>
      {e.positionen
        .filter((x) => kg1(x.pos.kg) === kg)
        .map((x) => (
          <PositionZeile key={x.pos.id} x={x} />
        ))}
    </>
  );
}

const BEZUG_OPTIONEN: { id: KostenBezug; label: string }[] = [
  ...MENGEN_BEZUEGE.map((b) => ({ id: b as KostenBezug, label: `${MENGEN_INFO[b].einheit} ${MENGEN_INFO[b].kurz}` })),
  { id: 'menge', label: 'eigene Menge' },
  { id: 'pauschal', label: 'pauschal' },
  { id: 'prozent', label: '% von KG' },
];

function PositionZeile({ x }: { x: PositionErgebnis }) {
  const st = useKosten.getState();
  const p = x.pos;
  const upd = (patch: Partial<KostenPosition>) => st.update((pr) => mapPosition(pr, p.id, (q) => ({ ...q, ...patch })));
  const setKg = (kg: string) => {
    const neu = kg.trim();
    const patch: Partial<KostenPosition> = { kg: neu };
    // Bezeichnung und Bezug mitführen, solange sie noch der alten Kostengruppe entsprechen
    if (!p.bezeichnung || p.bezeichnung === kgName(p.kg)) patch.bezeichnung = kgName(neu) || p.bezeichnung;
    if (p.von === undefined && p.mittel === undefined && p.bis === undefined) {
      const b = standardBezug(neu);
      patch.bezug = b.bezug;
      patch.basis = b.basis;
    }
    upd(patch);
  };
  return (
    <tr className={`${p.aus ? 'aus' : ''}${x.hinweis && x.aktiv ? ' warn' : ''}`}>
      <td>
        <input type="checkbox" checked={!p.aus} title="Position rechnen" onChange={(ev) => upd({ aus: ev.target.checked ? undefined : true })} />
      </td>
      <td className="ko-kg">
        <TextField value={p.kg} onChange={setKg} />
      </td>
      <td>
        <TextField value={p.bezeichnung} onChange={(v) => upd({ bezeichnung: v })} />
        {p.quelle && <div className="muted small-text">{p.quelle}</div>}
      </td>
      <td>
        <select value={p.bezug} onChange={(ev) => upd({ bezug: ev.target.value as KostenBezug, ...(ev.target.value === 'prozent' && !p.basis ? { basis: ['300', '400'] } : {}) })}>
          {BEZUG_OPTIONEN.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {p.bezug === 'prozent' && (
          <div className="ko-basis" title="Kostengruppen, auf deren Summe sich der Prozentsatz bezieht">
            von KG <TextField value={(p.basis ?? []).join(' + ')} onChange={(v) => upd({ basis: v.split(/[\s,+;]+/).filter(Boolean) })} />
          </div>
        )}
        {p.bezug === 'menge' && (
          <div className="ko-basis">
            Einheit <TextField value={p.einheit ?? ''} placeholder="Stk" onChange={(v) => upd({ einheit: v || undefined })} />
          </div>
        )}
      </td>
      <td className="num">
        {p.bezug === 'menge' ? (
          <NumberField value={p.menge} allowEmpty min={0} onChange={(v) => upd({ menge: v })} />
        ) : p.bezug === 'pauschal' ? (
          '1 psch'
        ) : p.bezug === 'prozent' ? (
          <span title="Grundlage (Mittel)">{euro(x.menge)}</span>
        ) : (
          `${fmt2(x.menge)} ${x.einheit}`
        )}
      </td>
      {(['von', 'mittel', 'bis'] as const).map((f) => (
        <td key={f} className="num ko-kw">
          <NumberField value={p[f]} allowEmpty min={0} onChange={(v) => upd({ [f]: v })} />
        </td>
      ))}
      <td className="num">
        <strong>{euro(x.kosten[1])}</strong>
        {x.kosten[0] !== x.kosten[2] && <div className="muted small-text">{euroSpanne(x.kosten)}</div>}
        {x.hinweis && x.aktiv && <div className="warning small-text">{x.hinweis}</div>}
      </td>
      <td>
        <button className="small danger" title="Position löschen" onClick={() => st.update((pr) => removePosition(pr, p.id))}>
          ×
        </button>
      </td>
    </tr>
  );
}

function Uebersicht({ e, k }: { e: Ergebnis; k: Kosten }) {
  const st = useKosten.getState();
  const [bemerkung, setBemerkung] = useState('');
  const staende = k.staende ?? [];
  const [vergleichId, setVergleichId] = useState<string | null>(null);
  const vergleich = staende.find((s) => s.id === vergleichId) ?? staende[staende.length - 1];
  const v = vergleich ? vergleiche(vergleich, e) : null;
  const festhalten = () => {
    const s = standAus(e, k.stufe ?? 'schaetzung', bemerkung.trim());
    st.update((p) => setKosten(p, { staende: [...(p.kosten?.staende ?? []), s] }));
    setBemerkung('');
    setVergleichId(s.id);
  };

  return (
    <>
      <h2>{stufeLabel(k.stufe)}</h2>
      <table className="ko-table">
        <thead>
          <tr>
            <th>KG</th>
            <th className="num">von</th>
            <th className="num">Mittel</th>
            <th className="num">bis</th>
          </tr>
        </thead>
        <tbody>
          {e.summen.map((s) => (
            <tr key={s.kg} className={s.ebene === 1 ? 'ko-kg1' : 'ko-kg2'}>
              <td title={s.name}>
                {s.kg} {s.name}
              </td>
              <td className="num">{euro(s.summe[0])}</td>
              <td className="num">{euro(s.summe[1])}</td>
              <td className="num">{euro(s.summe[2])}</td>
            </tr>
          ))}
          <tr className="sum">
            <td>Gesamt netto</td>
            <td className="num">{euro(e.gesamtNetto[0])}</td>
            <td className="num">{euro(e.gesamtNetto[1])}</td>
            <td className="num">{euro(e.gesamtNetto[2])}</td>
          </tr>
          <tr>
            <td>+ {e.mwst} % USt.</td>
            <td className="num">{euro(e.gesamtBrutto[0] - e.gesamtNetto[0])}</td>
            <td className="num">{euro(e.gesamtBrutto[1] - e.gesamtNetto[1])}</td>
            <td className="num">{euro(e.gesamtBrutto[2] - e.gesamtNetto[2])}</td>
          </tr>
          <tr className="sum">
            <td>Gesamt brutto</td>
            <td className="num">{euro(e.gesamtBrutto[0])}</td>
            <td className="num">{euro(e.gesamtBrutto[1])}</td>
            <td className="num">{euro(e.gesamtBrutto[2])}</td>
          </tr>
        </tbody>
      </table>

      {e.kennwerte.length > 0 && (
        <>
          <h3>Kennwerte Bauwerk (KG 300 + 400, brutto)</h3>
          <table className="ko-table">
            <tbody>
              {e.kennwerte.map((kw) => (
                <tr key={kw.kurz}>
                  <td>
                    € / {kw.einheit} {kw.kurz}
                  </td>
                  <td className="num">
                    <strong>{zahl(kw.wert[1], 0)}</strong>
                    {Math.round(kw.wert[0]) !== Math.round(kw.wert[2]) && (
                      <span className="muted small-text">
                        {' '}
                        ({zahl(kw.wert[0], 0)} – {zahl(kw.wert[2], 0)})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {e.hinweise.length > 0 && (
        <>
          <h3>Hinweise</h3>
          <ul className="ko-hinweise">
            {e.hinweise.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </>
      )}

      <h3>Kostenstände</h3>
      <div className="ko-stand-neu">
        <TextField value={bemerkung} placeholder="Bemerkung, z. B. „Entwurf Variante A“" onChange={setBemerkung} />
        <button className="small" onClick={festhalten} title="Aktuelle Kosten und Mengen als Stand festhalten – für Historie und Vorher/Nachher">
          Stand festhalten
        </button>
      </div>
      {staende.length > 0 && (
        <table className="ko-table">
          <tbody>
            {[...staende].reverse().map((s) => (
              <tr key={s.id} className={s.id === vergleich?.id ? 'selected' : ''}>
                <td>
                  <button className="link" onClick={() => setVergleichId(s.id)} title="Mit diesem Stand vergleichen">
                    {new Date(s.datum).toLocaleDateString('de-DE')} · {stufeLabel(s.stufe)}
                  </button>
                  {s.bemerkung && <div className="muted small-text">{s.bemerkung}</div>}
                </td>
                <td className="num">{euro(s.gesamtBrutto[1])}</td>
                <td>
                  <button className="small danger" title="Stand löschen" onClick={() => st.update((p) => setKosten(p, { staende: (p.kosten?.staende ?? []).filter((x) => x.id !== s.id) }))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {v && vergleich && (
        <>
          <h3>
            Vorher/Nachher gegenüber {new Date(vergleich.datum).toLocaleDateString('de-DE')} (Mittel, netto)
          </h3>
          <table className="ko-table">
            <tbody>
              {[...v.zeilen, v.gesamt].map((z) => (
                <tr key={z.kg || 'gesamt'} className={z.kg ? '' : 'sum'}>
                  <td>{z.kg ? `${z.kg} ${z.name}` : z.name}</td>
                  <td className="num">{euro(z.vorher)}</td>
                  <td className="num">{euro(z.jetzt)}</td>
                  <td className={`num ${z.differenz > 0.5 ? 'mehr' : z.differenz < -0.5 ? 'weniger' : ''}`}>
                    {z.differenz > 0.5 ? '+' : ''}
                    {euro(z.differenz)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.mengen.length > 0 && (
            <p className="small-text">
              Geänderte Mengen:{' '}
              {v.mengen.map((mm) => `${MENGEN_INFO[mm.bezug].kurz} ${fmt2(mm.vorher)} → ${fmt2(mm.jetzt)} ${MENGEN_INFO[mm.bezug].einheit}`).join(' · ')}
            </p>
          )}
        </>
      )}
      <p className="muted small-text">
        Die Kennwerte sind Eingaben des Anwenders; das Tool rechnet transparent mit den hinterlegten Werten und liefert keine Preise. Preisstand und regionale Faktoren sind
        dokumentiert.
      </p>
    </>
  );
}
