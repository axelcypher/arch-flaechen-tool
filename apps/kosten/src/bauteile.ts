import { create } from 'zustand';
import type { IfcExtract } from '@core/ifcData';
import type { Project } from '@core/model';
import { logger } from '@core/platform/log';
import type { IfcWand } from './waende';
import { waendeAusIfc } from './waende';

/**
 * Bauteile aus dem IFC-Modell des Projekts (derzeit die Wände für die Innenwandfläche). Sie werden nicht im
 * Projekt gespeichert, sondern bei jedem Öffnen aus der mitgespeicherten IFC-Datei gelesen – so passen sie
 * immer zum aktuellen Modell.
 */

const log = logger('bauteile');

interface BauteileState {
  /** Kennung der IFC-Datei in Project.dateien, aus der die Bauteile stammen */
  quelle: string | null;
  status: 'keins' | 'laedt' | 'fertig' | 'fehler';
  /** null = kein IFC-Modell (bzw. noch nicht gelesen) */
  waende: IfcWand[] | null;
}

export const useBauteile = create<BauteileState>()(() => ({ quelle: null, status: 'keins', waende: null }));

const ifcDatei = (p: Project) => p.dateien?.filter((d) => d.art === 'ifc').pop();

/** bereits gelesenes Modell übernehmen (IFC direkt geöffnet) */
export function bauteileAusModell(p: Project, x: IfcExtract) {
  const d = ifcDatei(p);
  useBauteile.setState({ quelle: d?.id ?? null, status: 'fertig', waende: waendeAusIfc(x) });
}

/** Bauteile zum Projekt bereitstellen: aus der mitgespeicherten IFC-Datei lesen, sofern noch nicht geschehen */
export async function bauteileLaden(p: Project) {
  const d = ifcDatei(p);
  const st = useBauteile.getState();
  if (!d) {
    if (st.quelle !== null || st.waende) useBauteile.setState({ quelle: null, status: 'keins', waende: null });
    return;
  }
  if (st.quelle === d.id) return;
  useBauteile.setState({ quelle: d.id, status: 'laedt', waende: null });
  try {
    const { loadIfc } = await import('@core/platform/ifc');
    const x = await loadIfc(d.daten.slice());
    if (useBauteile.getState().quelle !== d.id) return;
    const waende = waendeAusIfc(x);
    useBauteile.setState({ status: 'fertig', waende });
    log.info(`Bauteile aus ${d.name}`, { waende: waende.length });
  } catch (e) {
    log.warn(`IFC-Modell ${d.name} konnte nicht gelesen werden`, e);
    if (useBauteile.getState().quelle === d.id) useBauteile.setState({ status: 'fehler', waende: null });
  }
}
