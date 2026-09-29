import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readProjectFile, writeArchive } from './archive';
import { rectPoints } from './geometry';
import { addDatei, createOutline, createProject, createStorey } from './model';
import { serializeProject } from './serialize';

// 1×1-PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function project() {
  let p = createProject('Sanierung EFH Sander');
  p.storeys[0].shapes.push(createOutline(rectPoints({ x: 0, y: 0 }, { x: 10, y: 8 })));
  const pdf = addDatei(p, 'EG.pdf', 'pdf', new Uint8Array([37, 80, 68, 70, 1, 2, 3]));
  p = pdf.project;
  p.storeys[0].background = {
    type: 'raster',
    name: 'EG.pdf',
    quelle: pdf.id,
    dataUrl: `data:image/png;base64,${PNG}`,
    widthPx: 1,
    heightPx: 1,
    metersPerPixel: 0.01,
    x: 1,
    y: 2,
    opacity: 0.5,
    visible: true,
    pdf: { page: 2, metersPerPixelAt1: 0.001 },
  };
  const dg = createStorey('DG', 2.5);
  dg.dachgeschoss = true;
  p.storeys.push(dg);
  p.dachModell = { name: 'Dach', triangles: [0, 0, 0, 1.25, 0, 0, 0, 1 / 3, 7.5] };
  p = addDatei(p, 'Haus.ifc', 'ifc', strToU8('ISO-10303-21;')).project;
  p = addDatei(p, 'Vorlage.xlsx', 'vorlage', new Uint8Array([80, 75, 9])).project;
  // nicht mehr verwendeter Plan – wird nicht mitgespeichert
  p = addDatei(p, 'alt.dxf', 'dxf', strToU8('0\nEOF')).project;
  return p;
}

describe('Projektarchiv (.oap/.akhp)', () => {
  it('speichert Pläne, Dachmodell und Originaldateien und liest sie verlustfrei zurück', () => {
    const p = project();
    const zip = writeArchive(p, { app: '9.9.9' });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(
      ['manifest.json', 'projekt.json', 'plaene/01-EG.png', 'modell/dach.bin', ...p.dateien!.filter((d) => d.art !== 'dxf').map((d) => `quellen/${d.id}/${d.name}`)].sort(),
    );
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    expect(manifest).toMatchObject({ format: 'arch-flaechen-tool-archiv', version: 1, app: '9.9.9', projekt: 'Sanierung EFH Sander' });
    // Bilder nicht doppelt als Base64 im Projekt
    expect(new TextDecoder().decode(files['projekt.json'])).not.toContain(PNG);

    const back = readProjectFile(zip);
    const { dateien, ...rest } = back;
    const { dateien: orig, ...origRest } = p;
    expect(rest).toEqual(origRest);
    expect(dateien!.map((d) => [d.name, d.art, Array.from(d.daten)])).toEqual(orig!.filter((d) => d.art !== 'dxf').map((d) => [d.name, d.art, Array.from(d.daten)]));
    expect(back.storeys[1].dachgeschoss).toBe(true);
  });

  it('öffnet weiterhin JSON-Projektdateien', () => {
    const p = project();
    const back = readProjectFile(strToU8(serializeProject(p)));
    expect(back.name).toBe(p.name);
    expect(back.dateien).toBeUndefined();
  });

  it('behält Geschoss-Einstellungen (Begrenzung auf Geschosshöhe, Geschossart)', () => {
    const p = project();
    p.storeys[0].geschosshoeheBegrenzt = true;
    p.storeys[0].dachgeschoss = false;
    for (const back of [readProjectFile(writeArchive(p)), readProjectFile(strToU8(serializeProject(p)))]) {
      expect(back.storeys[0]).toMatchObject({ geschosshoeheBegrenzt: true, dachgeschoss: false });
      expect(back.storeys[1].geschosshoeheBegrenzt).toBeUndefined();
    }
  });

  it('lehnt fremde ZIP-Dateien ab', () => {
    expect(() => readProjectFile(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/kein Projektarchiv/);
  });

  it('gleiche Originaldatei wird nur einmal gespeichert', () => {
    const p = createProject();
    const a = addDatei(p, 'plan.pdf', 'pdf', new Uint8Array([1, 2, 3]));
    const b = addDatei(a.project, 'plan.pdf', 'pdf', new Uint8Array([1, 2, 3]));
    expect(b.id).toBe(a.id);
    expect(b.project.dateien).toHaveLength(1);
  });
});
