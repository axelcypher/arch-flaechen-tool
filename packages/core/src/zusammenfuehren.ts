import type { Project } from './model';

/**
 * Zusammenführen beim Speichern. Flächenrechner, GRZ-Nachweis und Kostenermittlung arbeiten an derselben
 * Projektdatei, jede App aber an ihrer eigenen Kopie (mit Zwischenspeicher über Neustarts hinweg). Schriebe
 * jede App einfach ihre Kopie zurück, gingen dabei die Änderungen verloren, die eine andere App inzwischen in
 * der Datei gespeichert hat.
 *
 * Deshalb wird aus drei Ständen zusammengeführt:
 *   basis – das Projekt, wie die App es zuletzt geöffnet bzw. gespeichert hat
 *   eigen – das Projekt in der App
 *   datei – das Projekt, das jetzt in der Zieldatei steht
 * Was die App gegenüber der Basis nicht geändert hat, kommt aus der Datei; was nur die App geändert hat, aus der
 * App. Haben beide denselben Wert geändert, gilt der der App. Objekte werden Feld für Feld zusammengeführt,
 * Listen mit `id` (Geschosse, Flächen, Positionen, Dateien …) Eintrag für Eintrag; alle übrigen Werte
 * (Punktlisten, Zahlen, Texte) als Ganzes.
 */
export function zusammenfuehren(basis: Project, eigen: Project, datei: Project): Project {
  return merge3(basis, eigen, datei) as Project;
}

/**
 * Gehört die Datei zum selben Projekt wie die Basis? Nur dann wird zusammengeführt – wer ein anderes Projekt
 * überschreibt, will es ersetzen. Erkannt an gemeinsamen Kennungen (sie entstehen zufällig beim Anlegen).
 */
export function gleichesProjekt(basis: Project, datei: Project): boolean {
  const ids = (p: Project) => [
    ...p.storeys.map((s) => s.id),
    ...p.storeys.flatMap((s) => s.shapes.map((x) => x.id)),
    ...(p.lageplan?.flaechen ?? []).map((f) => f.id),
    ...(p.kosten?.positionen ?? []).map((x) => x.id),
  ];
  const a = new Set(ids(basis));
  return ids(datei).some((id) => a.has(id));
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v) && Object.getPrototypeOf(v) === Object.prototype;

const idListe = (v: unknown): v is (Obj & { id: string })[] => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && typeof x.id === 'string');

/** inhaltlich gleich (Objekte, Listen, Binärdaten) */
export function gleich(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b);
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!gleich(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => (a as Obj)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Obj)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => gleich((a as Obj)[k], (b as Obj)[k]));
}

export function merge3(basis: unknown, eigen: unknown, datei: unknown): unknown {
  if (gleich(eigen, basis)) return datei;
  if (gleich(datei, basis) || gleich(eigen, datei)) return eigen;
  if (isObj(eigen) && isObj(datei)) {
    const b = isObj(basis) ? basis : {};
    const out: Obj = {};
    for (const k of new Set([...Object.keys(eigen), ...Object.keys(datei)])) {
      const v = merge3(b[k], eigen[k], datei[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if ((idListe(eigen) || (Array.isArray(eigen) && !eigen.length)) && (idListe(datei) || (Array.isArray(datei) && !datei.length))) {
    return mergeListe(idListe(basis) ? basis : [], eigen as (Obj & { id: string })[], datei as (Obj & { id: string })[]);
  }
  return eigen;
}

function mergeListe(basis: (Obj & { id: string })[], eigen: (Obj & { id: string })[], datei: (Obj & { id: string })[]): Obj[] {
  const b = new Map(basis.map((x) => [x.id, x]));
  const d = new Map(datei.map((x) => [x.id, x]));
  const e = new Set(eigen.map((x) => x.id));
  const out: Obj[] = [];
  for (const x of eigen) {
    const y = d.get(x.id);
    if (y) out.push(merge3(b.get(x.id), x, y) as Obj);
    // in der Datei gelöscht: weg, sofern hier unverändert
    else if (!b.has(x.id) || !gleich(x, b.get(x.id))) out.push(x);
  }
  // in der Datei hinzugekommen: hinter dem nächsten Vorgänger einsortieren, den es hier auch gibt
  datei.forEach((y, i) => {
    if (e.has(y.id) || b.has(y.id)) return; // schon übernommen bzw. hier gelöscht (die eigene Löschung gilt)
    let pos = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((x) => x.id === datei[j].id);
      if (k >= 0) {
        pos = k + 1;
        break;
      }
    }
    out.splice(pos, 0, y);
  });
  return out;
}
