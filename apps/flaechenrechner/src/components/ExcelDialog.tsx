import { computeProject } from '@core/calc';
import { ExcelDialog as Dialog } from '@core/ui/ExcelDialog';
import { PLACEHOLDER_DOCS } from '../core/exportData';
import { vorlage } from '../platform/vorlage';
import { useEditor } from '../store/store';

/** Excel-Export des Flächenrechners: Standardlayout oder eigene Vorlage (.xlsx mit Platzhaltern). */
export function ExcelDialog() {
  const setOpen = useEditor((s) => s.setExcelOpen);
  const project = useEditor((s) => s.project);
  return (
    <Dialog
      project={project}
      update={(fn) => useEditor.getState().update(fn)}
      onClose={() => setOpen(false)}
      speicher={vorlage}
      standardText="Blätter DIN 277, NRF nach Nutzungsgruppen, Raumliste und Wohnflächen – mit Summenformeln."
      hilfe={
        <>
          Vorlagen sind normale .xlsx-Dateien mit Platzhaltern in doppelten geschweiften Klammern, z. B. <code>{'{{summe.bgf}}'}</code> oder{' '}
          <code>{'{{geschoss:EG.nrf}}'}</code>. Enthält eine Zeile <code>{'{{raum.…}}'}</code>, <code>{'{{geschoss.…}}'}</code>,{' '}
          <code>{'{{wohnung.…}}'}</code> oder <code>{'{{nutzung.…}}'}</code>, wird sie je Eintrag wiederholt. Formatierung bleibt erhalten, Formeln wie{' '}
          <code>=SUMME(C5:C5)</code> werden auf alle eingefügten Zeilen erweitert.
        </>
      }
      docs={PLACEHOLDER_DOCS}
      dateiName={(p) => `${p.name} Flächen`}
      musterName="Flächen-Vorlage.xlsx"
      exportDefault={async (p) => (await import('../platform/excel')).exportDefault(p, computeProject(p))}
      exportWithTemplate={async (t, p) => (await import('../platform/excel')).exportWithTemplate(t, p, computeProject(p))}
      buildSampleTemplate={async () => (await import('../platform/excel')).buildSampleTemplate()}
    />
  );
}
