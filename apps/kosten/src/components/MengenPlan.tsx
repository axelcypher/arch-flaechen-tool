import { fmt2 } from '@core/format';
import type { Point } from '@core/geometry';
import { bounds, labelPoint } from '@core/geometry';
import { versiegelungInfo } from '@core/lageplan';
import type { Project, Storey } from '@core/model';
import type { MengeNachweis, PlanFlaeche, Teil } from '../nachweis';

const pfad = (pts: Point[]) => `${pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')}Z`;
const flaechenPfad = (f: PlanFlaeche) => [f.points, ...(f.loecher ?? [])].map(pfad).join('');

/**
 * Grundrisse aller Geschosse mit den Teilen einer Menge: Was zur Menge zählt, ist farbig gefüllt und mit
 * seinem Wert beschriftet, Abzüge rot schraffiert, der Rest des Geschosses nur als dünne Linie.
 * Alle Geschosse haben denselben Ausschnitt, damit sie sich übereinander vergleichen lassen.
 */
export function MengenPlan({
  project,
  menge,
  einheit,
  aktiv,
  onAktiv,
}: {
  project: Project;
  menge: MengeNachweis;
  einheit: string;
  aktiv: string | null;
  onAktiv: (id: string | null) => void;
}) {
  const lageplan = menge.lageplan ? (project.lageplan?.flaechen ?? []).filter((f) => !f.nachbar && f.points.length >= 3) : [];
  const geschosse = project.storeys.filter((s) => s.shapes.some((x) => x.points.length >= 3));
  const alle = [...geschosse.flatMap((s) => s.shapes.flatMap((x) => x.points)), ...lageplan.flatMap((f) => f.points)];
  if (!alle.length) return <p className="muted small-text">Das Projekt enthält keine Geschosse mit Flächen – es gibt nichts darzustellen.</p>;

  const b = bounds(alle);
  const w = Math.max(b.maxX - b.minX, 1);
  const h = Math.max(b.maxY - b.minY, 1);
  const rand = Math.max(w, h) * 0.05;
  const fs = Math.max(w, h) / 22; // Schriftgröße in Metern
  const vb = { x: b.minX - rand, y: b.minY - rand, w: w + 2 * rand, h: h + 2 * rand + fs * 2 };
  // Maßstabsleiste: runde Länge ≈ 1/6 der Breite
  const leiste = [0.5, 1, 2, 5, 10, 20, 50, 100].find((v) => v >= vb.w / 6) ?? 100;

  const teileVon = (s: Storey) => menge.teile.filter((t) => t.plan?.some((f) => f.storeyId === s.id));

  return (
    <div className="mp-grid">
      {/* oberstes Geschoss zuerst – wie ein Schnitt von oben nach unten */}
      {[...geschosse].reverse().map((s) => {
        const teile = teileVon(s);
        const summe = teile.reduce((a, t) => a + t.wert, 0);
        // Teile, die über mehrere Geschosse reichen (Wohnungen), nicht je Geschoss summieren
        const eigen = teile.every((t) => t.plan!.every((f) => f.storeyId === s.id));
        return (
          <figure key={s.id} className={`mp-geschoss${teile.length ? '' : ' leer'}`}>
            <figcaption>
              <strong>{s.name}</strong>
              <span className="num">{teile.length ? (eigen ? `${fmt2(summe)} ${einheit}` : `${teile.length} ${teile.length === 1 ? 'Teil' : 'Teile'}`) : 'zählt nicht'}</span>
            </figcaption>
            <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" className="mp-svg" onMouseLeave={() => onAktiv(null)}>
              <defs>
                <pattern id={`mp-abzug-${s.id}`} width={fs * 0.5} height={fs * 0.5} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                  <line x1="0" y1="0" x2="0" y2={fs * 0.5} stroke="#c0392b" strokeWidth={fs * 0.08} />
                </pattern>
              </defs>
              {lageplan.map((f) => (
                <path key={f.id} d={pfad(f.points)} fill={versiegelungInfo(f.versiegelung).color} fillOpacity={0.3} stroke="#9aa0a6" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
              ))}
              {/* Bezug: alles, was im Geschoss gezeichnet ist */}
              {s.shapes
                .filter((x) => x.points.length >= 3)
                .map((x) => (
                  <path key={x.id} d={pfad(x.points)} className={x.kind === 'outline' ? 'mp-umriss' : 'mp-raum'} vectorEffect="non-scaling-stroke" />
                ))}
              {teile.map((t) => (
                <TeilFlaeche key={t.id} t={t} storeyId={s.id} kanten={!!menge.kanten} aktiv={aktiv === t.id} onAktiv={onAktiv} />
              ))}
              {!menge.kanten &&
                teile.map((t) =>
                  t.plan!
                    .filter((f) => f.storeyId === s.id)
                    .map((f, i) => {
                      const bb = bounds(f.points);
                      if (bb.maxX - bb.minX < fs * 3.2 || bb.maxY - bb.minY < fs * 1.2) return null;
                      const lp = labelPoint(f.points, f.loecher ?? []);
                      // mehrere Flächen eines Teils (Wohnung): Name statt Wert
                      const text = t.plan!.length > 1 ? t.bezeichnung : `${fmt2(t.wert)}`;
                      return (
                        <text key={`${t.id}-${i}`} x={lp.x} y={lp.y + fs * 0.35} fontSize={fs} textAnchor="middle" className="mp-wert">
                          {text}
                        </text>
                      );
                    }),
                )}
              <g className="mp-leiste">
                <rect x={vb.x + rand} y={vb.y + vb.h - fs * 0.9} width={leiste} height={fs * 0.25} />
                <text x={vb.x + rand + leiste + fs * 0.4} y={vb.y + vb.h - fs * 0.55} fontSize={fs * 0.8}>
                  {String(leiste).replace('.', ',')} m
                </text>
              </g>
            </svg>
          </figure>
        );
      })}
    </div>
  );
}

function TeilFlaeche({ t, storeyId, kanten, aktiv, onAktiv }: { t: Teil; storeyId: string; kanten: boolean; aktiv: boolean; onAktiv: (id: string | null) => void }) {
  const abzug = t.wert < 0;
  return (
    <g className={`mp-teil${kanten ? ' kanten' : ''}${abzug ? ' abzug' : ''}${aktiv ? ' aktiv' : ''}`} onMouseEnter={() => onAktiv(t.id)}>
      <title>{`${t.bezeichnung}: ${fmt2(t.wert)}${t.ansatz ? ` (${t.ansatz})` : ''}`}</title>
      {t.plan!
        .filter((f) => f.storeyId === storeyId)
        .map((f, i) => (
          <path key={i} d={flaechenPfad(f)} fillRule="evenodd" fill={abzug && !kanten ? `url(#mp-abzug-${storeyId})` : undefined} vectorEffect="non-scaling-stroke" />
        ))}
    </g>
  );
}
