import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { fmt2 } from '@core/format';
import type { MengenBezug } from '../mengen';
import { MENGEN_BEZUEGE, MENGEN_INFO, mengen } from '../mengen';
import { useBauteile } from '../bauteile';
import type { Teil } from '../nachweis';
import { mengenNachweis } from '../nachweis';
import { setKosten, useKosten } from '../store';
import { MengenPlan } from './MengenPlan';

const Mengen3D = lazy(() => import('./Mengen3D'));

const wert = (b: MengenBezug, v: number) => (b === 'we' ? String(v) : fmt2(v));

/**
 * Mengen prüfen: links alle Mengen, in der Mitte die Darstellung der gewählten Menge (Grundrisse je Geschoss
 * oder 3D-Modell), rechts der Rechenweg – die Teile, deren Summe die Menge ergibt. Bild und Tabelle zeigen
 * dieselben Teile; ein Teil unter dem Mauszeiger wird in beiden hervorgehoben. Jedes Teil lässt sich an- und
 * abwählen (Häkchen in der Tabelle oder Klick im Bild) – abgewählte Teile zählen nicht zur Menge.
 */
export function MengenView({ bezug, onBezug }: { bezug: MengenBezug; onBezug: (b: MengenBezug) => void }) {
  const project = useKosten((s) => s.project);
  const waende = useBauteile((s) => s.waende);
  const ifcStatus = useBauteile((s) => s.status);
  const nachweis = useMemo(() => mengenNachweis(project, undefined, waende), [project, waende]);
  const m = useMemo(() => mengen(project, undefined, waende), [project, waende]);
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
  const gezaehlt = menge.teile.filter((t) => t.zaehlt).length;
  const abweichend = menge.teile.some((t) => project.kosten?.teile?.[t.id] !== undefined);

  /** Auswahl setzen; was dem Standard entspricht, wird nicht gespeichert */
  const waehle = (teile: Teil[], an: (t: Teil) => boolean) =>
    useKosten.getState().update((p) => {
      const auswahl = { ...(p.kosten?.teile ?? {}) };
      for (const t of teile) {
        if (an(t) === !t.standardAus) delete auswahl[t.id];
        else auswahl[t.id] = an(t);
      }
      return setKosten(p, { teile: Object.keys(auswahl).length ? auswahl : undefined });
    });
  const umschalten = (id: string) => {
    const t = menge.teile.find((x) => x.id === id);
    if (t) waehle([t], () => !t.zaehlt);
  };

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
        {bezug === 'iwf' && ifcStatus === 'laedt' && <p className="muted small-text">Die Wände des IFC-Modells werden gelesen …</p>}
        {bezug === 'iwf' && ifcStatus === 'fehler' && <p className="warning">Das IFC-Modell des Projekts konnte nicht gelesen werden – die Innenwandfläche ist nur grob aus den Räumen abgeleitet.</p>}
        {festgelegt && (
          <p className="warning">
            Für die Kosten gilt der von Hand festgelegte Wert {wert(bezug, m[bezug].wert)} {info.einheit}. Die Darstellung zeigt die abgeleitete Menge {wert(bezug, menge.summe)}{' '}
            {info.einheit}.
          </p>
        )}
        {!hatGeometrie && !menge.lageplan ? (
          <p className="muted small-text">Für diese Menge gibt es im Projekt nichts darzustellen.</p>
        ) : ansicht === 'plan' ? (
          <MengenPlan project={project} menge={menge} einheit={info.einheit} aktiv={aktiv} onAktiv={setAktiv} onUmschalten={umschalten} />
        ) : (
          <Suspense fallback={<p className="muted small-text">3D-Modell wird geladen …</p>}>
            <Mengen3D project={project} nachweis={nachweis} menge={menge} aktiv={aktiv} onAktiv={setAktiv} onUmschalten={umschalten} />
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
            <i className="aus" /> abgewählt, zählt nicht
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
        {menge.teile.length > 1 && (
          <div className="mv-auswahl small-text">
            <span className="muted">
              {gezaehlt} von {menge.teile.length} Teilen zählen
            </span>
            <button className="small" onClick={() => waehle(menge.teile, () => true)} disabled={gezaehlt === menge.teile.length}>
              alle
            </button>
            <button className="small" onClick={() => waehle(menge.teile, () => false)} disabled={gezaehlt === 0}>
              keine
            </button>
            <button className="small" onClick={() => waehle(menge.teile, (t) => !t.standardAus)} disabled={!abweichend} title="Auswahl dieser Menge auf den Standard zurücksetzen">
              Standard
            </button>
          </div>
        )}
        {menge.teile.length ? (
          <div className="tbl-wrap">
            <table className="ko-table" onMouseLeave={() => setAktiv(null)}>
              <thead>
                <tr>
                  <th title="zählt zur Menge" />
                  <th>Geschoss</th>
                  <th>Teil</th>
                  <th className="num">{info.einheit}</th>
                </tr>
              </thead>
              <tbody>
                {menge.teile.map((t) => (
                  <tr key={t.id} className={`${t.id === aktiv ? 'selected' : ''}${t.wert < 0 ? ' mv-abzug' : ''}${t.zaehlt ? '' : ' mv-aus'}`} onMouseEnter={() => setAktiv(t.id)}>
                    <td>
                      <input type="checkbox" checked={!!t.zaehlt} onChange={() => umschalten(t.id)} title={t.zaehlt ? 'zählt zur Menge – abwählen' : 'zählt nicht – anwählen'} />
                    </td>
                    <td>{t.geschoss}</td>
                    <td>
                      {t.bezeichnung}
                      {t.ansatz && <div className="muted small-text">{t.ansatz}</div>}
                    </td>
                    <td className="num">{wert(bezug, t.wert)}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td colSpan={3}>Summe = {info.kurz}</td>
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
