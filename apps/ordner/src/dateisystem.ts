import { zipSync } from 'fflate';
import { base64ToBytes, bytesToBase64, isTauri } from '@core/platform/files';

/**
 * Zugriff auf Ordner und Dateien. In der Desktop-App über eigene Befehle der Tauri-Hülle, die nur neu
 * anlegen und nie überschreiben. Im Browser gibt es keinen Schreibzugriff auf Ordner: Dort entsteht der
 * Projektordner als ZIP, und zum Prüfen wird ein Ordner über den Dateidialog eingelesen.
 */

export interface Eintrag {
  /** Pfad relativ zum aufgelisteten Ordner, mit „/“ getrennt */
  pfad: string;
  ordner: boolean;
  groesse: number;
}

export interface Dateisystem {
  /** Ordner und Dateien unter `root` bis zur Tiefe `tiefe` (1 = nur direkt enthaltene) */
  liste(root: string, tiefe: number): Promise<Eintrag[]>;
  lies(root: string, pfad: string): Promise<Uint8Array>;
  /** true = neu angelegt, false = war schon vorhanden */
  ordnerAnlegen(root: string, pfad: string): Promise<boolean>;
  /** true = neu angelegt, false = vorhandene Datei unverändert gelassen */
  dateiAnlegen(root: string, pfad: string, daten: Uint8Array): Promise<boolean>;
}

async function invoke<T>(befehl: string, args: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(befehl, args);
}

export const tauriDateisystem: Dateisystem = {
  liste: (root, tiefe) => invoke<Eintrag[]>('fs_list', { root, tiefe }),
  lies: async (root, pfad) => base64ToBytes(await invoke<string>('fs_read', { root, pfad })),
  ordnerAnlegen: (root, pfad) => invoke<boolean>('fs_create_dir', { root, pfad }),
  dateiAnlegen: (root, pfad, daten) => invoke<boolean>('fs_write_new', { root, pfad, contentsBase64: bytesToBase64(daten) }),
};

export const hatDateisystem = () => isTauri();

export async function waehleOrdner(titel: string): Promise<string | null> {
  return invoke<string | null>('pick_folder', { title: titel });
}

export async function oeffneOrdner(pfad: string): Promise<void> {
  await invoke<void>('open_folder', { pfad });
}

/** Pfad aus Ordner und relativem Teil – mit dem Trenner, den der Ordner schon verwendet */
export function verbinde(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`;
}

/* ---------- im Speicher (Tests, ZIP im Browser) ---------- */

/** Dateisystem im Speicher: Schlüssel sind vollständige Pfade mit „/“; Ordner haben den Wert null */
export class SpeicherDateisystem implements Dateisystem {
  readonly eintraege = new Map<string, Uint8Array | null>();

  private pfad(root: string, rel: string) {
    return `${root.replace(/[\\/]+$/, '').replace(/\\/g, '/')}/${rel}`;
  }

  async liste(root: string, tiefe: number): Promise<Eintrag[]> {
    const basis = `${root.replace(/[\\/]+$/, '').replace(/\\/g, '/')}/`;
    const out: Eintrag[] = [];
    for (const [p, v] of this.eintraege) {
      if (!p.startsWith(basis)) continue;
      const rel = p.slice(basis.length);
      if (!rel || rel.split('/').length > tiefe) continue;
      out.push({ pfad: rel, ordner: v === null, groesse: v?.length ?? 0 });
    }
    return out.sort((a, b) => a.pfad.toLowerCase().localeCompare(b.pfad.toLowerCase()));
  }

  async lies(root: string, pfad: string): Promise<Uint8Array> {
    const v = this.eintraege.get(this.pfad(root, pfad));
    if (!v) throw new Error(`${pfad}: nicht gefunden`);
    return v;
  }

  async ordnerAnlegen(root: string, pfad: string): Promise<boolean> {
    const teile = pfad.split('/');
    let neu = false;
    for (let i = 1; i <= teile.length; i++) {
      const p = this.pfad(root, teile.slice(0, i).join('/'));
      if (this.eintraege.get(p) instanceof Uint8Array) throw new Error(`${pfad}: Es gibt bereits eine Datei mit diesem Namen`);
      if (!this.eintraege.has(p)) {
        this.eintraege.set(p, null);
        neu = i === teile.length || neu;
      }
    }
    return neu;
  }

  async dateiAnlegen(root: string, pfad: string, daten: Uint8Array): Promise<boolean> {
    const p = this.pfad(root, pfad);
    if (this.eintraege.has(p)) return false;
    const eltern = pfad.split('/').slice(0, -1).join('/');
    if (eltern) await this.ordnerAnlegen(root, eltern);
    this.eintraege.set(p, daten);
    return true;
  }

  /** alles unter `root` als ZIP (leere Ordner bleiben erhalten) */
  alsZip(root: string): Uint8Array {
    const basis = `${root.replace(/[\\/]+$/, '').replace(/\\/g, '/')}/`;
    const dateien: Record<string, Uint8Array> = {};
    for (const [p, v] of this.eintraege) {
      if (!p.startsWith(basis)) continue;
      const rel = p.slice(basis.length);
      if (v === null) dateien[`${rel}/`] = new Uint8Array(0);
      else dateien[rel] = v;
    }
    return zipSync(dateien, { level: 6 });
  }
}

/* ---------- Browser: Ordner über den Dateidialog einlesen ---------- */

export interface GewaehlterOrdner {
  name: string;
  eintraege: Eintrag[];
  lies(pfad: string): Promise<Uint8Array>;
}

/** Ordner über den Dateidialog wählen (nur lesen). Leere Ordner kennt der Browser dabei nicht. */
export function waehleOrdnerImBrowser(): Promise<GewaehlterOrdner | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.remove();
      if (!files.length) return resolve(null);
      resolve(ordnerAusDateien(files.map((f) => ({ pfad: f.webkitRelativePath || f.name, groesse: f.size, lies: async () => new Uint8Array(await f.arrayBuffer()) }))));
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Dateiliste mit Pfaden „Ordner/Unterordner/Datei“ → Einträge relativ zum gewählten Ordner, mit Zwischenordnern */
export function ordnerAusDateien(dateien: { pfad: string; groesse: number; lies: () => Promise<Uint8Array> }[]): GewaehlterOrdner {
  const name = dateien[0]?.pfad.split('/')[0] ?? '';
  const eintraege = new Map<string, Eintrag>();
  const lesen = new Map<string, () => Promise<Uint8Array>>();
  for (const d of dateien) {
    const teile = d.pfad.split('/').slice(1);
    if (!teile.length) continue;
    for (let i = 1; i < teile.length; i++) {
      const p = teile.slice(0, i).join('/');
      if (!eintraege.has(p)) eintraege.set(p, { pfad: p, ordner: true, groesse: 0 });
    }
    const p = teile.join('/');
    eintraege.set(p, { pfad: p, ordner: false, groesse: d.groesse });
    lesen.set(p, d.lies);
  }
  return {
    name,
    eintraege: [...eintraege.values()].sort((a, b) => a.pfad.toLowerCase().localeCompare(b.pfad.toLowerCase())),
    lies: (pfad) => {
      const f = lesen.get(pfad);
      return f ? f() : Promise.reject(new Error(`${pfad}: nicht gefunden`));
    },
  };
}
