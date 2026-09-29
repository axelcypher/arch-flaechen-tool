import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { computeProject } from '../core/calc';
import { rectPoints } from '../core/geometry';
import { createProject, createRoom } from '../core/model';
import { exportWithTemplate } from './excel';

// 1×1-PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

/** Vorlage mit Logo in den Zellen (ExcelJS) und Logo im Seitenkopf (VML, wie Excel es speichert) */
async function template(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Wohnflächen');
  ws.getCell('A1').value = 'Wohnflächen-Berechnung';
  ws.getRow(4).values = ['{{#geschoss}}{{geschoss.name|einmal}}', '{{raum[wofl].name}}', '{{raum[wofl].wofl}}'];
  ws.getRow(5).values = ['{{/geschoss}}'];
  ws.headerFooter.oddFooter = '&LAusgegeben am &D';
  const id = wb.addImage({ buffer: PNG as never, extension: 'png' });
  ws.addImage(id, { tl: { col: 3, row: 0 }, ext: { width: 120, height: 40 } });
  const files = unzipSync(new Uint8Array(await wb.xlsx.writeBuffer()));
  const sheet = 'xl/worksheets/sheet1.xml';
  files[sheet] = strToU8(
    strFromU8(files[sheet])
      .replace('<headerFooter>', '<headerFooter><oddHeader>&amp;L&amp;G&amp;R{{projekt.code}} {{projekt.name}}</oddHeader>')
      .replace('</worksheet>', '<legacyDrawingHF r:id="rIdHF"/></worksheet>'),
  );
  const rels = 'xl/worksheets/_rels/sheet1.xml.rels';
  files[rels] = strToU8(
    strFromU8(files[rels]).replace(
      '</Relationships>',
      '<Relationship Id="rIdHF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawingHF1.vml"/></Relationships>',
    ),
  );
  files['xl/drawings/vmlDrawingHF1.vml'] = strToU8('<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><v:shape id="LH" type="#_x0000_t75" style="width:90pt;height:30pt"><v:imagedata o:relid="rId1" o:title="logo"/></v:shape></xml>');
  files['xl/drawings/_rels/vmlDrawingHF1.vml.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/kopflogo.png"/></Relationships>',
  );
  files['xl/media/kopflogo.png'] = PNG;
  return zipSync(files);
}

describe('Grafiken der Vorlage', () => {
  it('übernimmt Logo in Zellen und im Seitenkopf', async () => {
    const p = createProject('Test & Co');
    p.meta.projektcode = '0815';
    const r = createRoom(rectPoints({ x: 0, y: 0 }, { x: 4, y: 5 }), '1', 'Wohnen');
    r.wofl = { kategorie: 'voll', wohnung: '' };
    p.storeys[0].shapes.push(r);
    const out = unzipSync(await exportWithTemplate(await template(), p, computeProject(p)));

    const sheet = strFromU8(out['xl/worksheets/sheet1.xml']);
    expect(sheet).toMatch(/<drawing r:id="[^"]+"\/>/);
    expect(sheet).toMatch(/<legacyDrawingHF r:id="[^"]+"\/>/);
    expect(sheet.indexOf('<drawing')).toBeLessThan(sheet.indexOf('<legacyDrawingHF'));
    expect(sheet).toContain('&amp;L&amp;G&amp;R0815 Test &amp;&amp; Co');

    const rels = strFromU8(out['xl/worksheets/_rels/sheet1.xml.rels']);
    const hfTarget = /Target="([^"]*vmlDrawingHF1\.vml)"/.exec(rels)![1];
    const vmlPath = `xl/worksheets/${hfTarget}`.replace('worksheets/../', '');
    expect(out[vmlPath]).toBeDefined();
    const vmlRels = strFromU8(out[vmlPath.replace('drawings/', 'drawings/_rels/') + '.rels']);
    const img = /Target="\.\.\/media\/([^"]+)"/.exec(vmlRels)![1];
    expect(out[`xl/media/${img}`]).toEqual(PNG);

    const drawTarget = /Type="[^"]*\/drawing" Target="([^"]+)"/.exec(rels)![1];
    const drawPath = `xl/worksheets/${drawTarget}`.replace('worksheets/../', '');
    expect(out[drawPath]).toBeDefined();
    expect(strFromU8(out['[Content_Types].xml'])).toMatch(/Extension="vml"/);
    // Inhalt trotzdem gefüllt
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(zipSync(out).buffer as ArrayBuffer);
    expect(wb.getWorksheet('Wohnflächen')!.getCell('B4').value).toBe('Wohnen');
  });
});
