import { ExcelDialog as Dialog } from '@core/ui/ExcelDialog';
import { GRZ_PLACEHOLDER_DOCS } from '../export/exportData';
import { useGrz } from '../store';
import { vorlage } from '../vorlage';

/** Excel-Export des GRZ-Nachweises: Standardlayout oder eigene Vorlage (.xlsx mit Platzhaltern). */
export function ExcelDialog({ onClose }: { onClose: () => void }) {
  const project = useGrz((s) => s.project);
  return (
    <Dialog
      project={project}
      update={(fn) => useGrz.getState().update(fn)}
      onClose={onClose}
      speicher={vorlage}
      standardText="Blatt „GRZ GFZ“: Grundlagen, Kennzahlen, Vollgeschosse, Geschossfläche, Flächenbilanz, Lageplan-Flächen und Hinweise – mit Summenformeln."
      hilfe={
        <>
          Vorlagen sind normale .xlsx-Dateien mit Platzhaltern in doppelten geschweiften Klammern, z. B. <code>{'{{grz}}'}</code> oder <code>{'{{geschoss:EG.gf}}'}</code>.
          Enthält eine Zeile <code>{'{{geschoss.…}}'}</code>, <code>{'{{lageplan.…}}'}</code>, <code>{'{{raum.…}}'}</code> oder <code>{'{{hinweis.…}}'}</code>, wird sie je
          Eintrag wiederholt. Formatierung bleibt erhalten, Formeln wie <code>=SUMME(C5:C5)</code> werden auf alle eingefügten Zeilen erweitert. Die Vorlage ist
          unabhängig von der des Flächenrechners.
        </>
      }
      docs={GRZ_PLACEHOLDER_DOCS}
      dateiName={(p) => `${p.name} GRZ-Nachweis`}
      musterName="GRZ-Vorlage.xlsx"
      exportDefault={async (p) => (await import('../export/excel')).exportDefault(p)}
      exportWithTemplate={async (t, p) => (await import('../export/excel')).exportWithTemplate(t, p)}
      buildSampleTemplate={async () => (await import('../export/excel')).buildSampleTemplate()}
    />
  );
}
