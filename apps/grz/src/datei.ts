import { ARCHIV_ENDUNGEN, readProjectFile } from '@core/archive';
import { buildFromIfc } from '@core/ifcImport';
import type { Project } from '@core/model';
import { addDatei, createProject } from '@core/model';
import { pickFile } from '@core/platform/files';
import type { ProjektGespeichert } from '@core/platform/projektDatei';
import { projektSpeichern } from '@core/platform/projektDatei';
import { logger } from '@core/platform/log';
import { vorlage } from './vorlage';

const log = logger('datei');

export interface Geoeffnet {
  project: Project;
  datei: string;
  /** Stand der Datei (null beim IFC-Import) */
  basis: Project | null;
  /** Hinweise aus dem IFC-Import */
  bericht: string[];
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Projekt';
}

/**
 * Projekt öffnen: Projektarchiv des Flächenrechners (.oap/.akhp), frühere JSON-Projektdateien
 * oder direkt ein IFC-Modell (Geschosse, BGF-Umrisse, Räume, Dach, Lageplan).
 */
export async function oeffnen(onProgress?: (msg: string) => void): Promise<Geoeffnet | null> {
  const f = await pickFile(`${ARCHIV_ENDUNGEN.map((e) => `.${e}`).join(',')},.json,.ifc`);
  if (!f) return null;
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (/\.ifc$/i.test(f.name)) {
    onProgress?.('IFC-Modell wird gelesen …');
    const { loadIfc } = await import('@core/platform/ifc');
    const x = await loadIfc(bytes.slice(), onProgress);
    onProgress?.('Gebäude und Lageplan werden ermittelt …');
    const r = buildFromIfc(x, { rooms: true, outlines: true, roof: true, wohnflaeche: false, dachform: true });
    let p = createProject(x.projectName || f.name.replace(/\.ifc$/i, ''));
    p.storeys = r.storeys;
    p.dachModell = r.dachModell;
    if (r.lageplan) p.lageplan = r.lageplan;
    p = addDatei(p, f.name, 'ifc', bytes).project;
    log.info(`IFC übernommen: ${f.name}`, r.report);
    return { project: p, datei: `${safeFileName(p.name)}.${ARCHIV_ENDUNGEN[0]}`, basis: null, bericht: r.report };
  }
  const p = readProjectFile(bytes);
  log.info(`Projekt geöffnet: ${f.name}`);
  return { project: p, datei: f.name, basis: p, bericht: [] };
}

/** Speichert das Projekt als Archiv (.oap/.akhp) – dieselbe Datei öffnet auch der Flächenrechner */
export function speichern(p: Project, datei: string | null, basis: Project | null): Promise<ProjektGespeichert | null> {
  return projektSpeichern({ project: p, basis, datei, app: `GRZ-Nachweis ${__APP_VERSION__}`, fuerDatei: vorlage.mit });
}
