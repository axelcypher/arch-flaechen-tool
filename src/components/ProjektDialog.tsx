import { useState } from 'react';
import { fmt2, parseNum } from '../core/format';
import type { Anschrift, KontaktArt, Project, ProjectMeta } from '../core/model';
import { flurText, plzOrt } from '../core/model';
import { useEditor } from '../store/store';

/** Projektdaten in der Seitenleiste: nur Anzeige, Bearbeiten über den Dialog. */
export function ProjektInfo() {
  const project = useEditor((s) => s.project);
  const [open, setOpen] = useState(false);
  const m = project.meta;
  const b = m.bauherr;
  const adresse = (a: Anschrift) => [a.strasse, plzOrt(a)].filter((x) => x.trim());
  const flur = flurText(m.grundstueck);
  const hatBauherr = b.name.trim() || adresse(b.adresse).length || b.kontakte.some((k) => k.wert.trim());

  return (
    <>
      <div className="projekt-info">
        {m.projektcode && <div className="projekt-code">{m.projektcode}</div>}
        <div className="projekt-name">{project.name}</div>
        {adresse(m.adresse).map((z, i) => (
          <div key={`a${i}`}>{z}</div>
        ))}
        {(flur || m.grundstueck.flaeche !== undefined) && (
          <div className="projekt-block">
            {flur && <div>{flur}</div>}
            {m.grundstueck.flaeche !== undefined && <div>Grundstücksfläche {fmt2(m.grundstueck.flaeche)} m²</div>}
          </div>
        )}
        {hatBauherr && (
          <>
            <hr />
            {b.name && <div className="projekt-name">{b.name}</div>}
            {adresse(b.adresse).map((z, i) => (
              <div key={`b${i}`}>{z}</div>
            ))}
            {b.kontakte
              .filter((k) => k.wert.trim())
              .map((k, i) => (
                <div key={`k${i}`}>
                  <span className="muted">{k.art === 'email' ? 'E-Mail' : 'Tel.'}</span>{' '}
                  {k.art === 'email' ? <a href={`mailto:${k.wert.trim()}`}>{k.wert}</a> : k.wert}
                </div>
              ))}
          </>
        )}
        {!m.projektcode && !adresse(m.adresse).length && !hatBauherr && <div className="muted small-text">Noch keine Projektdaten erfasst.</div>}
      </div>
      <button className="small" onClick={() => setOpen(true)}>
        Projektdaten bearbeiten …
      </button>
      {open && <ProjektDialog project={project} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProjektDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [name, setName] = useState(project.name);
  const [m, setM] = useState<ProjectMeta>(() => structuredClone(project.meta));
  const [flaeche, setFlaeche] = useState(project.meta.grundstueck.flaeche !== undefined ? fmt2(project.meta.grundstueck.flaeche).replace(/\./g, '') : '');
  // „1.234,50“: Tausenderpunkte entfernen, wenn ein Dezimalkomma folgt
  const flaecheWert = flaeche.trim() === '' ? undefined : parseNum(flaeche.includes(',') ? flaeche.replace(/\./g, '') : flaeche);
  const flaecheFehler = flaeche.trim() !== '' && (flaecheWert === null || flaecheWert! < 0);

  const setAdresse = (patch: Partial<Anschrift>) => setM({ ...m, adresse: { ...m.adresse, ...patch } });
  const setBauherr = (patch: Partial<ProjectMeta['bauherr']>) => setM({ ...m, bauherr: { ...m.bauherr, ...patch } });
  const setBauherrAdresse = (patch: Partial<Anschrift>) => setBauherr({ adresse: { ...m.bauherr.adresse, ...patch } });
  const setGrundstueck = (patch: Partial<ProjectMeta['grundstueck']>) => setM({ ...m, grundstueck: { ...m.grundstueck, ...patch } });
  const kontakte = m.bauherr.kontakte;

  const speichern = () => {
    if (flaecheFehler) return;
    const grundstueck = { ...m.grundstueck };
    if (flaecheWert === undefined || flaecheWert === null) delete grundstueck.flaeche;
    else grundstueck.flaeche = flaecheWert;
    // leere Kontakte nicht speichern
    const meta: ProjectMeta = { ...m, grundstueck, bauherr: { ...m.bauherr, kontakte: kontakte.filter((k) => k.wert.trim()) } };
    // ein Rückgängig-Schritt für alle Änderungen
    useEditor.getState().update((p) => ({ ...p, name: name.trim() || p.name, meta }));
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide projekt-dialog" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Projektdaten</h3>

        <h4>Projekt</h4>
        <div className="field-row">
          <Eingabe label="Projektcode" value={m.projektcode} onChange={(v) => setM({ ...m, projektcode: v })} />
          <Eingabe label="Bezeichnung" value={name} onChange={setName} wide />
        </div>
        <AnschriftFelder a={m.adresse} onChange={setAdresse} />
        <Eingabe label="Bearbeiter" value={m.bearbeiter} onChange={(v) => setM({ ...m, bearbeiter: v })} />

        <h4>Grundstück</h4>
        <div className="field-row">
          <Eingabe label="Gemarkung" value={m.grundstueck.gemarkung} onChange={(v) => setGrundstueck({ gemarkung: v })} wide />
          <Eingabe label="Flur" value={m.grundstueck.flur} onChange={(v) => setGrundstueck({ flur: v })} />
          <Eingabe label="Flurstück" value={m.grundstueck.flurstueck} onChange={(v) => setGrundstueck({ flurstueck: v })} />
        </div>
        <div className="field-row">
          <Eingabe label="Grundstücksfläche [m²]" value={flaeche} onChange={setFlaeche} />
          <span className="field" />
          <span className="field" />
        </div>
        {flaecheFehler && <p className="warning small-text">Grundstücksfläche bitte als Zahl eingeben, z. B. 523,40.</p>}

        <h4>Bauherr</h4>
        <Eingabe label="Name" value={m.bauherr.name} onChange={(v) => setBauherr({ name: v })} />
        <AnschriftFelder a={m.bauherr.adresse} onChange={setBauherrAdresse} />
        <span className="field-label">Kontakt</span>
        {kontakte.map((k, i) => (
          <div key={i} className="kontakt-row">
            <select value={k.art} onChange={(e) => setBauherr({ kontakte: kontakte.map((x, j) => (j === i ? { ...x, art: e.target.value as KontaktArt } : x)) })}>
              <option value="email">E-Mail</option>
              <option value="telefon">Telefon</option>
            </select>
            <input
              value={k.wert}
              type={k.art === 'email' ? 'email' : 'tel'}
              placeholder={k.art === 'email' ? 'name@beispiel.de' : '02921 12345'}
              onChange={(e) => setBauherr({ kontakte: kontakte.map((x, j) => (j === i ? { ...x, wert: e.target.value } : x)) })}
            />
            <button className="small danger" title="Kontakt entfernen" onClick={() => setBauherr({ kontakte: kontakte.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <div className="button-row">
          <button className="small" onClick={() => setBauherr({ kontakte: [...kontakte, { art: 'email', wert: '' }] })}>
            + E-Mail
          </button>
          <button className="small" onClick={() => setBauherr({ kontakte: [...kontakte, { art: 'telefon', wert: '' }] })}>
            + Telefon
          </button>
        </div>

        <div className="dialog-buttons">
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" onClick={speichern} disabled={flaecheFehler}>
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}

function AnschriftFelder({ a, onChange }: { a: Anschrift; onChange: (patch: Partial<Anschrift>) => void }) {
  return (
    <>
      <Eingabe label="Straße und Hausnummer" value={a.strasse} onChange={(v) => onChange({ strasse: v })} />
      <div className="field-row">
        <Eingabe label="PLZ" value={a.plz} onChange={(v) => onChange({ plz: v })} />
        <Eingabe label="Ort" value={a.ort} onChange={(v) => onChange({ ort: v })} wide />
      </div>
    </>
  );
}

/** direkt gebundenes Eingabefeld (der Dialog übernimmt erst mit „Übernehmen“) */
function Eingabe({ label, value, onChange, wide }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <label className="field" style={wide ? { flex: 2 } : undefined}>
      <span className="field-label">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
