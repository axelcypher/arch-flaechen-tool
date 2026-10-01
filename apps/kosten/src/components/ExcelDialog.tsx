import { ExcelDialog as Dialog } from '@core/ui/ExcelDialog';
import { KOSTEN_PLACEHOLDER_DOCS } from '../export/exportData';
import { stufeLabel } from '../kosten';
import { useKosten } from '../store';
import { vorlage } from '../vorlage';

/** Excel-Export der Kostenermittlung: Standardlayout oder eigene Vorlage (.xlsx mit Platzhaltern). */
export function ExcelDialog({ onClose }: { onClose: () => void }) {
  const project = useKosten((s) => s.project);
  return (
    <Dialog
      project={project}
      update={(fn) => useKosten.getState().update(fn)}
      onClose={onClose}
      speicher={vorlage}
      standardText="Blatt „Kosten“: Grundlagen, Kostenübersicht nach Kostengruppen mit Bandbreite, Kennwerte des Bauwerks, Positionen, Mengen, Kostenstände und Hinweise – mit Summenformeln."
      hilfe={
        <>
          Vorlagen sind normale .xlsx-Dateien mit Platzhaltern in doppelten geschweiften Klammern, z. B. <code>{'{{gesamt.brutto}}'}</code> oder <code>{'{{kg:300.mittel}}'}</code>.
          Enthält eine Zeile <code>{'{{kg.…}}'}</code>, <code>{'{{position.…}}'}</code>, <code>{'{{menge.…}}'}</code>, <code>{'{{stand.…}}'}</code> oder{' '}
          <code>{'{{hinweis.…}}'}</code>, wird sie je Eintrag wiederholt. Formatierung bleibt erhalten, Formeln wie <code>=SUMME(G5:G5)</code> werden auf alle eingefügten Zeilen
          erweitert. Die Vorlage ist unabhängig von denen des Flächenrechners und des GRZ-Nachweises.
        </>
      }
      docs={KOSTEN_PLACEHOLDER_DOCS}
      dateiName={(p) => `${p.name} ${stufeLabel(p.kosten?.stufe ?? 'schaetzung')}`}
      musterName="Kosten-Vorlage.xlsx"
      exportDefault={async (p) => (await import('../export/excel')).exportDefault(p)}
      exportWithTemplate={async (t, p) => (await import('../export/excel')).exportWithTemplate(t, p)}
      buildSampleTemplate={async () => (await import('../export/excel')).buildSampleTemplate()}
    />
  );
}
