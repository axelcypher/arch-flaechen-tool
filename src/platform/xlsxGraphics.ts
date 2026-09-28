import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * Überträgt Grafiken einer Excel-Vorlage in die exportierte Datei:
 *  - Zeichnungen (Bilder/Logos/Formen/Diagramme in den Zellen, <drawing>)
 *  - Bilder in Kopf-/Fußzeile (<legacyDrawingHF>, z. B. Firmenlogo im Seitenkopf)
 *  - Blatthintergrund (<picture>)
 *
 * ExcelJS verwirft Kopf-/Fußzeilenbilder und manche Grafikformate (SVG, EMF, Formen). Deshalb werden die
 * betreffenden Teile hier direkt auf Paketebene (ZIP/XML) aus der Vorlage übernommen – samt aller
 * referenzierten Dateien. Die Zuordnung der Blätter erfolgt über den Blattnamen.
 */

type Files = Record<string, Uint8Array>;

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function dirOf(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function relsPathOf(part: string) {
  const d = dirOf(part);
  const f = part.slice(d.length ? d.length + 1 : 0);
  return `${d ? `${d}/` : ''}_rels/${f}.rels`;
}

/** relativen Zielpfad gegen den Ordner eines Teils auflösen */
function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = dirOf(base).split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function relative(fromPart: string, toPath: string): string {
  const from = dirOf(fromPart).split('/').filter(Boolean);
  const to = toPath.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m?.[1];
}

function parseRels(xml: string | undefined): Rel[] {
  if (!xml) return [];
  return [...xml.matchAll(/<Relationship\b[^>]*\/?>/g)].map((m) => ({
    id: attr(m[0], 'Id') ?? '',
    type: attr(m[0], 'Type') ?? '',
    target: attr(m[0], 'Target') ?? '',
    external: attr(m[0], 'TargetMode') === 'External',
  }));
}

function relsXml(rels: Rel[]): string {
  const body = rels
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ''}/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
}

/** Blattname → Pfad des Blatt-XML */
function sheetPaths(files: Files): Map<string, string> {
  const wb = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const rels = parseRels(files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : undefined);
  const out = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decodeXml(attr(m[0], 'name') ?? '');
    const rid = attr(m[0], 'r:id');
    const rel = rels.find((r) => r.id === rid);
    if (rel) out.set(name, resolve('xl/workbook.xml', rel.target));
  }
  return out;
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

const GRAPHIC_TAGS = ['drawing', 'legacyDrawingHF', 'picture'] as const;
const tagRe = (tag: string) => new RegExp(`<${tag}\\b[^>]*/>`, 'g');

function contentTypes(files: Files) {
  const xml = strFromU8(files['[Content_Types].xml']);
  const overrides = new Map<string, string>();
  for (const m of xml.matchAll(/<Override\b[^>]*\/>/g)) overrides.set((attr(m[0], 'PartName') ?? '').replace(/^\//, ''), attr(m[0], 'ContentType') ?? '');
  const defaults = new Map<string, string>();
  for (const m of xml.matchAll(/<Default\b[^>]*\/>/g)) defaults.set((attr(m[0], 'Extension') ?? '').toLowerCase(), attr(m[0], 'ContentType') ?? '');
  return { xml, overrides, defaults };
}

export function restoreTemplateGraphics(template: Uint8Array, output: Uint8Array): Uint8Array {
  let tpl: Files;
  let out: Files;
  try {
    tpl = unzipSync(template);
    out = unzipSync(output);
  } catch {
    return output;
  }
  const tplSheets = sheetPaths(tpl);
  const outSheets = sheetPaths(out);
  const tplCT = contentTypes(tpl);
  const outCT = contentTypes(out);
  const addOverrides = new Map<string, string>();
  const addDefaults = new Map<string, string>();
  let changed = false;
  let counter = 0;

  for (const [name, tplSheet] of tplSheets) {
    const outSheet = outSheets.get(name);
    if (!outSheet || !tpl[tplSheet] || !out[outSheet]) continue;
    const tplXml = strFromU8(tpl[tplSheet]);
    const tplRels = parseRels(tpl[relsPathOf(tplSheet)] ? strFromU8(tpl[relsPathOf(tplSheet)]) : undefined);
    const wanted = GRAPHIC_TAGS.flatMap((t) => [...tplXml.matchAll(tagRe(t))].map((m) => ({ tag: t, el: m[0], rid: attr(m[0], 'r:id') ?? '' })));
    if (!wanted.length) continue;

    let outXml = strFromU8(out[outSheet]);
    let outRels = parseRels(out[relsPathOf(outSheet)] ? strFromU8(out[relsPathOf(outSheet)]) : undefined);

    // vorhandene Grafikelemente von ExcelJS entfernen (werden durch die Vorlage ersetzt)
    for (const t of GRAPHIC_TAGS) {
      for (const m of [...outXml.matchAll(tagRe(t))]) {
        const rid = attr(m[0], 'r:id');
        const rel = outRels.find((r) => r.id === rid);
        if (rel && !rel.external) removePart(out, resolve(outSheet, rel.target));
        outRels = outRels.filter((r) => r.id !== rid);
        outXml = outXml.replace(m[0], '');
      }
    }

    const copied = new Map<string, string>(); // Vorlagenpfad → neuer Pfad
    const copyPart = (src: string): string => {
      const hit = copied.get(src);
      if (hit) return hit;
      const dir = dirOf(src);
      const file = src.slice(dir.length + 1);
      const dst = `${dir}/tpl${++counter}_${file}`;
      copied.set(src, dst);
      if (!tpl[src]) return dst;
      out[dst] = tpl[src];
      const ext = file.split('.').pop()!.toLowerCase();
      const ov = tplCT.overrides.get(src);
      if (ov) addOverrides.set(dst, ov);
      else if (!outCT.defaults.has(ext)) {
        const d = tplCT.defaults.get(ext);
        if (d) addDefaults.set(ext, d);
      }
      // abhängige Teile (Bilder einer Zeichnung, Diagramme …) ebenfalls übernehmen
      const rp = relsPathOf(src);
      if (tpl[rp]) {
        const rels = parseRels(strFromU8(tpl[rp])).map((r) => {
          if (r.external) return r;
          const child = copyPart(resolve(src, r.target));
          return { ...r, target: relative(dst, child) };
        });
        out[relsPathOf(dst)] = strToU8(relsXml(rels));
      }
      return dst;
    };

    const drawEls: string[] = [];
    const hfEls: string[] = [];
    for (const w of wanted) {
      const rel = tplRels.find((r) => r.id === w.rid);
      if (!rel || rel.external) continue;
      const dst = copyPart(resolve(tplSheet, rel.target));
      const id = `rIdTpl${++counter}`;
      outRels.push({ id, type: rel.type, target: relative(outSheet, dst), external: false });
      const el = w.el.replace(/r:id="[^"]*"/, `r:id="${id}"`);
      (w.tag === 'drawing' ? drawEls : hfEls).push(el);
    }
    if (!drawEls.length && !hfEls.length) continue;

    if (!/xmlns:r=/.test(outXml.slice(0, 600))) outXml = outXml.replace(/<worksheet\b/, `<worksheet xmlns:r="${REL_NS}"`);
    // Reihenfolge laut Schema: … drawing, legacyDrawing, legacyDrawingHF, picture, oleObjects …
    const insertBefore = (xml: string, markers: string[], block: string) => {
      let pos = -1;
      for (const mk of markers) {
        const i = xml.indexOf(mk);
        if (i >= 0 && (pos < 0 || i < pos)) pos = i;
      }
      return pos < 0 ? xml : xml.slice(0, pos) + block + xml.slice(pos);
    };
    const tail = ['<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>'];
    if (drawEls.length) outXml = insertBefore(outXml, ['<legacyDrawing ', '<legacyDrawing>', '<legacyDrawingHF', '<picture', ...tail], drawEls.join(''));
    if (hfEls.length) outXml = insertBefore(outXml, ['<picture', ...tail], hfEls.join(''));
    out[outSheet] = strToU8(outXml);
    out[relsPathOf(outSheet)] = strToU8(relsXml(outRels));
    changed = true;
  }

  if (!changed) return output;

  // Inhaltstypen ergänzen
  let ct = strFromU8(out['[Content_Types].xml']);
  const extra =
    [...addDefaults].filter(([ext]) => !new RegExp(`Extension="${ext}"`, 'i').test(ct)).map(([ext, t]) => `<Default Extension="${ext}" ContentType="${t}"/>`).join('') +
    [...addOverrides].map(([p, t]) => `<Override PartName="/${p}" ContentType="${t}"/>`).join('');
  ct = ct.replace('</Types>', `${extra}</Types>`);
  out['[Content_Types].xml'] = strToU8(ct);
  return zipSync(out, { level: 6 });
}

/** Teil samt Beziehungsdatei entfernen (nur Zeichnungen von ExcelJS; Medien bleiben, falls geteilt) */
function removePart(files: Files, path: string) {
  const rp = relsPathOf(path);
  const rels = parseRels(files[rp] ? strFromU8(files[rp]) : undefined);
  delete files[path];
  delete files[rp];
  // zugehörige Bilder nur löschen, wenn sie sonst niemand referenziert
  for (const r of rels) {
    if (r.external) continue;
    const media = resolve(path, r.target);
    const stillUsed = Object.keys(files).some((k) => k.endsWith('.rels') && files[k] && strFromU8(files[k]).includes(media.split('/').pop()!));
    if (!stillUsed) delete files[media];
  }
  // Content-Type-Override des entfernten Teils bleibt harmlos stehen; Excel ignoriert ihn nicht immer → entfernen
  const ct = strFromU8(files['[Content_Types].xml']);
  files['[Content_Types].xml'] = strToU8(ct.replace(new RegExp(`<Override PartName="/${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`), ''));
}
