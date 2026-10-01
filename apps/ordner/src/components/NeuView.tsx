import { useEffect, useMemo, useState } from 'react';
import type { Anschrift, KontaktArt } from '@core/model';
import { saveBinaryFile } from '@core/platform/files';
import { logger } from '@core/platform/log';
import { Field, NumberField, TextField } from '@core/ui/fields';
import type { Eintrag } from '../dateisystem';
import { hatDateisystem, oeffneOrdner, SpeicherDateisystem, tauriDateisystem, verbinde, waehleOrdner, waehleOrdnerImBrowser } from '../dateisystem';
import { naechsteNummer } from '../nummer';
import type { Ergebnis, Herkunft, Vorlage } from '../plan';
import { ausfuehren, ladeVorlagen, planen } from '../plan';
import type { Beteiligter } from '../stammdaten';
import { LEISTUNGSPHASEN } from '../stammdaten';
import { useOrdner } from '../store';

const log = logger('anlegen');

const HERKUNFT: Record<Herkunft, string> = { struktur: 'Struktur', vorlage: 'Vorlage', stammdaten: 'Stammdaten', flaechen: 'leere Flächenberechnung' };

/** Neues Projekt: Stammdaten links, rechts der Trockenlauf – was angelegt wird und was schon da ist */
export function NeuView() {
  const desktop = hatDateisystem();
  const { stamm, struktur, stammordner, vorlagenordner, setStamm, setStammordner, setVorlagenordner, neuesProjekt } = useOrdner();
  const [vorlagen, setVorlagen] = useState<Vorlage[]>([]);
  const [vorlagenName, setVorlagenName] = useState('');
  const [vorhandene, setVorhandene] = useState<Eintrag[]>([]);
  const [projektordner, setProjektordner] = useState<string[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [ergebnis, setErgebnis] = useState<{ ordner: string; liste: Ergebnis[] } | null>(null);

  // Ordner im Stammordner: für den Nummernvorschlag
  useEffect(() => {
    if (!desktop || !stammordner) return setProjektordner([]);
    let aktuell = true;
    tauriDateisystem.liste(stammordner, 1).then(
      (l) => aktuell && setProjektordner(l.filter((e) => e.ordner).map((e) => e.pfad)),
      (e) => aktuell && setFehler(`Stammordner: ${e instanceof Error ? e.message : String(e)}`),
    );
    return () => {
      aktuell = false;
    };
  }, [desktop, stammordner, ergebnis]);

  // Vorlagen aus dem Vorlagenordner
  useEffect(() => {
    if (!desktop) return;
    if (!vorlagenordner) return setVorlagen([]);
    let aktuell = true;
    ladeVorlagen(tauriDateisystem, vorlagenordner).then(
      (v) => aktuell && setVorlagen(v),
      (e) => aktuell && setFehler(`Vorlagenordner: ${e instanceof Error ? e.message : String(e)}`),
    );
    return () => {
      aktuell = false;
    };
  }, [desktop, vorlagenordner]);

  const ordner = useMemo(() => planen(stamm, struktur, []).ordner, [stamm, struktur]);

  // was es im Projektordner schon gibt
  useEffect(() => {
    if (!desktop || !stammordner || !ordner || !projektordner.some((p) => p.toLowerCase() === ordner.toLowerCase())) return setVorhandene([]);
    let aktuell = true;
    tauriDateisystem.liste(verbinde(stammordner, ordner), 12).then(
      (l) => aktuell && setVorhandene(l),
      () => aktuell && setVorhandene([]),
    );
    return () => {
      aktuell = false;
    };
  }, [desktop, stammordner, ordner, projektordner]);

  const plan = useMemo(() => planen(stamm, struktur, vorlagen, vorhandene), [stamm, struktur, vorlagen, vorhandene]);
  const neu = plan.schritte.filter((s) => !s.vorhanden);
  const vorschlag = useMemo(() => naechsteNummer(struktur.nummernschema, projektordner), [struktur.nummernschema, projektordner]);

  const stammWaehlen = async () => {
    const p = await waehleOrdner('Stammordner für Projekte wählen');
    if (p) setStammordner(p);
  };
  const vorlagenWaehlen = async () => {
    setFehler(null);
    if (desktop) {
      const p = await waehleOrdner('Vorlagenordner wählen');
      if (p) setVorlagenordner(p);
      return;
    }
    const o = await waehleOrdnerImBrowser();
    if (!o) return;
    setVorlagen(o.eintraege.filter((e) => !e.ordner).map((e) => ({ pfad: e.pfad, lies: () => o.lies(e.pfad) })));
    setVorlagenName(o.name);
  };

  const anlegen = async () => {
    setFehler(null);
    setErgebnis(null);
    try {
      if (desktop) {
        setLaeuft('Projektordner wird angelegt …');
        const liste = await ausfuehren(tauriDateisystem, stammordner, plan, (i, n) => setLaeuft(`Projektordner wird angelegt … ${i} / ${n}`));
        log.info(`Projektordner angelegt: ${plan.ordner}`, { angelegt: liste.filter((x) => x.status === 'angelegt').length, fehler: liste.filter((x) => x.status === 'fehler').length });
        setErgebnis({ ordner: verbinde(stammordner, plan.ordner), liste });
      } else {
        setLaeuft('ZIP wird erstellt …');
        const fs = new SpeicherDateisystem();
        const liste = await ausfuehren(fs, '/zip', plan);
        const ok = await saveBinaryFile({ defaultName: `${plan.ordner}.zip`, data: fs.alsZip('/zip'), filterName: 'ZIP-Archiv', extension: 'zip', mime: 'application/zip' });
        if (ok) setErgebnis({ ordner: '', liste });
      }
    } catch (e) {
      log.error('Anlegen fehlgeschlagen', e instanceof Error ? e.message : String(e));
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setLaeuft(null);
    }
  };

  const setAdresse = (patch: Partial<Anschrift>) => setStamm({ adresse: { ...stamm.adresse, ...patch } });
  const setBauherrAdresse = (patch: Partial<Anschrift>) => setStamm({ bauherr: { ...stamm.bauherr, adresse: { ...stamm.bauherr.adresse, ...patch } } });
  const kontakte = (art: KontaktArt) =>
    stamm.bauherr.kontakte
      .filter((k) => k.art === art)
      .map((k) => k.wert)
      .join(', ');
  const setKontakte = (art: KontaktArt, text: string) =>
    setStamm({
      bauherr: {
        ...stamm.bauherr,
        kontakte: [
          ...stamm.bauherr.kontakte.filter((k) => k.art !== art),
          ...text
            .split(/[,;]+/)
            .map((w) => w.trim())
            .filter(Boolean)
            .map((wert) => ({ art, wert })),
        ],
      },
    });
  const setBeteiligter = (i: number, patch: Partial<Beteiligter>) => setStamm({ beteiligte: stamm.beteiligte.map((b, k) => (k === i ? { ...b, ...patch } : b)) });
  const toggleLph = (nr: number) => setStamm({ leistungsphasen: stamm.leistungsphasen.includes(nr) ? stamm.leistungsphasen.filter((x) => x !== nr) : [...stamm.leistungsphasen, nr].sort() });

  const angelegt = ergebnis?.liste.filter((x) => x.status === 'angelegt').length ?? 0;
  const unveraendert = ergebnis?.liste.filter((x) => x.status === 'vorhanden').length ?? 0;
  const fehlgeschlagen = ergebnis?.liste.filter((x) => x.status === 'fehler') ?? [];

  return (
    <div className="po-view">
      <section className="po-col">
        <h2>Projekt</h2>
        <div className="field-row">
          <Field label="Projektnummer" hint={desktop && stammordner && vorschlag !== stamm.nummer ? `nächste freie Nummer: ${vorschlag}` : `Schema ${struktur.nummernschema}`}>
            <TextField value={stamm.nummer} placeholder={vorschlag} onChange={(v) => setStamm({ nummer: v })} />
          </Field>
          <Field label="Kurzname" hint="wird Teil des Ordnernamens">
            <TextField value={stamm.kurzname} placeholder="z. B. EFH Musterweg" onChange={(v) => setStamm({ kurzname: v })} />
          </Field>
        </div>
        {vorschlag !== stamm.nummer && (!stamm.nummer.trim() || (desktop && !!stammordner)) && (
          <button className="small" onClick={() => setStamm({ nummer: vorschlag })} title="Nächste freie Nummer nach den Ordnern im Stammordner – bitte mit der Nummernvergabe im Büro abgleichen">
            Nummer {vorschlag} übernehmen
          </button>
        )}
        <Field label="Bezeichnung des Vorhabens">
          <TextField value={stamm.bezeichnung} placeholder="z. B. Neubau eines Einfamilienhauses mit Garage" onChange={(v) => setStamm({ bezeichnung: v })} />
        </Field>
        <Field label="Bauvorhaben – Straße und Hausnummer">
          <TextField value={stamm.adresse.strasse} onChange={(v) => setAdresse({ strasse: v })} />
        </Field>
        <div className="field-row">
          <Field label="PLZ">
            <TextField value={stamm.adresse.plz} onChange={(v) => setAdresse({ plz: v })} />
          </Field>
          <Field label="Ort">
            <TextField value={stamm.adresse.ort} onChange={(v) => setAdresse({ ort: v })} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Gemarkung">
            <TextField value={stamm.grundstueck.gemarkung} onChange={(v) => setStamm({ grundstueck: { ...stamm.grundstueck, gemarkung: v } })} />
          </Field>
          <Field label="Flur">
            <TextField value={stamm.grundstueck.flur} onChange={(v) => setStamm({ grundstueck: { ...stamm.grundstueck, flur: v } })} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Flurstück">
            <TextField value={stamm.grundstueck.flurstueck} onChange={(v) => setStamm({ grundstueck: { ...stamm.grundstueck, flurstueck: v } })} />
          </Field>
          <Field label="Grundstücksfläche [m²]">
            <NumberField value={stamm.grundstueck.flaeche} allowEmpty min={0} onChange={(v) => setStamm({ grundstueck: { ...stamm.grundstueck, flaeche: v } })} />
          </Field>
        </div>

        <h2>Bauherr</h2>
        <Field label="Name">
          <TextField value={stamm.bauherr.name} onChange={(v) => setStamm({ bauherr: { ...stamm.bauherr, name: v } })} />
        </Field>
        <Field label="Straße und Hausnummer">
          <TextField value={stamm.bauherr.adresse.strasse} onChange={(v) => setBauherrAdresse({ strasse: v })} />
        </Field>
        <div className="field-row">
          <Field label="PLZ">
            <TextField value={stamm.bauherr.adresse.plz} onChange={(v) => setBauherrAdresse({ plz: v })} />
          </Field>
          <Field label="Ort">
            <TextField value={stamm.bauherr.adresse.ort} onChange={(v) => setBauherrAdresse({ ort: v })} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="E-Mail" hint="mehrere mit Komma">
            <TextField value={kontakte('email')} onChange={(v) => setKontakte('email', v)} />
          </Field>
          <Field label="Telefon">
            <TextField value={kontakte('telefon')} onChange={(v) => setKontakte('telefon', v)} />
          </Field>
        </div>

        <h2>Leistungen und Beteiligte</h2>
        <div className="po-lph" title="Ordner und Vorlagen, die an Leistungsphasen gebunden sind, entstehen nur für die gewählten. Ohne Auswahl entsteht alles.">
          {LEISTUNGSPHASEN.map((l) => (
            <label key={l.nr} className="toggle" title={l.label}>
              <input type="checkbox" checked={stamm.leistungsphasen.includes(l.nr)} onChange={() => toggleLph(l.nr)} />
              LPh {l.nr}
            </label>
          ))}
        </div>
        <Field label="Bearbeitung">
          <TextField value={stamm.bearbeiter} onChange={(v) => setStamm({ bearbeiter: v })} />
        </Field>
        {stamm.beteiligte.length > 0 && (
          <table className="po-table po-beteiligte">
            <thead>
              <tr>
                <th>Rolle</th>
                <th>Name / Büro</th>
                <th>Kontakt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stamm.beteiligte.map((b, i) => (
                <tr key={i}>
                  <td>
                    <TextField value={b.rolle} placeholder="z. B. Tragwerk" onChange={(v) => setBeteiligter(i, { rolle: v })} />
                  </td>
                  <td>
                    <TextField value={b.name} onChange={(v) => setBeteiligter(i, { name: v })} />
                  </td>
                  <td>
                    <TextField value={b.kontakt} onChange={(v) => setBeteiligter(i, { kontakt: v })} />
                  </td>
                  <td>
                    <button className="small danger" title="Beteiligten entfernen" onClick={() => setStamm({ beteiligte: stamm.beteiligte.filter((_, k) => k !== i) })}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="button-row">
          <button className="small" onClick={() => setStamm({ beteiligte: [...stamm.beteiligte, { rolle: '', name: '', kontakt: '' }] })}>
            + Beteiligter
          </button>
          <button className="small" onClick={neuesProjekt} title="Formular leeren (Bearbeitung bleibt stehen)">
            Formular leeren
          </button>
        </div>
      </section>

      <section className="po-col">
        <h2>Trockenlauf</h2>
        <div className="po-ort">
          <div>
            <span className="field-label">Stammordner für Projekte</span>
            {desktop ? <code title={stammordner}>{stammordner || 'noch nicht gewählt'}</code> : <span className="muted small-text">Im Browser entsteht der Projektordner als ZIP-Datei.</span>}
          </div>
          {desktop && (
            <button className="small" onClick={() => void stammWaehlen()}>
              Wählen …
            </button>
          )}
        </div>
        <div className="po-ort">
          <div>
            <span className="field-label">Vorlagenordner</span>
            <code title={vorlagenordner}>{(desktop ? vorlagenordner : vorlagenName) || 'keiner – es entstehen nur Ordner, Stammdaten und die leere Flächenberechnung'}</code>
          </div>
          <button className="small" onClick={() => void vorlagenWaehlen()}>
            Wählen …
          </button>
          {(desktop ? vorlagenordner : vorlagenName) && (
            <button
              className="small"
              onClick={() => {
                setVorlagenordner('');
                setVorlagen([]);
                setVorlagenName('');
              }}
            >
              Ohne Vorlagen
            </button>
          )}
        </div>

        <h3>
          {plan.ordner || 'Projektordner'}
          <span className="muted small-text">
            {' '}
            – {neu.filter((s) => s.art === 'ordner').length} Ordner und {neu.filter((s) => s.art === 'datei').length} Dateien werden angelegt
          </span>
        </h3>
        {plan.fehler.map((f) => (
          <p key={f} className="warning">
            {f}
          </p>
        ))}
        {fehler && <p className="warning">{fehler}</p>}
        <div className="po-plan">
          <table className="po-table">
            <tbody>
              {plan.schritte.map((s) => {
                const tiefe = s.pfad.split('/').length - 1;
                return (
                  <tr key={`${s.art}:${s.pfad}`} className={s.vorhanden ? 'vorhanden' : ''}>
                    <td style={{ paddingLeft: 6 + tiefe * 16 }} title={s.pfad}>
                      <span className={`po-art ${s.art}`} aria-hidden />
                      {s.pfad.split('/').pop()}
                    </td>
                    <td className="muted small-text" title={s.quelle}>
                      {s.art === 'datei' || s.herkunft === 'vorlage' ? HERKUNFT[s.herkunft] : ''}
                    </td>
                    <td className="po-status">{s.vorhanden ? 'vorhanden' : 'neu'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {plan.hinweise.length > 0 && (
          <ul className="po-hinweise">
            {plan.hinweise.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
        <div className="button-row">
          <button className="primary" disabled={!!laeuft || plan.fehler.length > 0 || (desktop && !stammordner) || !neu.length} onClick={() => void anlegen()}>
            {desktop ? 'Projektordner anlegen' : 'Als ZIP herunterladen'}
          </button>
          {laeuft && <span className="busy">{laeuft}</span>}
        </div>
        <p className="muted small-text">Es wird nur neu angelegt. Vorhandene Ordner und Dateien bleiben unverändert; nichts wird überschrieben, verschoben oder gelöscht.</p>

        {ergebnis && (
          <div className={`po-ergebnis${fehlgeschlagen.length ? ' fehler' : ''}`}>
            <strong>
              {angelegt} angelegt{unveraendert ? `, ${unveraendert} schon vorhanden` : ''}
              {fehlgeschlagen.length ? `, ${fehlgeschlagen.length} fehlgeschlagen` : ''}
            </strong>
            {ergebnis.ordner && <code>{ergebnis.ordner}</code>}
            {fehlgeschlagen.length > 0 && (
              <ul>
                {fehlgeschlagen.map((f) => (
                  <li key={f.schritt.pfad}>
                    {f.schritt.pfad}: {f.meldung}
                  </li>
                ))}
              </ul>
            )}
            <div className="button-row">
              {ergebnis.ordner && (
                <button className="small" onClick={() => void oeffneOrdner(ergebnis.ordner).catch((e) => setFehler(String(e)))}>
                  Ordner öffnen
                </button>
              )}
              <button
                className="small"
                onClick={() => {
                  neuesProjekt();
                  setErgebnis(null);
                }}
              >
                Nächstes Projekt
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
