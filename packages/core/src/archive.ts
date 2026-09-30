import type { Unzipped, ZipOptions } from 'fflate';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project } from './model';
import { benutzteDateien, istVorlage } from './model';
import { parseProject, parseProjectData, ProjectFormatError } from './serialize';

/**
 * Projektarchiv (.oap bzw. .akhp – beide Endungen, gleiches Format): ein ZIP mit dem Projekt und allem,
 * was dazugehört, damit es auf einem anderen Rechner vollständig wieder geöffnet werden kann.
 *
 *   manifest.json            Formatkennung, Version, Inhaltsverzeichnis
 *   projekt.json             das Projekt; Planbilder, Dachmodell und Dateien nur als Verweis
 *   plaene/…                 Planbilder (PNG/JPG, gerenderte PDF-Seiten) unkomprimiert, wie sie sind
 *   modell/dach.bin          Dachhaut aus dem IFC-Modell (Float64, little endian)
 *   quellen/<id>/<name>      Originaldateien der Importe (IFC, DXF, PDF) und die Excel-Vorlage
 *
 * Reine JSON-Projektdateien früherer Versionen lassen sich weiterhin öffnen.
 */

export const ARCHIV_FORMAT = 'arch-flaechen-tool-archiv';
export const ARCHIV_VERSION = 1;
/** gleichwertige Dateiendungen; die erste ist der Standard beim Speichern */
export const ARCHIV_ENDUNGEN = ['oap', 'akhp'] as const;

const MANIFEST = 'manifest.json';
const PROJEKT = 'projekt.json';
const DACH = 'modell/dach.bin';

interface Manifest {
  format: string;
  version: number;
  erstellt: string;
  app?: string;
  projekt: string;
  inhalt: { pfad: string; art: string; name?: string }[];
}

const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'datei';
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Schreibt das Projekt als Archiv. */
export function writeArchive(p: Project, opts: { app?: string; date?: Date } = {}): Uint8Array {
  const files: Record<string, [Uint8Array, ZipOptions]> = {};
  const inhalt: Manifest['inhalt'] = [];
  const add = (pfad: string, data: Uint8Array, art: string, name?: string, stored = false) => {
    files[pfad] = [data, { level: stored ? 0 : 6 }];
    inhalt.push({ pfad, art, ...(name ? { name } : {}) });
  };

  const storeys = p.storeys.map((s, i) => {
    const bg = s.background;
    if (bg?.type !== 'raster') return s;
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(bg.dataUrl);
    if (!m || !m[2]) return s;
    const pfad = `plaene/${String(i + 1).padStart(2, '0')}-${safeName(s.name)}.${MIME_EXT[m[1]] ?? 'bin'}`;
    add(pfad, base64ToBytes(m[3]), 'plan', bg.name, true);
    const { dataUrl: _, ...rest } = bg;
    return { ...s, background: { ...rest, bild: pfad, mime: m[1] } };
  });

  let dachModell: unknown = p.dachModell;
  if (p.dachModell) {
    add(DACH, float64ToBytes(p.dachModell.triangles), 'dachmodell', p.dachModell.name);
    dachModell = { name: p.dachModell.name, datei: DACH };
  }

  const dateien = benutzteDateien(p).map((d) => {
    const pfad = `quellen/${d.id}/${safeName(d.name)}`;
    // PDF und Excel sind bereits komprimiert
    add(pfad, d.daten, d.art, d.name, d.art === 'pdf' || istVorlage(d.art));
    const { daten: _, ...rest } = d;
    return { ...rest, pfad };
  });

  const projekt = { ...p, storeys, dachModell, dateien: dateien.length ? dateien : undefined };
  const manifest: Manifest = {
    format: ARCHIV_FORMAT,
    version: ARCHIV_VERSION,
    erstellt: (opts.date ?? new Date()).toISOString(),
    ...(opts.app ? { app: opts.app } : {}),
    projekt: p.name,
    inhalt,
  };
  return zipSync({
    [MANIFEST]: [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }],
    [PROJEKT]: [strToU8(JSON.stringify(projekt)), { level: 6 }],
    ...files,
  });
}

/** Liest ein Archiv (.oap/.akhp) oder eine JSON-Projektdatei. */
export function readProjectFile(bytes: Uint8Array): Project {
  if (!isZip(bytes)) return parseProject(strFromU8(bytes));
  let zip: Unzipped;
  try {
    zip = unzipSync(bytes);
  } catch {
    throw new ProjectFormatError('Das Archiv ist beschädigt und kann nicht gelesen werden.');
  }
  const manifest = readJson(zip, MANIFEST) as Partial<Manifest> | null;
  if (!manifest || manifest.format !== ARCHIV_FORMAT) throw new ProjectFormatError('Die Datei ist kein Projektarchiv des Flächenrechners.');
  if (typeof manifest.version !== 'number' || manifest.version > ARCHIV_VERSION) {
    throw new ProjectFormatError(`Das Archiv stammt aus einer neueren Programmversion (Archivversion ${String(manifest.version)}).`);
  }
  const raw = readJson(zip, PROJEKT);
  if (!isObj(raw)) throw new ProjectFormatError('Im Archiv fehlt das Projekt (projekt.json).');

  if (Array.isArray(raw.storeys)) {
    for (const s of raw.storeys) {
      const bg = isObj(s) && isObj(s.background) ? s.background : null;
      if (!bg || typeof bg.bild !== 'string') continue;
      const data = zip[bg.bild];
      if (!data) throw new ProjectFormatError(`Im Archiv fehlt der Plan ${bg.bild}.`);
      const mime = typeof bg.mime === 'string' ? bg.mime : (EXT_MIME[bg.bild.split('.').pop() ?? ''] ?? 'image/png');
      bg.dataUrl = `data:${mime};base64,${bytesToBase64(data)}`;
      delete bg.bild;
      delete bg.mime;
    }
  }
  if (isObj(raw.dachModell) && typeof raw.dachModell.datei === 'string') {
    const data = zip[raw.dachModell.datei];
    raw.dachModell = data ? { name: raw.dachModell.name, triangles: Array.from(bytesToFloat64(data)) } : undefined;
  }
  if (Array.isArray(raw.dateien)) {
    raw.dateien = raw.dateien.filter(isObj).map((d) => ({ ...d, daten: typeof d.pfad === 'string' ? zip[d.pfad] : undefined }));
  }
  return parseProjectData(raw);
}

function readJson(zip: Unzipped, name: string): unknown {
  const data = zip[name];
  if (!data) return null;
  try {
    return JSON.parse(strFromU8(data));
  } catch {
    throw new ProjectFormatError(`${name} im Archiv ist kein gültiges JSON.`);
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function float64ToBytes(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 8);
  const dv = new DataView(out.buffer);
  values.forEach((v, i) => dv.setFloat64(i * 8, v, true));
  return out;
}

function bytesToFloat64(bytes: Uint8Array): Float64Array {
  const n = Math.floor(bytes.length / 8);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 8);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat64(i * 8, true);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
