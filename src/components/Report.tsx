import { useMemo, useState } from 'react';
import type { AreaTotals } from '../core/calc';
import { computeProject } from '../core/calc';
import { fmt2 } from '../core/format';
import { NUF_IDS, nutzungInfo, WOFL_KATEGORIEN } from '../core/norms';
import { useEditor } from '../store/store';
import { PlanFigure } from './PlanFigure';

/** Druckbare Flächenaufstellung (DIN 277 / WoFlV). */
export function Report() {
  const project = useEditor((s) => s.project);
  const setOpen = useEditor((s) => s.setReportOpen);
  const r = useMemo(() => computeProject(project), [project]);
  const today = new Date().toLocaleDateString('de-DE');
  const [showPlans, setShowPlans] = useState(true);
  const [showBackground, setShowBackground] = useState(false);

  const din277Row = (name: string, h: number | null, t: AreaTotals, cls = '') => (
    <tr className={cls} key={name}>
      <td>{name}</td>
      <td className="num">{h === null ? '' : fmt2(h)}</td>
      <td className="num">{fmt2(t.bgf.R)}</td>
      <td className="num">{fmt2(t.bgf.S)}</td>
      <td className="num strong">{fmt2(t.bgf.total)}</td>
      <td className="num">{fmt2(t.bri.total)}</td>
      <td className="num">{fmt2(t.nuf.total)}</td>
      <td className="num">{fmt2(t.tf.total)}</td>
      <td className="num">{fmt2(t.vf.total)}</td>
      <td className="num strong">{fmt2(t.nrf.total)}</td>
      <td className="num">{fmt2(t.kgf.total)}</td>
    </tr>
  );

  return (
    <div className="report-backdrop">
      <div className="report">
        <div className="report-actions no-print">
          <label className="toggle">
            <input type="checkbox" checked={showPlans} onChange={(e) => setShowPlans(e.target.checked)} />
            Grundrisse
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showBackground} disabled={!showPlans} onChange={(e) => setShowBackground(e.target.checked)} />
            Hintergrundplan
          </label>
          <button onClick={() => window.print()}>Drucken / PDF</button>
          <button className="primary" onClick={() => setOpen(false)}>
            Schließen
          </button>
        </div>

        <header className="report-header">
          <h1>Flächenaufstellung</h1>
          <div className="report-meta">
            <div>
              <strong>{project.name}</strong>
            </div>
            {project.meta.adresse && <div>{project.meta.adresse}</div>}
            <div>
              {project.meta.bearbeiter && <>Bearbeiter: {project.meta.bearbeiter} · </>}Stand: {today}
            </div>
          </div>
        </header>

        <h2>Grundflächen und Rauminhalte nach DIN 277</h2>
        <table className="report-table">
          <thead>
            <tr>
              <th>Geschoss</th>
              <th>Höhe [m]</th>
              <th>BGF R [m²]</th>
              <th>BGF S [m²]</th>
              <th>BGF [m²]</th>
              <th>BRI [m³]</th>
              <th>NUF [m²]</th>
              <th>TF [m²]</th>
              <th>VF [m²]</th>
              <th>NRF [m²]</th>
              <th>KGF [m²]</th>
            </tr>
          </thead>
          <tbody>
            {r.storeys.map((s) => din277Row(s.name, s.hoehe, s))}
            {din277Row('Summe', null, r.total, 'sum')}
          </tbody>
        </table>
        <p className="report-note">
          R = Regelfall der Raumumschließung, S = Sonderfall. KGF = BGF − NRF (rechnerisch). BRI = Σ Umrissfläche × Geschosshöhe bzw. abweichende Höhe.
        </p>

        <h2>Netto-Raumfläche nach Nutzungsgruppen</h2>
        <table className="report-table">
          <thead>
            <tr>
              <th>Geschoss</th>
              {NUF_IDS.map((id) => (
                <th key={id} title={nutzungInfo(id).label}>
                  {nutzungInfo(id).kurz}
                </th>
              ))}
              <th>TF 8</th>
              <th>VF 9</th>
            </tr>
          </thead>
          <tbody>
            {[...r.storeys, { name: 'Summe', ...r.total, storeyId: 'sum' }].map((s) => (
              <tr key={s.storeyId} className={s.storeyId === 'sum' ? 'sum' : ''}>
                <td>{s.name}</td>
                {NUF_IDS.map((id) => (
                  <td key={id} className="num">
                    {fmt2(s.nutzung[id])}
                  </td>
                ))}
                <td className="num">{fmt2(s.nutzung.TF)}</td>
                <td className="num">{fmt2(s.nutzung.VF)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {r.storeys.map((sr, idx) => {
          const storey = project.storeys[idx];
          return (
            <section key={sr.storeyId} className={`report-storey${showPlans ? ' page-break' : ''}`}>
              <h2>
                {showPlans ? 'Grundriss und Raumliste' : 'Raumliste'} – {sr.name}
              </h2>
              <p className="report-keyfigures">
                BGF {fmt2(sr.bgf.total)} m² · BRI {fmt2(sr.bri.total)} m³ · NRF {fmt2(sr.nrf.total)} m² · KGF {fmt2(sr.kgf.total)} m²
                {sr.wofl ? ` · WoFl ${fmt2(sr.wofl)} m²` : ''}
              </p>
              {showPlans && <PlanFigure storey={storey} showBackground={showBackground} />}
              {sr.rooms.length > 0 ? (
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Nr.</th>
                      <th>Raum</th>
                      <th>Nutzung</th>
                      <th>R/S</th>
                      <th>Fläche [m²]</th>
                      <th>WoFlV</th>
                      <th>Faktor</th>
                      <th>WoFl [m²]</th>
                      <th>Wohnung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sr.rooms.map((room) => (
                      <tr key={room.shapeId}>
                        <td>{room.nummer}</td>
                        <td>
                          {room.name}
                          {room.subtract && <em> (Abzug)</em>}
                        </td>
                        <td>{nutzungInfo(room.nutzung).kurz}</td>
                        <td>{room.umschliessung}</td>
                        <td className="num">{fmt2(room.area)}</td>
                        <td>{room.woflKategorie === 'keine' ? '–' : WOFL_KATEGORIEN.find((k) => k.id === room.woflKategorie)?.label}</td>
                        <td className="num">{room.woflKategorie === 'keine' ? '' : fmt2(room.woflFaktor)}</td>
                        <td className="num">{room.woflKategorie === 'keine' ? '' : fmt2(room.woflArea)}</td>
                        <td>{room.wohnung}</td>
                      </tr>
                    ))}
                    <tr className="sum">
                      <td />
                      <td>Summe {sr.name}</td>
                      <td />
                      <td />
                      <td className="num">{fmt2(sr.nrf.total)}</td>
                      <td />
                      <td />
                      <td className="num">{fmt2(sr.wofl)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="muted">Keine Räume erfasst.</p>
              )}
            </section>
          );
        })}

        <h2 className={showPlans ? 'page-break' : ''}>Wohnflächen nach WoFlV</h2>
        <table className="report-table narrow">
          <thead>
            <tr>
              <th>Wohnung</th>
              <th>Räume</th>
              <th>Grundfläche [m²]</th>
              <th>Wohnfläche [m²]</th>
            </tr>
          </thead>
          <tbody>
            {r.wohnungen.map((w) => (
              <tr key={w.wohnung}>
                <td>{w.wohnung}</td>
                <td className="num">{w.rooms.length}</td>
                <td className="num">{fmt2(w.grundflaeche)}</td>
                <td className="num strong">{fmt2(w.wofl)}</td>
              </tr>
            ))}
            <tr className="sum">
              <td>Summe</td>
              <td />
              <td className="num">{fmt2(r.wohnungen.reduce((a, w) => a + w.grundflaeche, 0))}</td>
              <td className="num">{fmt2(r.total.wofl)}</td>
            </tr>
          </tbody>
        </table>
        <p className="report-note">
          Anrechnung nach § 4 WoFlV: lichte Höhe ≥ 2 m voll, 1–2 m zur Hälfte, &lt; 1 m nicht; unbeheizte Wintergärten zur Hälfte; Balkone, Loggien,
          Dachgärten und Terrassen i. d. R. zu einem Viertel, höchstens zur Hälfte. Abzugsflächen nach § 3 Abs. 3 WoFlV sind als Abzugsflächen zu
          erfassen.
        </p>
      </div>
    </div>
  );
}
