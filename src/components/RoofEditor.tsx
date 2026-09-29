import { useMemo, useState } from 'react';
import { modellRoofParams } from '../core/calc';
import { fmt2 } from '../core/format';
import { rectPoints } from '../core/geometry';
import type { OutlineShape, Project, Storey } from '../core/model';
import type { Gaube, GaubenTyp } from '../core/gaube';
import { defaultGaube, GAUBEN_TYPEN, gaubenMasse, gaubenMoeglich, gaubenVolumen } from '../core/gaube';
import type { Dach, DachTyp, Point3 } from '../core/roof';
import { DACH_TYPEN, defaultDach, roofFrame, roofStats, solidFaces } from '../core/roof';
import { meshRoofStats } from '../core/roofMesh';
import { dachAusModell } from '../core/roofFit';
import { Field, NumberField } from './fields';

/** Dach / oberer Abschluss eines BGF-Umrisses. */
export function RoofEditor({
  shape,
  storey,
  project,
  onChange,
}: {
  shape: OutlineShape;
  storey: Storey;
  project: Project;
  onChange: (dach: Dach | undefined) => void;
}) {
  const d = shape.dach;
  const h = shape.hoehe ?? storey.hoehe;
  const stats = useMemo(() => {
    if (!d) return null;
    if (d.typ === 'modell') {
      if (!project.dachModell) return null;
      const r = modellRoofParams(project, storey, shape);
      const m = meshRoofStats(project.dachModell, shape.points, r.floorZ, h, r.cap);
      return { volumen: m.volumen, firsthoehe: m.firsthoehe, info: `Dachhaut über ${Math.round(m.abdeckung * 100)} % der Fläche` };
    }
    const s = roofStats(d, shape.points);
    const g = gaubenVolumen(d);
    return { volumen: s.volumen + g, firsthoehe: s.firsthoehe, info: `Firstrichtung ${fmt2(s.frame.angle)}°${g ? ` · davon Gauben ${fmt2(g)} m³` : ''}` };
  }, [d, shape.points, project, storey, h]);

  const set = (patch: Partial<Dach>) => d && onChange({ ...d, ...patch });
  const [erkennung, setErkennung] = useState<string | null>(null);

  /** Dachform und Gauben aus dem Modell ableiten; Gaubenwände aus der mitgespeicherten IFC-Datei */
  const erkennen = async () => {
    if (!project.dachModell) return;
    const r = modellRoofParams(project, storey, shape);
    if (r.cap !== Infinity) {
      setErkennung(storey.geschosshoeheBegrenzt ? 'Nicht möglich, solange der BRI dieses Geschosses auf die Geschosshöhe begrenzt ist.' : 'Nur für den obersten Abschluss möglich – darüber liegt ein Geschoss mit BGF.');
      return;
    }
    setErkennung('Dach wird analysiert …');
    let waende: ArrayLike<number>[] = [];
    const ifc = project.dateien?.filter((x) => x.art === 'ifc').pop();
    if (ifc) {
      try {
        const { loadIfc } = await import('../platform/ifc');
        const x = await loadIfc(ifc.daten.slice());
        waende = x.elements.filter((e) => e.type.startsWith('IFCWALL') || e.type === 'IFCWINDOW' || /gaube|dormer/i.test(e.name)).map((e) => e.tris);
      } catch {
        // ohne Wände: Gaubenmaße aus dem Gaubendach
      }
    }
    const e = dachAusModell(project.dachModell, shape.points, r.floorZ, waende);
    if (e.dach) {
      onChange(e.dach);
      setErkennung(`${e.text} übernommen (Abweichung zum Modell ${(e.abweichung * 100).toFixed(1).replace('.', ',')} %).`);
    } else setErkennung(`Nicht übernommen: ${e.grund}.`);
  };
  const choose = (typ: DachTyp | 'kein') => {
    if (typ === 'kein') onChange(undefined);
    else if (typ === 'modell') onChange({ typ: 'modell', traufhoehe: h, neigung: 0, maxHoehe: d?.maxHoehe });
    else {
      // bewährte Werte übernehmen, wenn nur die Form gewechselt wird
      const base = defaultDach(typ, d?.traufhoehe ?? h);
      onChange({ ...base, firstrichtung: d?.firstrichtung, gauben: d?.gauben });
    }
  };

  return (
    <div className="roof-editor">
      <h3>Dach / oberer Abschluss</h3>
      <div className="roof-grid">
        <button className={!d ? 'roof-choice active' : 'roof-choice'} onClick={() => choose('kein')} title="Kein Dach: Fläche × Höhe">
          <RoofIcon typ={null} />
          <span>ohne</span>
        </button>
        {DACH_TYPEN.map((t) => (
          <button key={t.id} className={d?.typ === t.id ? 'roof-choice active' : 'roof-choice'} onClick={() => choose(t.id)} title={t.hint}>
            <RoofIcon typ={t.id} />
            <span>{t.label}</span>
          </button>
        ))}
        {project.dachModell && (
          <button
            className={d?.typ === 'modell' ? 'roof-choice active' : 'roof-choice'}
            onClick={() => choose('modell')}
            title={`Dachhaut aus dem importierten Modell (${project.dachModell.name})`}
          >
            <span className="roof-ifc">IFC</span>
            <span>aus Modell</span>
          </button>
        )}
      </div>

      {!d && <p className="muted small-text">BRI = Fläche × {shape.hoehe !== undefined ? 'abweichende Höhe' : 'Geschosshöhe'}. Für das oberste Geschoss hier die Dachform wählen.</p>}

      {d && d.typ !== 'modell' && (
        <>
          <div className="field-row">
            <Field label="Traufhöhe [m]" hint="OK Dachhaut an der Außenwand über Fußboden">
              <NumberField value={d.traufhoehe} min={0} onChange={(v) => v !== undefined && set({ traufhoehe: v })} />
            </Field>
            {d.typ !== 'flach' && d.typ !== 'tonne' && d.typ !== 'shed' && (
              <Field label={d.typ.startsWith('mansard') ? 'Neigung oben [°]' : 'Neigung [°]'}>
                <NumberField value={d.neigung} min={0} max={89} digits={1} onChange={(v) => v !== undefined && set({ neigung: v })} />
              </Field>
            )}
          </div>
          {(d.typ === 'walm' || d.typ === 'kruppelwalm') && (
            <Field label="Neigung Walm [°]">
              <NumberField value={d.neigungWalm ?? d.neigung} min={0} max={89} digits={1} onChange={(v) => v !== undefined && set({ neigungWalm: v })} />
            </Field>
          )}
          {d.typ === 'kruppelwalm' && (
            <Field label="Höhe Krüppelwalm [m]" hint="senkrecht vom First nach unten">
              <NumberField value={d.krueppelHoehe} min={0} onChange={(v) => v !== undefined && set({ krueppelHoehe: v })} />
            </Field>
          )}
          {(d.typ === 'mansard' || d.typ === 'mansardwalm') && (
            <div className="field-row">
              <Field label="Neigung unten [°]">
                <NumberField value={d.neigungUnten} min={0} max={89} digits={1} onChange={(v) => v !== undefined && set({ neigungUnten: v })} />
              </Field>
              <Field label="Höhe unten [m]">
                <NumberField value={d.hoeheUnten} min={0} onChange={(v) => v !== undefined && set({ hoeheUnten: v })} />
              </Field>
            </div>
          )}
          {d.typ === 'tonne' && (
            <Field label="Stichhöhe [m]">
              <NumberField value={d.stich} min={0.01} onChange={(v) => v !== undefined && set({ stich: v })} />
            </Field>
          )}
          {d.typ === 'shed' && (
            <div className="field-row">
              <Field label="Anzahl Sheds">
                <NumberField value={d.shedAnzahl} min={1} max={50} digits={0} onChange={(v) => v !== undefined && set({ shedAnzahl: Math.round(v) })} />
              </Field>
              <Field label="Höhe je Shed [m]">
                <NumberField value={d.shedHoehe} min={0} onChange={(v) => v !== undefined && set({ shedHoehe: v })} />
              </Field>
            </div>
          )}
          {d.typ !== 'flach' && (
            <div className="button-row">
              <button className="small" onClick={() => set({ firstrichtung: (roofStats(d, shape.points).frame.angle + 90) % 180 })}>
                ⟳ Firstrichtung drehen
              </button>
              {d.typ === 'pult' && (
                <button className="small" onClick={() => set({ umkehren: !d.umkehren })}>
                  ⇅ Hohe Seite wechseln
                </button>
              )}
              {d.firstrichtung !== undefined && (
                <button className="small" onClick={() => set({ firstrichtung: undefined })} title="Firstrichtung wieder automatisch entlang der längsten Kante">
                  automatisch
                </button>
              )}
            </div>
          )}
          {gaubenMoeglich(d) && <GaubenEditor dach={d} points={shape.points} onChange={(gauben) => set({ gauben: gauben.length ? gauben : undefined })} />}
        </>
      )}
      {d?.typ === 'modell' && (
        <Field
          label="Höhe begrenzen auf [m]"
          hint="leer = automatisch: bis zum nächsten Geschoss, soweit dieses dort BGF hat – sonst bis zur Dachhaut (z. B. Dachspitze als eigenes Geschoss)"
        >
          <NumberField value={d.maxHoehe} allowEmpty min={0} onChange={(v) => onChange({ ...d, maxHoehe: v })} />
        </Field>
      )}
      {d?.typ === 'modell' && project.dachModell && (
        <div className="button-row">
          <button className="small" onClick={erkennen} title="Dachform, Neigung, Traufhöhe und Gauben aus dem Modell ableiten – für den BRI mit Formeln">
            Dachform und Gauben erkennen
          </button>
        </div>
      )}
      {erkennung && <p className="muted small-text">{erkennung}</p>}
      {stats && (
        <div className="metric-row">
          <div className="metric">
            <span>BRI dieses Umrisses</span>
            <strong>{fmt2(stats.volumen)} m³</strong>
          </div>
          <div className="metric">
            <span>max. Höhe</span>
            <strong>{fmt2(stats.firsthoehe)} m</strong>
          </div>
        </div>
      )}
      {stats && <p className="muted small-text">{stats.info}</p>}
    </div>
  );
}

/* ---------- Gauben ---------- */

function GaubenEditor({ dach, points, onChange }: { dach: Dach; points: OutlineShape['points']; onChange: (g: Gaube[]) => void }) {
  const gauben = dach.gauben ?? [];
  const fr = roofFrame(dach, points);
  const L = fr.u1 - fr.u0;
  const B = fr.v1 - fr.v0;
  // Gauben enden spätestens am First (Pultdach: an der hohen Traufe)
  const maxTiefe = dach.typ === 'pult' ? B : B / 2;
  const upd = (i: number, patch: Partial<Gaube>) => onChange(gauben.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const zweiSeiten = dach.typ !== 'pult';

  return (
    <div className="gauben">
      <h3>Gauben</h3>
      {!gauben.length && <p className="muted small-text">Rauminhalt über der Dachfläche, z. B. Schleppgaube B × T² × (tan α − tan β) / 2.</p>}
      {gauben.map((g, i) => {
        const m = gaubenMasse(g, dach);
        const warn: string[] = [];
        if (g.vorne + m.tiefe > maxTiefe + 1e-6) warn.push('reicht über den First hinaus');
        if (g.abstand < -1e-6 || g.abstand + g.breite > L + 1e-6) warn.push('ragt seitlich über das Dach hinaus');
        if (g.typ === 'schlepp' && (g.neigung ?? 0) >= m.alpha) warn.push('Gaubendach muss flacher sein als das Hauptdach');
        return (
          <div key={i} className="gaube">
            <div className="field-row">
              <Field label="Art">
                <select value={g.typ} onChange={(e) => upd(i, { typ: e.target.value as GaubenTyp })}>
                  {GAUBEN_TYPEN.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              {zweiSeiten && (
                <Field label="Dachseite">
                  <select value={g.seite} onChange={(e) => upd(i, { seite: e.target.value === '1' ? 1 : 0 })}>
                    <option value={0}>Traufseite 1</option>
                    <option value={1}>Traufseite 2</option>
                  </select>
                </Field>
              )}
            </div>
            <div className="field-row">
              <Field label="Breite B [m]">
                <NumberField value={g.breite} min={0.1} digits={3} onChange={(v) => v !== undefined && upd(i, { breite: v })} />
              </Field>
              <Field label="Abstand vom Rand [m]" hint="in Firstrichtung">
                <NumberField value={g.abstand} min={0} digits={3} onChange={(v) => v !== undefined && upd(i, { abstand: v })} />
              </Field>
              <Field label="Abstand Traufe [m]" hint="waagerecht bis Vorderwand">
                <NumberField value={g.vorne} min={0} digits={3} onChange={(v) => v !== undefined && upd(i, { vorne: v })} />
              </Field>
            </div>
            {g.typ === 'sattel' ? (
              <div className="field-row">
                <Field label="Wandhöhe h [m]" hint="Vorderwand über Dachfläche">
                  <NumberField value={g.wandhoehe ?? 1.2} min={0} digits={3} onChange={(v) => v !== undefined && upd(i, { wandhoehe: v })} />
                </Field>
                <Field label="Neigung γ [°]">
                  <NumberField value={g.dachneigung ?? 45} min={0} max={89} digits={1} onChange={(v) => v !== undefined && upd(i, { dachneigung: v })} />
                </Field>
              </div>
            ) : (
              <div className="field-row">
                <Field label="Tiefe T [m]" hint="waagerecht bis Anschluss Hauptdach">
                  <NumberField value={g.tiefe ?? 2} min={0} digits={3} onChange={(v) => v !== undefined && upd(i, { tiefe: v })} />
                </Field>
                {g.typ === 'schlepp' && (
                  <Field label="Neigung β [°]">
                    <NumberField value={g.neigung ?? 15} min={0} max={89} digits={1} onChange={(v) => v !== undefined && upd(i, { neigung: v })} />
                  </Field>
                )}
              </div>
            )}
            <div className="gaube-foot">
              <span className="small-text">
                {g.name ? `${g.name} · ` : ''}
                {fmt2(m.volumen)} m³ · Vorderwand {fmt2(m.hVorne + m.giebel)} m über Dachfläche
              </span>
              <span className="button-row">
                <button className="small" onClick={() => onChange([...gauben.slice(0, i + 1), { ...g, name: undefined }, ...gauben.slice(i + 1)])} title="Gleiche Gaube noch einmal">
                  duplizieren
                </button>
                <button className="small danger" onClick={() => onChange(gauben.filter((_, k) => k !== i))}>
                  entfernen
                </button>
              </span>
            </div>
            {warn.length > 0 && <p className="warning small-text">Gaube {warn.join(', ')}.</p>}
          </div>
        );
      })}
      <button className="small" onClick={() => onChange([...gauben, defaultGaube(dach, fr)])}>
        + Gaube
      </button>
    </div>
  );
}

/* ---------- Symbole ---------- */

const ICON_PTS = rectPoints({ x: 0, y: 0 }, { x: 10, y: 6 });

/** Isometrische Skizze der Dachform, erzeugt aus derselben Geometrie wie die Berechnung */
export function RoofIcon({ typ }: { typ: DachTyp | null }) {
  const paths = useMemo(() => {
    const d = typ ? { ...defaultDach(typ, 3), ...(typ === 'flach' ? { traufhoehe: 3.6 } : {}), ...(typ === 'mansard' || typ === 'mansardwalm' ? { hoeheUnten: 1.6 } : {}), ...(typ === 'pult' ? { neigung: 18 } : {}) } : undefined;
    const faces = solidFaces(ICON_PTS, d, 3.6);
    const proj = (p: Point3) => ({ x: (p.x - p.y) * 0.866, y: (p.x + p.y) * 0.5 - p.z * 1.1 });
    const all = [...faces.sides.map((f) => ({ f, roof: false })), ...faces.tops.map((f) => ({ f, roof: true }))];
    // Maler-Algorithmus: weiter hinten (kleines x + y) zuerst
    const depth = (f: Point3[]) => f.reduce((s, p) => s + p.x + p.y + p.z * 0.3, 0) / f.length;
    all.sort((a, b) => depth(a.f) - depth(b.f));
    return all.map(({ f, roof }) => {
      // einfache Schattierung über die Flächennormale
      const [a, b, c] = f;
      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const uz = b.z - a.z;
      const vx = (c ?? b).x - a.x;
      const vy = (c ?? b).y - a.y;
      const vz = (c ?? b).z - a.z;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      const light = Math.abs((nx * 0.3 + ny * 0.6 + nz * 0.75) / len);
      const shade = roof && typ ? `hsl(8 55% ${38 + light * 30}%)` : `hsl(40 20% ${70 + light * 22}%)`;
      return { d: f.map((p, i) => `${i ? 'L' : 'M'}${proj(p).x.toFixed(2)} ${proj(p).y.toFixed(2)}`).join('') + 'Z', fill: shade };
    });
  }, [typ]);
  return (
    <svg viewBox="-5.8 -7.2 15.2 15.6" className="roof-icon">
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill} stroke="#444" strokeWidth={0.12} strokeLinejoin="round" />
      ))}
    </svg>
  );
}
