import { useMemo, useState } from 'react';
import { fmt2 } from '@core/format';
import type { Spanne } from '@core/model';
import { anschriftEinzeilig, flurText, KOSTEN_STUFEN } from '@core/model';
import { istKg, kg1, KG_ERSTE_EBENE, kgName } from '../din276';
import type { PositionErgebnis } from '../kosten';
import { berechne, bezugLabel, euro, HAFTUNG, katalogText, stufeLabel } from '../kosten';
import { MENGEN_BEZUEGE, MENGEN_INFO } from '../mengen';
import { useKosten } from '../store';

const zahl = (v: number, d = 2) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const datum = (iso: string) => new Date(iso).toLocaleDateString('de-DE');

/** Druckbare Kostenermittlung nach DIN 276 – über den Druckdialog auch als PDF. */
export function KostenDruck({ onClose }: { onClose: () => void }) {
  const project = useKosten((s) => s.project);
  const e = useMemo(() => berechne(project), [project]);
  const [positionen, setPositionen] = useState(true);
  const [mengen, setMengen] = useState(true);
  const [staende, setStaende] = useState(true);
  const k = project.kosten ?? { positionen: [] };
  const stufe = KOSTEN_STUFEN.find((s) => s.id === (k.stufe ?? 'schaetzung'));
  const heute = new Date().toLocaleDateString('de-DE');
  const aktiv = e.positionen.filter((x) => x.aktiv);
  const bandbreite = Math.round(e.gesamtNetto[0]) !== Math.round(e.gesamtNetto[2]);
  const gezeigteMengen = MENGEN_BEZUEGE.filter((b) => e.mengen[b].wert > 0);

  return (
    <div className="report-backdrop">
      <div className="report ko-report">
        <div className="report-actions no-print">
          <label className="toggle">
            <input type="checkbox" checked={positionen} onChange={(ev) => setPositionen(ev.target.checked)} />
            Positionen
          </label>
          <label className="toggle">
            <input type="checkbox" checked={mengen} onChange={(ev) => setMengen(ev.target.checked)} />
            Mengen
          </label>
          {(k.staende?.length ?? 0) > 0 && (
            <label className="toggle">
              <input type="checkbox" checked={staende} onChange={(ev) => setStaende(ev.target.checked)} />
              Kostenstände
            </label>
          )}
          <button onClick={() => window.print()}>Drucken / PDF</button>
          <button className="primary" onClick={onClose}>
            Schließen
          </button>
        </div>

        <header className="report-header">
          <h1>
            {stufeLabel(k.stufe ?? 'schaetzung')} nach DIN 276{stufe ? ` (${stufe.lph})` : ''}
          </h1>
          <div className="report-meta">
            <div>
              {project.meta.projektcode && <>{project.meta.projektcode} · </>}
              <strong>{project.name}</strong>
            </div>
            {anschriftEinzeilig(project.meta.adresse) && <div>{anschriftEinzeilig(project.meta.adresse)}</div>}
            {flurText(project.meta.grundstueck) && <div>{flurText(project.meta.grundstueck)}</div>}
            {project.meta.bauherr.name && <div>Bauherr: {project.meta.bauherr.name}</div>}
            <div>
              {project.meta.bearbeiter && <>Bearbeiter: {project.meta.bearbeiter} · </>}Stand: {heute}
            </div>
          </div>
        </header>

        <h2>Grundlagen</h2>
        <table className="report-table narrow">
          <tbody>
            <tr>
              <td>Preisstand</td>
              <td>{k.datum ? datum(k.datum) : 'nicht angegeben'}</td>
            </tr>
            <tr>
              <td>Kennwerte</td>
              <td>{katalogText(k.katalog) || 'eigene Eingaben'}</td>
            </tr>
            {k.indexBasis !== undefined && k.indexAktuell !== undefined && (
              <tr>
                <td>Baupreisindex</td>
                <td>
                  {zahl(k.indexBasis, 1)} (Stand der Kennwerte) → {zahl(k.indexAktuell, 1)} (aktuell)
                </td>
              </tr>
            )}
            {k.regionalfaktor !== undefined && (
              <tr>
                <td>Regionalfaktor</td>
                <td>{zahl(k.regionalfaktor, 3)}</td>
              </tr>
            )}
            <tr>
              <td>Faktor auf die Kennwerte</td>
              <td>{e.faktor.toLocaleString('de-DE', { maximumFractionDigits: 4 })}</td>
            </tr>
            <tr>
              <td>Umsatzsteuer</td>
              <td>
                {e.mwst} %{k.kennwerteBrutto ? ' – die Kennwerte enthalten die Umsatzsteuer und wurden auf netto umgerechnet' : ' – Kennwerte netto'}
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Kostenübersicht</h2>
        <table className="report-table">
          <thead>
            <tr>
              <th>KG</th>
              <th>Kostengruppe</th>
              {bandbreite && <th className="num">von</th>}
              <th className="num">{bandbreite ? 'Mittel' : 'Kosten netto'}</th>
              {bandbreite && <th className="num">bis</th>}
            </tr>
          </thead>
          <tbody>
            {e.summen.map((s) => (
              <tr key={s.kg} className={s.ebene === 1 ? 'subtotal' : 'ko-kg2'}>
                <td>{s.kg}</td>
                <td>{s.name}</td>
                <Betraege s={s.summe} bandbreite={bandbreite} />
              </tr>
            ))}
            <tr className="sum">
              <td />
              <td>Gesamt netto</td>
              <Betraege s={e.gesamtNetto} bandbreite={bandbreite} />
            </tr>
            <tr>
              <td />
              <td>Umsatzsteuer {e.mwst} %</td>
              <Betraege s={[e.gesamtBrutto[0] - e.gesamtNetto[0], e.gesamtBrutto[1] - e.gesamtNetto[1], e.gesamtBrutto[2] - e.gesamtNetto[2]]} bandbreite={bandbreite} />
            </tr>
            <tr className="sum">
              <td />
              <td>Gesamt brutto</td>
              <Betraege s={e.gesamtBrutto} bandbreite={bandbreite} />
            </tr>
          </tbody>
        </table>
        {e.kennwerte.length > 0 && (
          <p className="report-keyfigures">
            Bauwerk (KG 300 + 400, brutto):{' '}
            {e.kennwerte
              .map((kw) => `${zahl(kw.wert[1], 0)} €/${kw.einheit} ${kw.kurz}${Math.round(kw.wert[0]) !== Math.round(kw.wert[2]) ? ` (${zahl(kw.wert[0], 0)} – ${zahl(kw.wert[2], 0)})` : ''}`)
              .join(' · ')}
          </p>
        )}

        {positionen && aktiv.length > 0 && (
          <>
            <h2>Positionen</h2>
            <table className="report-table">
              <thead>
                <tr>
                  <th>KG</th>
                  <th>Bezeichnung</th>
                  <th className="num">Menge</th>
                  <th>Bezug</th>
                  <th className="num">Kennwert</th>
                  {bandbreite && <th className="num">von</th>}
                  <th className="num">{bandbreite ? 'Mittel' : 'Kosten netto'}</th>
                  {bandbreite && <th className="num">bis</th>}
                </tr>
              </thead>
              <tbody>
                {KG_ERSTE_EBENE.filter((g) => aktiv.some((x) => kg1(x.pos.kg) === g)).map((g) => {
                  const summe = e.summen.find((s) => s.kg === g);
                  return [
                    <tr key={g} className="subtotal">
                      <td>{g}</td>
                      <td colSpan={4}>{kgName(g)}</td>
                      <Betraege s={summe?.summe ?? [0, 0, 0]} bandbreite={bandbreite} />
                    </tr>,
                    ...aktiv.filter((x) => kg1(x.pos.kg) === g).map((x) => <PositionZeile key={x.pos.id} x={x} bandbreite={bandbreite} />),
                  ];
                })}
              </tbody>
            </table>
            <p className="report-note">
              Kosten = Menge × Kennwert (netto, nach Faktor); bei Prozentpositionen ist die Menge die Summe der genannten Kostengruppen. Pauschalen und Prozentsätze werden
              nicht mit dem Faktor angepasst.
            </p>
          </>
        )}

        {mengen && gezeigteMengen.length > 0 && (
          <>
            <h2>Mengen</h2>
            <table className="report-table">
              <thead>
                <tr>
                  <th />
                  <th>Menge</th>
                  <th className="num">Wert</th>
                  <th>Ermittlung</th>
                </tr>
              </thead>
              <tbody>
                {gezeigteMengen.map((b) => (
                  <tr key={b}>
                    <td className="strong">{MENGEN_INFO[b].kurz}</td>
                    <td>{MENGEN_INFO[b].label}</td>
                    <td className="num">
                      {b === 'we' ? e.mengen[b].wert : fmt2(e.mengen[b].wert)} {MENGEN_INFO[b].einheit}
                    </td>
                    <td>{e.mengen[b].festgelegt ? `von Hand festgelegt (abgeleitet: ${fmt2(e.mengen[b].abgeleitet)} ${MENGEN_INFO[b].einheit})` : MENGEN_INFO[b].ermittlung}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {staende && (k.staende?.length ?? 0) > 0 && (
          <>
            <h2>Kostenstände</h2>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Stufe</th>
                  <th>Bemerkung</th>
                  <th className="num">netto</th>
                  <th className="num">brutto</th>
                </tr>
              </thead>
              <tbody>
                {k.staende!.map((s) => (
                  <tr key={s.id}>
                    <td>{datum(s.datum)}</td>
                    <td>{stufeLabel(s.stufe)}</td>
                    <td>{s.bemerkung}</td>
                    <td className="num">{euro(s.gesamtNetto[1])}</td>
                    <td className="num">{euro(s.gesamtBrutto[1])}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td>{heute}</td>
                  <td>{stufeLabel(k.stufe ?? 'schaetzung')}</td>
                  <td>aktueller Stand</td>
                  <td className="num">{euro(e.gesamtNetto[1])}</td>
                  <td className="num">{euro(e.gesamtBrutto[1])}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {e.hinweise.length > 0 && (
          <>
            <h2>Hinweise</h2>
            <ul className="ko-report-hinweise">
              {e.hinweise.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </>
        )}

        <div className="ko-report-unterschrift">
          <div>
            <span />
            Ort, Datum
          </div>
          <div>
            <span />
            Verfasser/in
          </div>
        </div>
        <p className="report-note">{HAFTUNG}</p>
      </div>
    </div>
  );
}

function Betraege({ s, bandbreite }: { s: Spanne; bandbreite: boolean }) {
  return (
    <>
      {bandbreite && <td className="num">{euro(s[0])}</td>}
      <td className="num strong">{euro(s[1])}</td>
      {bandbreite && <td className="num">{euro(s[2])}</td>}
    </>
  );
}

function PositionZeile({ x, bandbreite }: { x: PositionErgebnis; bandbreite: boolean }) {
  const p = x.pos;
  return (
    <tr>
      <td>{istKg(p.kg) && p.kg[1] !== '0' ? p.kg : ''}</td>
      <td>
        {p.bezeichnung}
        {(p.quelle || p.bemerkung) && <div className="report-note">{[p.quelle, p.bemerkung].filter(Boolean).join(' · ')}</div>}
      </td>
      <td className="num">{p.bezug === 'pauschal' ? '1' : p.bezug === 'prozent' ? euro(x.menge) : fmt2(x.menge)}</td>
      <td>{bezugLabel(p)}</td>
      <td className="num">{p.bezug === 'prozent' ? `${zahl(x.kennwert[1], 1)} %` : zahl(x.kennwert[1])}</td>
      <Betraege s={x.kosten} bandbreite={bandbreite} />
    </tr>
  );
}
