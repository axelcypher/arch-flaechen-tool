import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readProjectFile } from '@core/archive';
import { ordnerAusDateien, SpeicherDateisystem, verbinde } from './dateisystem';
import { dateimuster, naechsteNummer, nameAus, nummerAus } from './nummer';
import type { Vorlage } from './plan';
import { ausfuehren, ladeVorlagen, ordnerName, planen } from './plan';
import { pruefe } from './pruefung';
import type { Stammdaten } from './stammdaten';
import { leereStammdaten, leseProjektJson, platzhalter, projektJson } from './stammdaten';
import type { Struktur } from './struktur';
import { ordnerAlsText, ordnerAusText, sichererName, STANDARD, strukturAlsJson, strukturAusJson } from './struktur';
import { fuelleDocx, fuelleText, fuelleVorlage, MUSTER_VORLAGEN } from './vorlagen';

const TAG = new Date(2026, 9, 1);

function stamm(patch: Partial<Stammdaten> = {}): Stammdaten {
  return {
    ...leereStammdaten(),
    nummer: '2026-014',
    kurzname: 'EFH Musterweg',
    bezeichnung: 'Neubau eines Einfamilienhauses',
    adresse: { strasse: 'Musterweg 3', plz: '48143', ort: 'Münster' },
    bauherr: { name: 'Familie Beispiel', adresse: { strasse: 'Altweg 1', plz: '48143', ort: 'Münster' }, kontakte: [{ art: 'email', wert: 'b@example.org' }] },
    bearbeiter: 'TP',
    leistungsphasen: [1, 2, 3, 4],
    beteiligte: [{ rolle: 'Tragwerk', name: 'Büro Statik', kontakt: '0251 1234' }],
    ...patch,
  };
}

const KLEIN: Struktur = {
  ...STANDARD,
  name: 'Klein',
  ordner: [{ pfad: '00 Projekt' }, { pfad: '02 Pläne/Entwurf', dateischema: true }, { pfad: '02 Pläne/Ausführung', lph: [5], dateischema: true }, { pfad: '08 Bauleitung', lph: [8] }],
  flaechenprojekt: '00 Projekt/{nummer} {kurzname}.oap',
};

const vorlage = (pfad: string, inhalt: string | Uint8Array): Vorlage => ({ pfad, lies: async () => (typeof inhalt === 'string' ? strToU8(inhalt) : inhalt) });

describe('Nummern und Namen', () => {
  it('Projektnummer nach Schema', () => {
    expect(nummerAus('{jahr}-{nr:3}', 14, TAG)).toBe('2026-014');
    expect(nummerAus('{jj}{nr:2}', 7, TAG)).toBe('2607');
    expect(nummerAus('P{nr}', 123, TAG)).toBe('P123');
  });

  it('nächste freie Nummer aus den Ordnern des Stammordners – im laufenden Jahr', () => {
    const ordner = ['2025-031 Altbau', '2026-001 Haus A', '2026-013 Kita', '2026-2 falsches Format', 'Vorlagen', '2026-0140 zu lang'];
    expect(naechsteNummer('{jahr}-{nr:3}', ordner, TAG)).toBe('2026-141');
    expect(naechsteNummer('{jahr}-{nr:3}', ['2025-031 Altbau'], TAG)).toBe('2026-001');
    expect(naechsteNummer('{jahr}-{nr:3}', [], TAG)).toBe('2026-001');
    expect(naechsteNummer('{jj}{nr:3}', ['26013 Kita', '26014_Schule', '25099 Vorjahr'], TAG)).toBe('26015');
    // Schema ohne laufende Nummer: nichts zu zählen
    expect(naechsteNummer('{jahr}', ordner, TAG)).toBe('2026');
  });

  it('Ordnername: Platzhalter ersetzt, unzulässige Zeichen entfernt', () => {
    expect(ordnerName(stamm(), STANDARD, TAG)).toBe('2026-014 EFH Musterweg');
    expect(ordnerName(stamm({ kurzname: 'Haus: A/B? ' }), STANDARD, TAG)).toBe('2026-014 Haus A B');
    expect(sichererName('Ende. ')).toBe('Ende');
    expect(nameAus('{nummer}_{{kurzname}}_{unbekannt}', { nummer: '1', kurzname: 'x' })).toBe('1_x_{unbekannt}');
  });

  it('Dateinamenschema als Prüfmuster', () => {
    const m = dateimuster('{nummer}_{plannummer}_{index}_{titel}', '2026-014');
    expect(m.test('2026-014_A-101_b_Grundriss EG')).toBe(true);
    expect(m.test('2026-014_A-101_b_Grundriss_EG_neu')).toBe(true); // der Titel darf Unterstriche enthalten
    expect(m.test('2026-013_A-101_b_Grundriss EG')).toBe(false); // fremde Projektnummer
    expect(m.test('Grundriss EG')).toBe(false);
    expect(m.test('2026-014_A-101_Grundriss EG')).toBe(false); // Index fehlt
    expect(dateimuster('{datum}_{titel}', '').test('2026-10-01_Aktennotiz')).toBe(true);
  });
});

describe('Struktur', () => {
  it('Ordnerliste als Text lesen und schreiben', () => {
    const text = '# Kommentar\n00 Projekt\n02 Pläne\\Ausführung | LPh 5-6 | Dateischema\n\n07 Ausschreibung | lph 6, 7\n00 projekt\n  08 Bau/  Mängel? | LPh 8';
    const o = ordnerAusText(text);
    expect(o).toEqual([{ pfad: '00 Projekt' }, { pfad: '02 Pläne/Ausführung', lph: [5, 6], dateischema: true }, { pfad: '07 Ausschreibung', lph: [6, 7] }, { pfad: '08 Bau/Mängel', lph: [8] }]);
    expect(ordnerAlsText(o)).toBe('00 Projekt\n02 Pläne/Ausführung | LPh 5-6 | Dateischema\n07 Ausschreibung | LPh 6-7\n08 Bau/Mängel | LPh 8');
    expect(ordnerAusText(ordnerAlsText(STANDARD.ordner))).toEqual(STANDARD.ordner);
  });

  it('Konfiguration als JSON: Hin und zurück, Vorgaben für fehlende Angaben, verständliche Fehler', () => {
    expect(strukturAusJson(strukturAlsJson(KLEIN))).toEqual(KLEIN);
    const teil = strukturAusJson('{"name":"Büro","ordner":["A | LPh 2","B/C"],"flaechenprojekt":""}');
    expect(teil).toMatchObject({ name: 'Büro', nummernschema: STANDARD.nummernschema, flaechenprojekt: '', ordner: [{ pfad: 'A', lph: [2] }, { pfad: 'B/C' }] });
    expect(() => strukturAusJson('kein json')).toThrow(/kein gültiges JSON/);
    expect(() => strukturAusJson('{"ordner":[1,2]}')).toThrow(/keinen gültigen Ordner/);
  });
});

describe('Stammdaten', () => {
  it('projekt.json schreiben und lesen', () => {
    const json = projektJson(stamm({ kurzname: ' EFH Musterweg ' }), KLEIN, TAG);
    const p = leseProjektJson(json);
    expect(p).toMatchObject({ format: 'projektordner', version: 1, nummer: '2026-014', kurzname: 'EFH Musterweg', angelegt: '2026-10-01', struktur: 'Klein', leistungsphasen: [1, 2, 3, 4] });
    expect(p.bauherr.kontakte).toEqual([{ art: 'email', wert: 'b@example.org' }]);
    expect(p.beteiligte).toEqual([{ rolle: 'Tragwerk', name: 'Büro Statik', kontakt: '0251 1234' }]);
    expect(() => leseProjektJson('{"name":"fremd"}')).toThrow(/keine Projektdatei/);
    expect(() => leseProjektJson('{')).toThrow(/kein gültiges JSON/);
  });

  it('Platzhalter heißen wie in den anderen Werkzeugen', () => {
    const ctx = platzhalter(stamm(), '2026-014 EFH Musterweg', TAG);
    expect(ctx.scalars).toMatchObject({
      'projekt.nummer': '2026-014',
      'projekt.code': '2026-014',
      'projekt.name': 'Neubau eines Einfamilienhauses',
      'projekt.adresse': 'Musterweg 3, 48143 Münster',
      'bauherr.name': 'Familie Beispiel',
      'bauherr.email': 'b@example.org',
      'projekt.leistungsphasen': '1, 2, 3, 4',
      datum: '1.10.2026',
      'datum.iso': '2026-10-01',
      beteiligte: 'Tragwerk: Büro Statik (0251 1234)',
    });
    expect(ctx.collections.lph.map((l) => l.name)).toEqual(['Grundlagenermittlung', 'Vorplanung', 'Entwurfsplanung', 'Genehmigungsplanung']);
  });
});

describe('Vorlagen', () => {
  const ctx = platzhalter(stamm(), '2026-014 EFH Musterweg', TAG);

  it('Text: bekannte Platzhalter ersetzt, unbekannte bleiben stehen', () => {
    expect(fuelleText('{{projekt.nummer}} – {{ bauherr.name }} – {{tippfehler}}', ctx)).toBe('2026-014 – Familie Beispiel – {{tippfehler}}');
  });

  it('Textdatei mit BOM (Excel-CSV) behält das BOM', async () => {
    const out = await fuelleVorlage('Planliste.csv', strToU8('\uFEFFProjekt;{{projekt.nummer}}'), ctx);
    expect([...out.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(strFromU8(out.subarray(3))).toBe('Projekt;2026-014');
  });

  it('Word: Platzhalter in Text und Kopfzeile, Sonderzeichen maskiert; andere Teile unverändert', () => {
    const docx = zipSync({
      'word/document.xml': strToU8('<w:t>{{projekt.nummer}} {{bauherr.name}}</w:t><w:t>{{beteiligte}}</w:t>'),
      'word/header1.xml': strToU8('<w:t>{{projekt.kurzname}}</w:t>'),
      'word/styles.xml': strToU8('<x>{{projekt.nummer}}</x>'),
    });
    const z = unzipSync(fuelleDocx(docx, platzhalter(stamm({ bauherr: { ...stamm().bauherr, name: 'Müller & Söhne <GbR>' } }), 'x', TAG)));
    expect(strFromU8(z['word/document.xml'])).toBe('<w:t>2026-014 Müller &amp; Söhne &lt;GbR&gt;</w:t><w:t>Tragwerk: Büro Statik (0251 1234)</w:t>');
    expect(strFromU8(z['word/header1.xml'])).toBe('<w:t>EFH Musterweg</w:t>');
    expect(strFromU8(z['word/styles.xml'])).toBe('<x>{{projekt.nummer}}</x>');
  });

  it('Excel: Einzelwerte und Zeile je Beteiligtem über die gemeinsame Vorlagen-Engine', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Projektblatt');
    ws.getCell('A1').value = '{{projekt.nummer}} {{projekt.kurzname}}';
    ws.getCell('A2').value = '{{beteiligter.rolle}}';
    ws.getCell('B2').value = '{{beteiligter.name}}';
    const zwei = platzhalter(stamm({ beteiligte: [...stamm().beteiligte, { rolle: 'Vermessung', name: 'ÖbVI Muster', kontakt: '' }] }), 'x', TAG);
    const out = await fuelleVorlage('Projektblatt.xlsx', new Uint8Array(await wb.xlsx.writeBuffer()), zwei);
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);
    const b = back.getWorksheet('Projektblatt')!;
    expect(b.getCell('A1').value).toBe('2026-014 EFH Musterweg');
    expect([b.getCell('A2').value, b.getCell('B2').value, b.getCell('A3').value, b.getCell('B3').value]).toEqual(['Tragwerk', 'Büro Statik', 'Vermessung', 'ÖbVI Muster']);
  });

  it('andere Dateiarten bleiben unverändert', async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 123, 123]);
    expect(await fuelleVorlage('Formular.pdf', pdf, ctx)).toBe(pdf);
  });
});

describe('Plan und Anlegen', () => {
  it('Trockenlauf: Ordner nach Leistungsphasen, Stammdaten, leere Flächenberechnung, Vorlagen', () => {
    const plan = planen(
      stamm(),
      KLEIN,
      [vorlage('LIESMICH.txt', 'nicht kopieren'), vorlage('00 Projekt/{nummer} Projektblatt.md', '# {{projekt.nummer}}'), vorlage('08 Bauleitung/Bautagebuch.md', 'x'), vorlage('00 Projekt/~$gesperrt.docx', 'x'), vorlage('10 Sonstiges/Notiz.txt', 'x')],
      [],
      TAG,
    );
    expect(plan.ordner).toBe('2026-014 EFH Musterweg');
    expect(plan.fehler).toEqual([]);
    expect(plan.schritte.map((s) => `${s.art === 'ordner' ? 'D' : 'F'} ${s.pfad} [${s.herkunft}]`)).toEqual([
      'D 00 Projekt [struktur]',
      'F 00 Projekt/2026-014 EFH Musterweg.oap [flaechen]',
      'F 00 Projekt/2026-014 Projektblatt.md [vorlage]',
      'D 02 Pläne [struktur]',
      'D 02 Pläne/Entwurf [struktur]',
      'D 10 Sonstiges [vorlage]',
      'F 10 Sonstiges/Notiz.txt [vorlage]',
      'F projekt.json [stammdaten]',
    ]);
    // LPh 5 und 8 sind nicht beauftragt: zwei Ordner und eine Vorlage bleiben weg
    expect(plan.hinweise.join(' ')).toContain('2 Ordner gehören zu nicht beauftragten Leistungsphasen');
    expect(plan.hinweise.join(' ')).toContain('1 Vorlage liegt in Ordnern nicht beauftragter Leistungsphasen');
    // ohne Angabe von Leistungsphasen entsteht alles
    expect(planen(stamm({ leistungsphasen: [] }), KLEIN, [], [], TAG).schritte.filter((s) => s.art === 'ordner')).toHaveLength(5);
  });

  it('fehlende Angaben verhindern das Anlegen', async () => {
    const plan = planen(stamm({ nummer: ' ', kurzname: '' }), KLEIN, [], [], TAG);
    expect(plan.fehler).toEqual(['Die Projektnummer fehlt.', 'Der Kurzname fehlt.', 'Aus dem Schema für den Ordnernamen ergibt sich kein Name.']);
    await expect(ausfuehren(new SpeicherDateisystem(), '/p', plan)).rejects.toThrow(/Projektnummer fehlt/);
  });

  it('legt an, füllt Vorlagen und schreibt Stammdaten und Flächenrechner-Datei', async () => {
    const fs = new SpeicherDateisystem();
    const plan = planen(stamm(), KLEIN, [vorlage('00 Projekt/{nummer} Projektblatt.md', '# {{projekt.nummer}} – {{bauherr.name}}')], [], TAG);
    const ergebnis = await ausfuehren(fs, 'P:\\Projekte', plan);
    expect(ergebnis.every((e) => e.status === 'angelegt')).toBe(true);
    const basis = 'P:/Projekte/2026-014 EFH Musterweg';
    expect(fs.eintraege.get(`${basis}/02 Pläne/Entwurf`)).toBeNull();
    expect(strFromU8(fs.eintraege.get(`${basis}/00 Projekt/2026-014 Projektblatt.md`)!)).toBe('# 2026-014 – Familie Beispiel');
    expect(leseProjektJson(strFromU8(fs.eintraege.get(`${basis}/projekt.json`)!)).kurzname).toBe('EFH Musterweg');
    // die leere Flächenberechnung trägt die Projektdaten – Flächenrechner, GRZ-Nachweis und Kostenermittlung öffnen sie
    const p = readProjectFile(fs.eintraege.get(`${basis}/00 Projekt/2026-014 EFH Musterweg.oap`)!);
    expect(p.name).toBe('Neubau eines Einfamilienhauses');
    expect(p.meta).toMatchObject({ projektcode: '2026-014', bearbeiter: 'TP', adresse: { ort: 'Münster' }, bauherr: { name: 'Familie Beispiel' } });
    expect(p.storeys.length).toBeGreaterThan(0);
  });

  it('überschreibt nie: Vorhandenes bleibt, der Plan zeigt es vorher an', async () => {
    const fs = new SpeicherDateisystem();
    await ausfuehren(fs, '/p', planen(stamm(), KLEIN, [], [], TAG));
    const basis = '/p/2026-014 EFH Musterweg';
    // von Hand geändert
    fs.eintraege.set(`${basis}/projekt.json`, strToU8('von Hand'));
    const vorhandene = await fs.liste(basis, 12);
    // zweiter Lauf mit mehr Leistungsphasen und einer Vorlage
    const plan = planen(stamm({ leistungsphasen: [1, 2, 3, 4, 5] }), KLEIN, [vorlage('00 Projekt/Notiz.txt', 'neu')], vorhandene, TAG);
    expect(plan.schritte.filter((s) => !s.vorhanden).map((s) => s.pfad)).toEqual(['00 Projekt/Notiz.txt', '02 Pläne/Ausführung']);
    expect(plan.hinweise.join(' ')).toContain('5 Einträge sind schon vorhanden und bleiben unverändert');
    const ergebnis = await ausfuehren(fs, '/p', plan);
    expect(ergebnis.filter((e) => e.status === 'angelegt').map((e) => e.schritt.pfad)).toEqual(['00 Projekt/Notiz.txt', '02 Pläne/Ausführung']);
    expect(ergebnis.filter((e) => e.status === 'vorhanden')).toHaveLength(5);
    expect(strFromU8(fs.eintraege.get(`${basis}/projekt.json`)!)).toBe('von Hand');
  });

  it('ein Fehler in einem Schritt hält die übrigen nicht auf', async () => {
    const fs = new SpeicherDateisystem();
    const plan = planen(stamm(), KLEIN, [{ pfad: '00 Projekt/kaputt.md', lies: () => Promise.reject(new Error('Datei gesperrt')) }, vorlage('00 Projekt/gut.md', 'ok')], [], TAG);
    const ergebnis = await ausfuehren(fs, '/p', plan);
    expect(ergebnis.filter((e) => e.status === 'fehler').map((e) => [e.schritt.pfad, e.meldung])).toEqual([['00 Projekt/kaputt.md', 'Datei gesperrt']]);
    expect(fs.eintraege.has('/p/2026-014 EFH Musterweg/00 Projekt/gut.md')).toBe(true);
  });

  it('Muster-Vorlagen als Vorlagenordner: Anleitung bleibt weg, Namen und Inhalte werden gefüllt', async () => {
    const fs = new SpeicherDateisystem();
    for (const m of MUSTER_VORLAGEN) await fs.dateiAnlegen('/vorlagen', m.pfad, strToU8(m.inhalt));
    const vorlagen = await ladeVorlagen(fs, '/vorlagen');
    expect(vorlagen).toHaveLength(MUSTER_VORLAGEN.length);
    const plan = planen(stamm(), STANDARD, vorlagen, [], TAG);
    await ausfuehren(fs, '/p', plan);
    const basis = '/p/2026-014 EFH Musterweg';
    expect(fs.eintraege.has(`${basis}/LIESMICH.txt`)).toBe(false);
    const blatt = strFromU8(fs.eintraege.get(`${basis}/00 Projekt/2026-014 Projektblatt.md`)!);
    expect(blatt).toContain('# Projektblatt 2026-014 – EFH Musterweg');
    expect(blatt).toContain('| Bauherr | Familie Beispiel |');
    expect(blatt).not.toContain('{{');
    expect(fs.eintraege.has(`${basis}/02 Pläne/2026-014 Planliste.csv`)).toBe(true);
    // als ZIP (Browser): Ordner und Dateien unter dem Projektordner
    const zip = unzipSync(fs.alsZip('/p'));
    expect(Object.keys(zip)).toContain('2026-014 EFH Musterweg/09 Fotos/');
    expect(Object.keys(zip)).toContain('2026-014 EFH Musterweg/projekt.json');
  });

  it('Pfade verbinden mit dem Trenner des Stammordners', () => {
    expect(verbinde('P:\\Projekte\\', '2026-014 Haus/00 Projekt')).toBe('P:\\Projekte\\2026-014 Haus\\00 Projekt');
    expect(verbinde('/srv/projekte', 'a/b')).toBe('/srv/projekte/a/b');
  });
});

describe('Prüfmodus', () => {
  async function angelegt() {
    const fs = new SpeicherDateisystem();
    await ausfuehren(fs, '/p', planen(stamm(), KLEIN, [], [], TAG));
    const basis = '/p/2026-014 EFH Musterweg';
    const projekt = leseProjektJson(strFromU8(fs.eintraege.get(`${basis}/projekt.json`)!));
    return { fs, basis, projekt };
  }

  it('frisch angelegter Ordner: keine Abweichungen', async () => {
    const { fs, basis, projekt } = await angelegt();
    const r = pruefe('2026-014 EFH Musterweg', await fs.liste(basis, 12), KLEIN, projekt);
    expect(r.befunde.map((b) => b.art)).toEqual(['ok', 'ok']);
    expect(r.fehlendeOrdner).toEqual([]);
    expect([r.ordner, r.dateien]).toEqual([3, 2]);
  });

  it('meldet fehlende und fremde Ordner, lose Dateien, Dateinamen, Ordnernamen – und ändert nichts', async () => {
    const { fs, basis, projekt } = await angelegt();
    fs.eintraege.delete(`${basis}/02 Pläne/Entwurf`);
    await fs.ordnerAnlegen(basis, 'Diverses');
    await fs.ordnerAnlegen(basis, '02 Pläne/Alt');
    await fs.ordnerAnlegen(basis, '02 Pläne/Entwurf'); // wieder da, mit Dateien
    await fs.dateiAnlegen(basis, '02 Pläne/Entwurf/2026-014_A-101_a_Grundriss EG.pdf', strToU8('x'));
    await fs.dateiAnlegen(basis, '02 Pläne/Entwurf/Grundriss final neu.pdf', strToU8('x'));
    await fs.dateiAnlegen(basis, '02 Pläne/Entwurf/Thumbs.db', strToU8('x'));
    await fs.dateiAnlegen(basis, 'Angebot.pdf', strToU8('x'));
    fs.eintraege.delete(`${basis}/00 Projekt/2026-014 EFH Musterweg.oap`);
    fs.eintraege.delete(`${basis}/00 Projekt`);
    const vorher = new Map(fs.eintraege);
    const r = pruefe('2026-14 Musterweg', await fs.liste(basis, 12), KLEIN, projekt);
    expect(fs.eintraege).toEqual(vorher);
    expect(r.fehlendeOrdner).toEqual(['00 Projekt']);
    const t = r.befunde.map((b) => `${b.art}: ${b.titel}${b.pfade ? ` → ${b.pfade.join(', ')}` : ''}`);
    expect(t).toEqual([
      'warnung: Der Ordnername weicht vom Schema ab',
      'warnung: 1 Ordner der Struktur fehlt → 00 Projekt',
      'warnung: 1 von 2 Dateien folgt nicht dem Dateinamenschema → 02 Pläne/Entwurf/Grundriss final neu.pdf',
      'hinweis: 2 Ordner stehen nicht in der Struktur → 02 Pläne/Alt, Diverses',
      'hinweis: 1 Datei liegt lose im Projektordner → Angebot.pdf',
      'ok: projekt.json vorhanden',
    ]);
  });

  it('ohne projekt.json: Warnung, Prüfung gegen die vollständige Struktur; kaputte Datei als Fehler', async () => {
    const { fs, basis } = await angelegt();
    const eintraege = (await fs.liste(basis, 12)).filter((e) => e.pfad !== 'projekt.json');
    const r = pruefe('2026-014 EFH Musterweg', eintraege, KLEIN, null);
    expect(r.befunde[0]).toMatchObject({ art: 'warnung', titel: 'projekt.json fehlt' });
    expect(r.fehlendeOrdner).toEqual(['02 Pläne/Ausführung', '08 Bauleitung']);
    expect(pruefe('x', eintraege, KLEIN, null, 'kein gültiges JSON').befunde[0]).toMatchObject({ art: 'fehler', titel: 'projekt.json ist nicht lesbar' });
  });

  it('überlange Pfade', () => {
    const lang = `02 Pläne/Entwurf/${'x'.repeat(190)}.pdf`;
    const r = pruefe('2026-014 EFH Musterweg', [{ pfad: lang, ordner: false, groesse: 1 }], { ...KLEIN, ordner: [] }, null);
    expect(r.befunde.find((b) => b.titel.includes('sehr lang'))?.pfade).toEqual([lang]);
  });

  it('Browser: Dateiliste eines gewählten Ordners wird zu Einträgen mit Zwischenordnern', async () => {
    const o = ordnerAusDateien([
      { pfad: 'Projekt X/projekt.json', groesse: 5, lies: async () => strToU8('{}') },
      { pfad: 'Projekt X/02 Pläne/Entwurf/a.pdf', groesse: 9, lies: async () => strToU8('pdf') },
    ]);
    expect(o.name).toBe('Projekt X');
    expect(o.eintraege).toEqual([
      { pfad: '02 Pläne', ordner: true, groesse: 0 },
      { pfad: '02 Pläne/Entwurf', ordner: true, groesse: 0 },
      { pfad: '02 Pläne/Entwurf/a.pdf', ordner: false, groesse: 9 },
      { pfad: 'projekt.json', ordner: false, groesse: 5 },
    ]);
    expect(strFromU8(await o.lies('projekt.json'))).toBe('{}');
  });
});
