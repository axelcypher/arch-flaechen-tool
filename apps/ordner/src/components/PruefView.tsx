import { useState } from 'react';
import { logger } from '@core/platform/log';
import type { Eintrag } from '../dateisystem';
import { hatDateisystem, oeffneOrdner, tauriDateisystem, waehleOrdner, waehleOrdnerImBrowser } from '../dateisystem';
import type { BefundArt, Pruefergebnis } from '../pruefung';
import { pruefe } from '../pruefung';
import type { ProjektDatei } from '../stammdaten';
import { leseProjektJson, PROJEKT_DATEI } from '../stammdaten';
import { useOrdner } from '../store';

const log = logger('pruefen');

const ART: Record<BefundArt, string> = { fehler: 'Fehler', warnung: 'Abweichung', hinweis: 'Hinweis', ok: 'in Ordnung' };
const MAX_PFADE = 40;

interface Geprueft {
  /** vollständiger Pfad (Desktop) bzw. leer im Browser */
  pfad: string;
  name: string;
  projekt: ProjektDatei | null;
  ergebnis: Pruefergebnis;
}

/** Prüfmodus: Projektordner einlesen und Abweichungen von der Struktur melden */
export function PruefView({ onUebernommen }: { onUebernommen: () => void }) {
  const desktop = hatDateisystem();
  const struktur = useOrdner((s) => s.struktur);
  const [g, setG] = useState<Geprueft | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const auswerten = async (pfad: string, name: string, eintraege: Eintrag[], lies: (p: string) => Promise<Uint8Array>) => {
    let projekt: ProjektDatei | null = null;
    let projektFehler: string | undefined;
    const datei = eintraege.find((e) => !e.ordner && e.pfad.toLowerCase() === PROJEKT_DATEI);
    if (datei) {
      try {
        projekt = leseProjektJson(new TextDecoder('utf-8').decode(await lies(datei.pfad)));
      } catch (e) {
        projektFehler = e instanceof Error ? e.message : String(e);
      }
    }
    const ergebnis = pruefe(name, eintraege, struktur, projekt, projektFehler);
    log.info(`Ordner geprüft: ${name}`, { ordner: ergebnis.ordner, dateien: ergebnis.dateien, befunde: ergebnis.befunde.filter((b) => b.art !== 'ok').length });
    setG({ pfad, name, projekt, ergebnis });
  };

  const pruefenPfad = async (pfad: string) => {
    setLaeuft(true);
    setFehler(null);
    try {
      const name = pfad.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? pfad;
      await auswerten(pfad, name, await tauriDateisystem.liste(pfad, 12), (p) => tauriDateisystem.lies(pfad, p));
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  };

  const waehlen = async () => {
    setFehler(null);
    if (desktop) {
      const p = await waehleOrdner('Projektordner wählen');
      if (p) await pruefenPfad(p);
      return;
    }
    const o = await waehleOrdnerImBrowser();
    if (o) await auswerten('', o.name, o.eintraege, o.lies);
  };

  const fehlendeAnlegen = async () => {
    if (!g?.pfad) return;
    setLaeuft(true);
    try {
      for (const p of g.ergebnis.fehlendeOrdner) await tauriDateisystem.ordnerAnlegen(g.pfad, p);
      log.info(`Fehlende Ordner angelegt: ${g.name}`, g.ergebnis.fehlendeOrdner);
      await pruefenPfad(g.pfad);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
      setLaeuft(false);
    }
  };

  const uebernehmen = () => {
    if (!g?.projekt) return;
    const { format: _f, version: _v, angelegt: _a, struktur: _s, dateischema: _d, ...stamm } = g.projekt;
    useOrdner.getState().setStamm(stamm);
    onUebernommen();
  };

  const offen = g?.ergebnis.befunde.filter((b) => b.art !== 'ok').length ?? 0;

  return (
    <div className="po-view einspaltig">
      <section className="po-col">
        <h2>Projektordner prüfen</h2>
        <p className="muted small-text">
          Vergleicht einen vorhandenen Projektordner mit der Struktur „{struktur.name}“: fehlende und zusätzliche Ordner, Stammdaten ({PROJEKT_DATEI}), Dateinamen in den
          Planordnern, lose Dateien und überlange Pfade. Das Tool meldet nur – es verschiebt, benennt und löscht nichts.
          {!desktop && ' Im Browser werden leere Ordner nicht erkannt.'}
        </p>
        <div className="button-row">
          <button className="primary" disabled={laeuft} onClick={() => void waehlen()}>
            Projektordner wählen …
          </button>
          {g?.pfad && (
            <>
              <button disabled={laeuft} onClick={() => void pruefenPfad(g.pfad)}>
                Erneut prüfen
              </button>
              <button onClick={() => void oeffneOrdner(g.pfad).catch((e) => setFehler(String(e)))}>Ordner öffnen</button>
            </>
          )}
          {laeuft && <span className="busy">Ordner wird gelesen …</span>}
        </div>
        {fehler && <p className="warning">{fehler}</p>}

        {g && (
          <>
            <h3>
              {g.name}
              <span className="muted small-text">
                {' '}
                – {g.ergebnis.ordner} Ordner, {g.ergebnis.dateien} Dateien · {offen ? `${offen} ${offen === 1 ? 'Abweichung' : 'Abweichungen'}` : 'keine Abweichungen'}
              </span>
            </h3>
            {g.pfad && <code className="po-pfad">{g.pfad}</code>}
            <ul className="po-befunde">
              {g.ergebnis.befunde.map((b, i) => (
                <li key={i} className={b.art}>
                  <span className="po-befund-art">{ART[b.art]}</span>
                  <div>
                    <strong>{b.titel}</strong>
                    {b.text && <div className="small-text">{b.text}</div>}
                    {b.pfade && (
                      <ul className="po-pfade">
                        {b.pfade.slice(0, MAX_PFADE).map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                        {b.pfade.length > MAX_PFADE && <li className="muted">… und {b.pfade.length - MAX_PFADE} weitere</li>}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="button-row">
              {desktop && g.ergebnis.fehlendeOrdner.length > 0 && (
                <button disabled={laeuft} onClick={() => void fehlendeAnlegen()} title="Legt nur die fehlenden Ordner der Struktur an – sonst wird nichts verändert">
                  {g.ergebnis.fehlendeOrdner.length} fehlende Ordner anlegen
                </button>
              )}
              {g.projekt && (
                <button onClick={uebernehmen} title="Stammdaten aus der projekt.json in „Neues Projekt“ übernehmen – z. B. um fehlende Vorlagen nachzutragen">
                  Stammdaten übernehmen
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
