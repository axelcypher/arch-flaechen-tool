import { vorlagenSpeicher } from '@core/excel/vorlage';

/** Excel-Vorlage der Kostenermittlung (Projektdatei-Art „vorlage-kosten“, getrennt von den anderen Apps) */
export const vorlage = vorlagenSpeicher('vorlage-kosten', 'kostenermittlung:excel-template');
