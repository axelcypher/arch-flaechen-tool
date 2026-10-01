import { useState } from 'react';
import { pickFile, saveTextFile } from '@core/platform/files';
import { logger } from '@core/platform/log';
import { safeFileName } from '@core/ui/ExcelDialog';
import { kgName } from '../din276';
import type { Katalog } from '../katalog';
import { eintragAusPosition, gespeicherterKatalog, katalogCsv, katalogJson, katalogSpeichern, leseKatalog, positionAusEintrag } from '../katalog';
import { MENGEN_INFO } from '../mengen';
import type { MengenBezug } from '../mengen';
import { addPositionen, setKosten, useKosten } from '../store';

const log = logger('katalog');

const bezugKurz = (b: string, einheit?: string) =>
  b === 'pauschal' ? 'psch' : b === 'prozent' ? '%' : b === 'menge' ? (einheit ?? 'Stk') : `${MENGEN_INFO[b as MengenBezug].einheit} ${MENGEN_INFO[b as MengenBezug].kurz}`;
const wert = (v: number | undefined) => (v === undefined ? '' : v.toLocaleString('de-DE', { maximumFractionDigits: 2 }));

/**
 * Kennwertkatalog: laden (JSON/CSV), als Datei speichern, aus den Positionen des Projekts erstellen
 * und Einträge als Positionen übernehmen.
 */
export function KatalogDialog({ onClose }: { onClose: () => void }) {
  const [katalog, setKatalog] = useState<Katalog | null>(() => gespeicherterKatalog());
  const [auswahl, setAuswahl] = useState<Set<number>>(new Set());
  const [fehler, setFehler] = useState<string | null>(null);
  const project = useKosten((s) => s.project);

  const setzen = (k: Katalog | null) => {
    setKatalog(k);
    setAuswahl(new Set());
    if (!katalogSpeichern(k)) setFehler('Der Katalog ist zu groß für den Browserspeicher – er gilt nur bis zum Schließen.');
  };

  const laden = async () => {
    const f = await pickFile('.json,.csv,application/json,text/csv');
    if (!f) return;
    try {
      const k = leseKatalog(await f.text(), f.name);
      setzen(k);
      setFehler(null);
      log.info(`Kennwertkatalog geladen: ${k.name}`, { eintraege: k.eintraege.length });
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  const speichern = async (art: 'csv' | 'json') => {
    if (!katalog) return;
    const name = safeFileName(katalog.name);
    await saveTextFile(
      art === 'csv'
        ? { defaultName: `${name}.csv`, contents: katalogCsv(katalog), filterName: 'CSV (Excel)', extension: 'csv', mime: 'text/csv' }
        : { defaultName: `${name}.json`, contents: katalogJson(katalog), filterName: 'Kennwertkatalog', extension: 'json', mime: 'application/json' },
    );
  };

  const ausProjekt = () => {
    const k = project.kosten;
    if (!k?.positionen.length) return;
    setzen({
      name: k.katalog?.name ?? `Kennwerte ${project.name}`,
      quelle: k.katalog?.quelle ?? `Projekt ${project.name}`,
      stand: k.katalog?.stand ?? (k.datum ? new Date(k.datum).toLocaleDateString('de-DE') : undefined),
      ...(k.indexBasis !== undefined ? { index: k.indexBasis } : {}),
      eintraege: k.positionen.map(eintragAusPosition),
    });
  };

  const uebernehmen = () => {
    if (!katalog || !auswahl.size) return;
    const neu = [...auswahl].sort((a, b) => a - b).map((i) => positionAusEintrag(katalog.eintraege[i], katalog));
    useKosten.getState().update((p) => {
      let q = addPositionen(p, neu);
      const k = q.kosten!;
      q = setKosten(q, {
        katalog: { name: katalog.name, ...(katalog.quelle ? { quelle: katalog.quelle } : {}), ...(katalog.stand ? { stand: katalog.stand } : {}) },
        ...(k.indexBasis === undefined && katalog.index !== undefined ? { indexBasis: katalog.index } : {}),
      });
      return q;
    });
    onClose();
  };

  const alle = katalog ? katalog.eintraege.map((_, i) => i) : [];
  const toggle = (i: number) => {
    const s = new Set(auswahl);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    setAuswahl(s);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <h3>Kennwertkatalog</h3>
        <p className="muted small-text">
          Eigene Datei (JSON oder CSV aus Excel: Spalten KG; Bezeichnung; Bezug; Grundlage; von; Mittel; bis; Bemerkung, Kopfzeilen „# Name:“, „# Quelle:“, „# Stand:“,
          „# Index:“). Der zuletzt geladene Katalog bleibt in der Anwendung hinterlegt; übernommene Kennwerte stehen im Projekt.
        </p>
        <div className="button-row">
          <button className="small" onClick={laden}>
            Katalog laden …
          </button>
          <button className="small" onClick={ausProjekt} disabled={!project.kosten?.positionen.length} title="Kennwerte der Positionen dieses Projekts als Katalog">
            Aus Projektpositionen erstellen
          </button>
          {katalog && (
            <>
              <button className="small" onClick={() => void speichern('csv')}>
                Als CSV speichern …
              </button>
              <button className="small" onClick={() => void speichern('json')}>
                Als JSON speichern …
              </button>
              <button className="small danger" onClick={() => setzen(null)}>
                Katalog entfernen
              </button>
            </>
          )}
        </div>
        {fehler && <p className="warning">{fehler}</p>}
        {katalog ? (
          <>
            <p className="small-text">
              <strong>{katalog.name}</strong>
              {katalog.quelle && ` · Quelle: ${katalog.quelle}`}
              {katalog.stand && ` · Stand: ${katalog.stand}`}
              {katalog.index !== undefined && ` · Baupreisindex ${katalog.index.toLocaleString('de-DE')}`} · {katalog.eintraege.length} Einträge
            </p>
            <div className="tbl-wrap ko-katalog">
              <table className="ko-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={auswahl.size === alle.length && alle.length > 0}
                        onChange={(ev) => setAuswahl(new Set(ev.target.checked ? alle : []))}
                        title="alle"
                      />
                    </th>
                    <th>KG</th>
                    <th>Bezeichnung</th>
                    <th>Bezug</th>
                    <th className="num">von</th>
                    <th className="num">Mittel</th>
                    <th className="num">bis</th>
                  </tr>
                </thead>
                <tbody>
                  {katalog.eintraege.map((e, i) => (
                    <tr key={i} onClick={() => toggle(i)} className={auswahl.has(i) ? 'selected' : ''}>
                      <td>
                        <input type="checkbox" checked={auswahl.has(i)} onChange={() => toggle(i)} onClick={(ev) => ev.stopPropagation()} />
                      </td>
                      <td>{e.kg}</td>
                      <td>
                        {e.bezeichnung}
                        {e.bezeichnung !== kgName(e.kg) && kgName(e.kg) && <div className="muted small-text">{kgName(e.kg)}</div>}
                      </td>
                      <td>
                        {bezugKurz(e.bezug, e.einheit)}
                        {e.basis && ` von ${e.basis.join(' + ')}`}
                      </td>
                      <td className="num">{wert(e.von)}</td>
                      <td className="num">{wert(e.mittel)}</td>
                      <td className="num">{wert(e.bis)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="muted small-text">Noch kein Katalog hinterlegt. Einen laden oder aus den Positionen eines fertigen Projekts erstellen.</p>
        )}
        <div className="dialog-buttons">
          <button onClick={onClose}>Schließen</button>
          <button className="primary" onClick={uebernehmen} disabled={!auswahl.size}>
            {auswahl.size ? `${auswahl.size} als Positionen übernehmen` : 'Einträge wählen'}
          </button>
        </div>
      </div>
    </div>
  );
}
