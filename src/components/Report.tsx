import { useMemo, useState } from 'react';
import type { AreaTotals } from '../core/calc';
import { computeProject } from '../core/calc';
import { briRechenweg } from '../core/rechenweg';
import { baunvoLabel, bauoLabel, massNachweis } from '../core/massNutzung';
import { fmt2 } from '../core/format';
import { anschriftEinzeilig, flurText } from '../core/model';
import { NUF_IDS, nutzungInfo, WOFL_KATEGORIEN } from '../core/norms';
import { useEditor } from '../store/store';
import { PlanFigure } from './PlanFigure';

const zahl2 = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Druckbare Flächenaufstellung (DIN 277 / WoFlV). */
export function Report() {
  const project = useEditor((s) => s.project);
  const setOpen = useEditor((s) => s.setReportOpen);
  const r = useMemo(() => computeProject(project), [project]);
  const rechenweg = useMemo(() => briRechenweg(project), [project]);
  const mass = useMemo(() => (project.massNutzung || project.storeys.some((s) => s.lageplan) ? massNachweis(project) : null), [project]);
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
              {project.meta.projektcode && <>{project.meta.projektcode} · </>}
              <strong>{project.name}</strong>
            </div>
            {anschriftEinzeilig(project.meta.adresse) && <div>{anschriftEinzeilig(project.meta.adresse)}</div>}
            {flurText(project.meta.grundstueck) && <div>{flurText(project.meta.grundstueck)}</div>}
            {project.meta.bauherr.name && <div>Bauherr: {project.meta.bauherr.name}</div>}
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
          R = Regelfall der Raumumschließung, S = Sonderfall. KGF = BGF − NRF (rechnerisch). BRI = Σ Umrissfläche × Geschosshöhe bzw. Volumen bis zur Dachhaut (Dachform oder Dach aus IFC-Modell).
        </p>

        <h2>Brutto-Rauminhalt – Rechenweg</h2>
        <table className="report-table">
          <thead>
            <tr>
              <th>Geschoss</th>
              <th>Umriss</th>
              <th>Teilkörper</th>
              <th>Rechenweg [m]</th>
              <th>Volumen [m³]</th>
            </tr>
          </thead>
          <tbody>
            {r.storeys.map((sr) => {
              const steps = rechenweg.filter((b) => b.geschossId === sr.storeyId);
              if (!steps.length) return null;
              return [
                ...steps.map((b, i) => (
                  <tr key={`${sr.storeyId}-${i}`}>
                    <td>{i === 0 ? sr.name : ''}</td>
                    <td>{b.umriss}</td>
                    <td>{b.bezeichnung}</td>
                    <td className="formula">{b.formel}</td>
                    <td className="num">{fmt2(b.volumen)}</td>
                  </tr>
                )),
                <tr key={`${sr.storeyId}-sum`} className="subtotal">
                  <td />
                  <td colSpan={3}>BRI {sr.name}</td>
                  <td className="num">{fmt2(sr.bri.total)}</td>
                </tr>,
              ];
            })}
            <tr className="sum">
              <td colSpan={4}>Brutto-Rauminhalt gesamt</td>
              <td className="num">{fmt2(r.total.bri.total)}</td>
            </tr>
          </tbody>
        </table>
        <p className="report-note">
          Teilkörper: Anzahl × Länge × Breite (bzw. Grundfläche) × Höhe × Formfaktor (½ Prisma/Keil, ⅓ Walmende/Pyramide, ⅙ Krüppelwalm-Abzug).
          „Mittlere Höhe“: Volumen exakt aus den Dachflächen bzw. dem IFC-Modell, als Grundfläche × mittlere Höhe dargestellt.
        </p>

        {mass && (
          <>
            <h2>Maß der baulichen Nutzung</h2>
            <p className="report-note">
              {baunvoLabel(mass.recht.baunvo)} · Vollgeschosse nach {bauoLabel(mass.recht.bauo)}
              {project.massNutzung?.planDatum && ` · Bebauungsplan vom ${new Date(project.massNutzung.planDatum).toLocaleDateString('de-DE')}`}
              {mass.grundstueck.flaeche !== undefined && ` · Grundstücksfläche ${fmt2(mass.grundstueck.flaeche)} m²`}
            </p>
            <table className="report-table">
              <thead>
                <tr>
                  <th />
                  <th className="num">Fläche [m²]</th>
                  <th className="num">vorhanden</th>
                  <th className="num">zulässig</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{mass.grz2 ? 'GRZ I (Hauptanlage)' : 'GRZ'}</td>
                  <td className="num">{fmt2(mass.grz.wert * (mass.grundstueck.flaeche ?? 0))}</td>
                  <td className="num strong">
                    {zahl2(mass.grz.wert)}
                    {mass.grz.mitOffenen !== undefined && ` (bis ${zahl2(mass.grz.mitOffenen)})`}
                  </td>
                  <td className="num">{mass.grz.zulaessig !== undefined ? zahl2(mass.grz.zulaessig) : '–'}</td>
                </tr>
                {mass.grz2 && (
                  <tr>
                    <td>GRZ II (mit Garagen, Stellplätzen, Zufahrten, Nebenanlagen, unterirdischen Anlagen)</td>
                    <td className="num">{fmt2(mass.grz2.wert * (mass.grundstueck.flaeche ?? 0))}</td>
                    <td className="num strong">
                      {zahl2(mass.grz2.wert)}
                      {mass.grz2.mitOffenen !== undefined && ` (bis ${zahl2(mass.grz2.mitOffenen)})`}
                    </td>
                    <td className="num">{mass.grz2.zulaessig !== undefined ? zahl2(mass.grz2.zulaessig) : '–'}</td>
                  </tr>
                )}
                <tr>
                  <td>GFZ</td>
                  <td className="num">{fmt2(mass.gf)}</td>
                  <td className="num strong">{zahl2(mass.gfz.wert)}</td>
                  <td className="num">{mass.gfz.zulaessig !== undefined ? zahl2(mass.gfz.zulaessig) : '–'}</td>
                </tr>
                <tr>
                  <td>Vollgeschosse ({mass.geschosse.filter((g) => g.vollgeschoss).map((g) => g.name).join(', ') || 'keine'})</td>
                  <td />
                  <td className="num strong">{mass.vollgeschosse.anzahl}</td>
                  <td className="num">{mass.vollgeschosse.zulaessig ?? '–'}</td>
                </tr>
              </tbody>
            </table>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Geschoss</th>
                  <th>Vollgeschossprüfung</th>
                  <th className="num">Geschossfläche [m²]</th>
                </tr>
              </thead>
              <tbody>
                {mass.geschosse.map((g) => (
                  <tr key={g.storeyId}>
                    <td>{g.name}</td>
                    <td>
                      {g.vollgeschoss ? 'Vollgeschoss' : 'kein Vollgeschoss'}
                      {g.automatisch ? ` – ${g.begruendung}` : ' (festgelegt)'}
                    </td>
                    <td className="num">{fmt2(mass.gfJeGeschoss.find((x) => x.storeyId === g.storeyId)?.flaeche ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mass.hinweise.length > 0 && (
              <ul className="report-note">
                {mass.hinweise.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
          </>
        )}

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

        {r.storeys.map((sr) => {
          const storey = project.storeys.find((x) => x.id === sr.storeyId)!;
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
