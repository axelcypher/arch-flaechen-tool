import { useMemo, useState } from 'react';
import { fmt2 } from '@core/format';
import type { Point } from '@core/geometry';
import { bounds, labelPoint, polygonArea } from '@core/geometry';
import { nutzungLabel, VERSIEGELUNGEN, versiegelungInfo } from '@core/lageplan';
import type { Project, RoomShape } from '@core/model';
import { anschriftEinzeilig, flurText } from '@core/model';
import type { Kennzahl, Nachweis } from '../massNutzung';
import { baunvoLabel, bauoLabel, istAufenthaltsraum, massNachweis } from '../massNutzung';
import { useGrz } from '../store';
import { ANRECHNUNG, AUFENTHALT, GF_ART, HAFTUNG, roemisch, STATUS, zahl } from '../texte';

/** Druckbarer Nachweis des Maßes der baulichen Nutzung (GRZ, GFZ, Vollgeschosse) – über den Druckdialog auch als PDF. */
export function NachweisDruck({ onClose }: { onClose: () => void }) {
  const project = useGrz((s) => s.project);
  const n = useMemo(() => massNachweis(project), [project]);
  const [plan, setPlan] = useState(true);
  const [raeume, setRaeume] = useState(true);
  const m = project.massNutzung ?? {};
  const G = n.grundstueck.flaeche;
  const heute = new Date().toLocaleDateString('de-DE');
  const eigene = n.lageplan.filter((l) => !l.nachbar);
  const nr = new Map(eigene.map((l, i) => [l.id, i + 1]));
  const vor1990 = n.recht.baunvo !== '1990';
  const aufenthalt = vor1990 ? aufenthaltsraeume(project, n) : [];

  return (
    <div className="report-backdrop">
      <div className="report grz-report">
        <div className="report-actions no-print">
          <label className="toggle">
            <input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)} />
            Lageplan
          </label>
          {vor1990 && (
            <label className="toggle">
              <input type="checkbox" checked={raeume} onChange={(e) => setRaeume(e.target.checked)} />
              Aufenthaltsräume
            </label>
          )}
          <button onClick={() => window.print()}>Drucken / PDF</button>
          <button className="primary" onClick={onClose}>
            Schließen
          </button>
        </div>

        <header className="report-header">
          <h1>Nachweis des Maßes der baulichen Nutzung</h1>
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
              <td>Bebauungsplan in Kraft seit</td>
              <td>{m.planDatum ? new Date(m.planDatum).toLocaleDateString('de-DE') : 'kein Datum (aktuelles Recht)'}</td>
            </tr>
            <tr>
              <td>Baunutzungsverordnung</td>
              <td>
                {baunvoLabel(n.recht.baunvo)}
                {m.baunvo ? ' (festgelegt)' : ''}
              </td>
            </tr>
            <tr>
              <td>Vollgeschossbegriff</td>
              <td>{bauoLabel(n.recht.bauo)}</td>
            </tr>
            <tr>
              <td>Festsetzungen</td>
              <td>
                {[
                  m.grz !== undefined && `GRZ ${zahl(m.grz)}`,
                  m.grzIIMax !== undefined && `GRZ II ${zahl(m.grzIIMax)}`,
                  m.gfz !== undefined && `GFZ ${zahl(m.gfz)}`,
                  m.vollgeschosseMax !== undefined && `${roemisch(m.vollgeschosseMax)} Vollgeschosse`,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'keine eingetragen'}
              </td>
            </tr>
            <tr>
              <td>Grundstücksfläche</td>
              <td>
                {G !== undefined ? `${fmt2(G)} m²` : 'fehlt'}
                {n.grundstueck.quelle === 'lageplan' && ' (aus dem Lageplan)'}
              </td>
            </tr>
            <tr>
              <td>Geländeoberfläche</td>
              <td>
                {fmt2(n.gelaende.hoehe)} m über ±0,00 ({n.gelaende.quelle === 'festgelegt' ? 'festgelegt' : n.gelaende.quelle === 'lageplan' ? 'aus dem Lageplan' : 'angenommen'})
              </td>
            </tr>
          </tbody>
        </table>
        {n.recht.hinweise.length > 0 && <p className="report-note">{n.recht.hinweise.join(' ')}</p>}

        <h2>Ergebnis</h2>
        <table className="report-table">
          <thead>
            <tr>
              <th>Kennzahl</th>
              <th className="num">Fläche [m²]</th>
              <th className="num">vorhanden</th>
              <th className="num">zulässig</th>
              <th className="num">Reserve [m²]</th>
              <th>Ergebnis</th>
            </tr>
          </thead>
          <tbody>
            <KennzahlZeile titel={vor1990 ? 'GRZ' : 'GRZ I'} k={n.grz} flaeche={G !== undefined ? n.grz.wert * G : undefined} />
            {n.grz2 && <KennzahlZeile titel="GRZ II (§ 19 Abs. 4)" k={n.grz2} flaeche={G !== undefined ? n.grz2.wert * G : undefined} />}
            <KennzahlZeile titel="GFZ" k={n.gfz} flaeche={n.gf} />
            <tr>
              <td>Vollgeschosse</td>
              <td className="num" />
              <td className="num strong">{roemisch(n.vollgeschosse.anzahl)}</td>
              <td className="num">{n.vollgeschosse.zulaessig !== undefined ? roemisch(n.vollgeschosse.zulaessig) : '–'}</td>
              <td className="num" />
              <td>{STATUS[n.vollgeschosse.status].label}</td>
            </tr>
          </tbody>
        </table>
        {n.garagenFrei !== undefined && n.garagenFrei > 0 && (
          <p className="report-note">Garagen und überdachte Stellplätze: {fmt2(n.garagenFrei)} m² anrechnungsfrei (§ 21a Abs. 3, bis 0,1 der Grundstücksfläche).</p>
        )}
        {(n.grz.mitOffenen !== undefined || n.grz2?.mitOffenen !== undefined) && (
          <p className="report-note">
            Noch nicht eingestufte Flächen („prüfen“): GRZ bis {zahl(n.grz2?.mitOffenen ?? n.grz.mitOffenen ?? n.grz.wert)} – Einstufung mit der Bauaufsicht klären.
          </p>
        )}

        {plan && <LageplanSkizze n={n} project={project} nr={nr} />}

        <h2>Grundfläche</h2>
        <table className="report-table">
          <thead>
            <tr>
              <th>Nr.</th>
              <th>Fläche</th>
              <th>Nutzung</th>
              <th>Versiegelung</th>
              <th className="num">Fläche [m²]</th>
              <th className="num">außerhalb Gebäude [m²]</th>
              <th>Anrechnung</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td />
              <td>Hauptanlage (Gebäude)</td>
              <td />
              <td />
              <td className="num">{fmt2(n.hauptanlage)}</td>
              <td className="num" />
              <td>zählt</td>
            </tr>
            {eigene.map((l) => (
              <tr key={l.id}>
                <td>{nr.get(l.id)}</td>
                <td>{l.name}</td>
                <td>{nutzungLabel(l.nutzung)}</td>
                <td>{versiegelungInfo(l.versiegelung).label}</td>
                <td className="num">{fmt2(l.flaeche)}</td>
                <td className="num">{fmt2(l.flaecheAussen)}</td>
                <td>{ANRECHNUNG[l.anrechnung]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Vollgeschosse</h2>
        <table className="report-table">
          <thead>
            <tr>
              <th>Geschoss</th>
              <th className="num">über Gelände</th>
              <th className="num">Anteil</th>
              <th>Ergebnis</th>
              <th>Begründung</th>
            </tr>
          </thead>
          <tbody>
            {n.geschosse.map((g) => (
              <tr key={g.storeyId}>
                <td>{g.name}</td>
                <td className="num">{fmt2(g.ueberGelaende)} m</td>
                <td className="num">{g.oberirdisch ? `${Math.round(g.anteil * 100)} %` : '–'}</td>
                <td className="strong">
                  {g.vollgeschoss ? 'Vollgeschoss' : 'kein Vollgeschoss'}
                  {!g.automatisch && ' (festgelegt)'}
                </td>
                <td>{g.begruendung}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Geschossfläche</h2>
        <table className="report-table narrow">
          <tbody>
            {n.gfJeGeschoss.map((g) => (
              <tr key={g.storeyId}>
                <td>{g.name}</td>
                <td>{GF_ART[g.art]}</td>
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

        {raeume && aufenthalt.length > 0 && (
          <>
            <h2>Aufenthaltsräume in Nicht-Vollgeschossen</h2>
            <p className="report-note">
              {baunvoLabel(n.recht.baunvo)}: Aufenthaltsräume in anderen Geschossen einschließlich der zugehörigen Treppenräume und Umfassungswände zählen zur Geschossfläche.
            </p>
            <table className="report-table narrow">
              <thead>
                <tr>
                  <th>Geschoss</th>
                  <th>Raum</th>
                  <th className="num">Fläche [m²]</th>
                  <th>Einstufung</th>
                </tr>
              </thead>
              <tbody>
                {aufenthalt.map(({ geschoss, r }) => (
                  <tr key={r.id}>
                    <td>{geschoss}</td>
                    <td>{[r.nummer, r.name].filter(Boolean).join(' ')}</td>
                    <td className="num">{fmt2(polygonArea(r.points))}</td>
                    <td>
                      {AUFENTHALT[istAufenthaltsraum(r)]}
                      {r.aufenthalt ? ' (festgelegt)' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {eigene.length > 0 && (
          <>
            <h2>Flächenbilanz des Grundstücks</h2>
            <table className="report-table narrow">
              <tbody>
                <tr>
                  <td>Gebäude</td>
                  <td className="num">{fmt2(n.bilanz.gebaeude)} m²</td>
                </tr>
                {VERSIEGELUNGEN.map((v) => (
                  <tr key={v.id}>
                    <td>{v.label}</td>
                    <td className="num">{fmt2(n.bilanz[v.id])} m²</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td>Summe</td>
                  <td className="num">{fmt2(n.bilanz.summe)} m²</td>
                </tr>
                {n.bilanz.differenz !== undefined && Math.abs(n.bilanz.differenz) > 0.5 && (
                  <tr>
                    <td>nicht erfasst bzw. überlappend</td>
                    <td className="num">{fmt2(n.bilanz.differenz)} m²</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {n.hinweise.length > 0 && (
          <>
            <h2>Hinweise</h2>
            <ul className="grz-report-hinweise">
              {n.hinweise.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </>
        )}

        <div className="grz-report-unterschrift">
          <div>
            <span />
            Ort, Datum
          </div>
          <div>
            <span />
            Entwurfsverfasser/in
          </div>
        </div>
        <p className="report-note">{HAFTUNG}</p>
      </div>
    </div>
  );
}

function KennzahlZeile({ titel, k, flaeche }: { titel: string; k: Kennzahl; flaeche: number | undefined }) {
  return (
    <tr>
      <td>{titel}</td>
      <td className="num">{flaeche !== undefined ? fmt2(flaeche) : '–'}</td>
      <td className="num strong">
        {zahl(k.wert)}
        {k.mitOffenen !== undefined && ` (bis ${zahl(k.mitOffenen)})`}
      </td>
      <td className="num">{k.zulaessig !== undefined ? zahl(k.zulaessig) : '–'}</td>
      <td className="num">{k.reserve !== undefined ? fmt2(k.reserve) : '–'}</td>
      <td>{STATUS[k.status].label}</td>
    </tr>
  );
}

/** Räume der Nicht-Vollgeschosse (vor 1990 maßgebend für die Geschossfläche) */
function aufenthaltsraeume(project: Project, n: Nachweis): { geschoss: string; r: RoomShape }[] {
  return n.geschosse
    .filter((g) => !g.vollgeschoss)
    .flatMap((g) => {
      const s = project.storeys.find((x) => x.id === g.storeyId);
      return (s?.shapes ?? []).filter((r): r is RoomShape => r.kind === 'room' && !r.subtract && istAufenthaltsraum(r) !== 'nein').map((r) => ({ geschoss: g.name, r }));
    });
}

/** Lageplan fürs Blatt: Grundstück, Gebäude schraffiert, Flächen farbig nach Versiegelung mit Nummern */
function LageplanSkizze({ n, project, nr }: { n: Nachweis; project: Project; nr: Map<string, number> }) {
  const flaechen = project.lageplan?.flaechen ?? [];
  const pts: Point[] = [...n.hauptanlagePolygone.flat(), ...n.grundstueckPolygone.flat(), ...flaechen.filter((f) => !f.nachbar).flatMap((f) => f.points)];
  if (!pts.length) return null;
  const b = bounds(pts);
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.04 + 0.5;
  const vb = { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + 2 * pad, h: b.maxY - b.minY + 2 * pad };
  // Strichstärken relativ zur Planbreite (ca. 700 px Druckbreite)
  const k = vb.w / 700;
  const d = (p: Point[]) => `M${p.map((q) => `${q.x} ${q.y}`).join('L')}Z`;
  return (
    <figure className="plan-figure">
      <h2>Lageplan</h2>
      <svg className="plan-svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="grz-druck-hatch" width={k * 8} height={k * 8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={k * 8} stroke="#2a5bd7" strokeWidth={k * 2} strokeOpacity={0.5} />
          </pattern>
        </defs>
        {flaechen.map((f) => (
          <path
            key={f.id}
            d={d(f.points)}
            fill={versiegelungInfo(f.versiegelung).color}
            fillOpacity={f.nachbar ? 0.12 : 0.55}
            stroke={f.nachbar ? '#9aa0a6' : '#5b6068'}
            strokeWidth={k}
            strokeDasharray={f.nachbar ? `${k * 4} ${k * 3}` : undefined}
          />
        ))}
        {n.hauptanlagePolygone.map((p, i) => (
          <path key={`h${i}`} d={d(p)} fill="url(#grz-druck-hatch)" stroke="#1d3f96" strokeWidth={k * 2} fillRule="evenodd" />
        ))}
        {n.grundstueckPolygone.map((p, i) => (
          <path key={`g${i}`} d={d(p)} fill="none" stroke="#1f2328" strokeWidth={k * 2.5} strokeDasharray={`${k * 10} ${k * 3} ${k * 2} ${k * 3}`} />
        ))}
        {flaechen
          .filter((f) => nr.has(f.id))
          .map((f) => {
            const p = labelPoint(f.points);
            return (
              <text key={`t${f.id}`} x={p.x} y={p.y} className="plan-label" fontSize={k * 11} textAnchor="middle" dominantBaseline="middle">
                {nr.get(f.id)}
              </text>
            );
          })}
      </svg>
      <figcaption className="plan-legend">
        <span>
          <i className="legend-bgf" style={{ background: 'rgba(42, 91, 215, 0.25)' }} />
          Gebäude (Hauptanlage)
        </span>
        {VERSIEGELUNGEN.map((v) => (
          <span key={v.id}>
            <i style={{ background: v.color }} />
            {v.label}
          </span>
        ))}
        <span>Nummern: siehe „Grundfläche“</span>
      </figcaption>
    </figure>
  );
}
