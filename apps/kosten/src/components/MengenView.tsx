import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { fmt2 } from '@core/format';
import type { MengenBezug } from '../mengen';
import { MENGEN_BEZUEGE, MENGEN_INFO, mengen } from '../mengen';
import { mengenNachweis } from '../nachweis';
import { useKosten } from '../store';
import { MengenPlan } from './MengenPlan';

const Mengen3D = lazy(() => import('./Mengen3D'));

const wert = (b: MengenBezug, v: number) => (b === 'we' ? String(v) : fmt2(v));

/**
 * Mengen prüfen: links alle Mengen, in der Mitte die Darstellung der gewählten Menge (Grundrisse je Geschoss
 * oder 3D-Modell), rechts der Rechenweg – die Teile, deren Summe die Menge ergibt. Bild und Tabelle zeigen
 * dieselben Teile; ein Teil unter dem Mauszeiger wird in beiden hervorgehoben.
 */
export function MengenView({ bezug, onBezug }: { bezug: MengenBezug; onBezug: (b: MengenBezug) => void }) {
  const project = useKosten((s) => s.project);
  const nachweis = useMemo(() => mengenNachweis(project), [project]);
  const m = useMemo(() => mengen(project), [project]);
  const menge = nachweis.mengen[bezug];
  const info = MENGEN_INFO[bezug];
  const [ansicht, setAnsicht] = useState<'plan' | 'raum'>(menge.ansicht);
  const [aktiv, setAktiv] = useState<string | null>(null);

  // jede Menge öffnet in ihrer üblichen Darstellung
  useEffect(() => {
    setAnsicht(nachweis.mengen[bezug].ansicht);
    setAktiv(null);
  }, [bezug]); // eslint-disable-line react-hooks/exhaustive-deps

  const hatGeometrie = menge.teile.some((t) => t.plan?.length || t.raum?.length);
  const festgelegt = m[bezug].festgelegt;

  return (
    <div className="mv-view">
      <section className="ko-col mv-liste">
        <h2>Mengen</h2>
        <table className="ko-table">
          <tbody>
            {MENGEN_BEZUEGE.map((b) => (
              <tr key={b} className={`${b === bezug ? 'selected' : ''}${m[b].festgelegt ? ' festgelegt' : ''}`} onClick={() => onBezug(b)}>
                <td title={MENGEN_INFO[b].ermittlung}>
                  <strong>{MENGEN_INFO[b].kurz}</strong> <span className="muted small-text">{MENGEN_INFO[b].label}</span>
                </td>
                <td className="num">
                  {wert(b, nachweis.mengen[b].summe)} <span className="muted small-text">{MENGEN_INFO[b].einheit}</span>
                  {m[b].festgelegt && <div className="warning small-text">festgelegt: {wert(b, m[b].wert)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small-text">Angezeigt sind die aus dem Projekt abgeleiteten Mengen. Eine Menge anklicken, um zu sehen, woraus sie sich zusammensetzt.</p>
      </section>

      <section className="ko-col mv-bild">
        <div className="mv-kopf">
          <h2>
            {info.kurz} – {info.label}: {wert(bezug, menge.summe)} {info.einheit}
          </h2>
          <div className="mv-umschalter" role="tablist">
            <button role="tab" aria-selected={ansicht === 'plan'} className={ansicht === 'plan' ? 'active' : ''} onClick={() => setAnsicht('plan')}>
              Grundrisse
            </button>
            <button role="tab" aria-selected={ansicht === 'raum'} className={ansicht === 'raum' ? 'active' : ''} onClick={() => setAnsicht('raum')}>
              3D-Modell
            </button>
          </div>
        </div>
        {menge.hinweis && <p className="muted small-text">{menge.hinweis}</p>}
        {festgelegt && (
          <p className="warning">
            Für die Kosten gilt der von Hand festgelegte Wert {wert(bezug, m[bezug].wert)} {info.einheit}. Die Darstellung zeigt die abgeleitete Menge {wert(bezug, menge.summe)}{' '}
            {info.einheit}.
          </p>
        )}
        {!hatGeometrie && !menge.lageplan ? (
          <p className="muted small-text">Für diese Menge gibt es im Projekt nichts darzustellen.</p>
        ) : ansicht === 'plan' ? (
          <MengenPlan project={project} menge={menge} einheit={info.einheit} aktiv={aktiv} onAktiv={setAktiv} />
        ) : (
          <Suspense fallback={<p className="muted small-text">3D-Modell wird geladen …</p>}>
            <Mengen3D project={project} nachweis={nachweis} menge={menge} aktiv={aktiv} onAktiv={setAktiv} />
          </Suspense>
        )}
        <p className="mv-legende small-text">
          <span>
            <i className="zaehlt" /> zählt zur Menge
          </span>
          <span>
            <i className="abzug" /> Abzug
          </span>
          <span>
            <i className="aktiv" /> unter dem Mauszeiger
          </span>
          <span>
            <i className="bezug" /> übrige Geometrie des Projekts
          </span>
        </p>
      </section>

      <section className="ko-col mv-rechenweg">
        <h2>Rechenweg</h2>
        {menge.teile.length ? (
          <div className="tbl-wrap">
            <table className="ko-table" onMouseLeave={() => setAktiv(null)}>
              <thead>
                <tr>
                  <th>Geschoss</th>
                  <th>Teil</th>
                  <th className="num">{info.einheit}</th>
                </tr>
              </thead>
              <tbody>
                {menge.teile.map((t) => (
                  <tr key={t.id} className={`${t.id === aktiv ? 'selected' : ''}${t.wert < 0 ? ' mv-abzug' : ''}`} onMouseEnter={() => setAktiv(t.id)}>
                    <td>{t.geschoss}</td>
                    <td>
                      {t.bezeichnung}
                      {t.ansatz && <div className="muted small-text">{t.ansatz}</div>}
                    </td>
                    <td className="num">{wert(bezug, t.wert)}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td colSpan={2}>Summe = {info.kurz}</td>
                  <td className="num">{wert(bezug, menge.summe)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small-text">Keine Teile – die Menge ist 0.</p>
        )}
        <p className="muted small-text">{info.ermittlung}</p>
      </section>
    </div>
  );
}
