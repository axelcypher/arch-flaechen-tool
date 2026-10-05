import { ARCHIV_ENDUNGEN, readProjectFile, writeArchive } from '../archive';
import type { Project } from '../model';
import { gleich, gleichesProjekt, zusammenfuehren } from '../zusammenfuehren';
import { saveMergedFile } from './files';
import { logger } from './log';

const log = logger('datei');

export interface ProjektGespeichert {
  /** Dateiname (ohne Ordner) */
  datei: string;
  /** das gespeicherte Projekt – mit den Änderungen, die eine andere App inzwischen in der Datei gespeichert hat */
  project: Project;
  /** true, wenn Änderungen aus der Datei übernommen wurden */
  zusammengefuehrt: boolean;
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Projekt';
}

/**
 * Speichert das Projekt als Archiv (.oap/.akhp). Steht in der Zieldatei bereits dasselbe Projekt, werden die
 * Änderungen anderer Apps übernommen statt überschrieben (siehe zusammenfuehren.ts). `basis` ist das Projekt,
 * wie es zuletzt geöffnet bzw. gespeichert wurde; ohne Basis wird die Datei ersetzt.
 */
export async function projektSpeichern(o: {
  project: Project;
  basis: Project | null;
  /** zuletzt verwendeter Dateiname */
  datei?: string | null;
  /** App und Version fürs Manifest */
  app: string;
  filterName?: string;
  /** Ergänzungen nur für die Datei (z. B. die im Browser hinterlegte Excel-Vorlage) */
  fuerDatei?: (p: Project) => Project;
}): Promise<ProjektGespeichert | null> {
  const name = o.datei && /\.(oap|akhp)$/i.test(o.datei) ? o.datei : `${safeFileName(o.project.name)}.${ARCHIV_ENDUNGEN[0]}`;
  let project = o.project;
  let zusammengefuehrt = false;
  const datei = await saveMergedFile({
    defaultName: name,
    filterName: o.filterName ?? 'Projekt',
    extension: ARCHIV_ENDUNGEN[0],
    moreExtensions: ARCHIV_ENDUNGEN.slice(1),
    mime: 'application/zip',
    build: (vorhanden) => {
      if (vorhanden && o.basis) {
        try {
          const aufPlatte = readProjectFile(vorhanden);
          if (gleichesProjekt(o.basis, aufPlatte)) {
            project = zusammenfuehren(o.basis, o.project, aufPlatte);
            zusammengefuehrt = !gleich(project, o.project);
            if (zusammengefuehrt) log.info('Änderungen aus der Datei übernommen', { name: o.project.name });
          }
        } catch (e) {
          // vorhandene Datei unlesbar oder kein Projekt – sie wird ersetzt
          log.warn('Vorhandene Datei nicht lesbar, sie wird ersetzt', e);
        }
      }
      return writeArchive(o.fuerDatei ? o.fuerDatei(project) : project, { app: o.app });
    },
  });
  return datei ? { datei, project, zusammengefuehrt } : null;
}
