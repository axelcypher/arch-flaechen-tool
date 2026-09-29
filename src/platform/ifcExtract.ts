import type { IfcAPI } from 'web-ifc';
import type { IfcExtract, IfcMeshPart, IfcSpaceData } from '../core/ifcData';
import { logger } from './log';

const log = logger('ifc');

/**
 * Liest die für die Flächenberechnung relevanten Daten aus einem IFC-Modell (über web-ifc).
 * Ergebnis sind reine Daten ohne web-ifc-Abhängigkeit, die core/ifcImport.ts weiterverarbeitet.
 *
 * Koordinaten: web-ifc liefert y-oben (three.js-Konvention: x, Höhe, −Nord). Umgerechnet wird auf
 * Grundrisskoordinaten der Zeichenfläche: x = Ost, y = Süd (Bildschirm nach unten), z = Höhe.
 */

/** Konstanten der benötigten IFC-Typen (aus dem web-ifc-Modul) */
export interface IfcTypeCodes {
  IFCBUILDINGSTOREY: number;
  IFCSPACE: number;
  IFCRELCONTAINEDINSPATIALSTRUCTURE: number;
  IFCRELAGGREGATES: number;
  IFCUNITASSIGNMENT: number;
  IFCPROJECT: number;
  IFCRELDEFINESBYPROPERTIES: number;
}

const SKIP_TYPES = new Set(['IFCSPACE', 'IFCOPENINGELEMENT', 'IFCANNOTATION', 'IFCGRID', 'IFCVIRTUALELEMENT']);

export function extractIfc(api: IfcAPI, T: IfcTypeCodes, data: Uint8Array, onProgress?: (msg: string) => void): IfcExtract {
  const m = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false, CIRCLE_SEGMENTS: 24 });
  try {
    onProgress?.('Struktur wird gelesen …');
    const schema = api.GetModelSchema(m);
    const scale = lengthUnitScale(api, m, T);
    const ids = (type: number) => {
      const v = api.GetLineIDsWithType(m, type);
      const out: number[] = [];
      for (let i = 0; i < v.size(); i++) out.push(v.get(i));
      return out;
    };
    const val = (x: unknown): unknown => (x && typeof x === 'object' && 'value' in x ? (x as { value: unknown }).value : x);
    const str = (x: unknown) => {
      const v = val(x);
      return typeof v === 'string' ? v : '';
    };

    const projectName = (() => {
      const p = ids(T.IFCPROJECT)[0];
      if (p === undefined) return '';
      const l = api.GetLine(m, p);
      return str(l.LongName) || str(l.Name);
    })();

    const storeyIds = ids(T.IFCBUILDINGSTOREY);
    const storeysRaw = storeyIds.map((id) => {
      const l = api.GetLine(m, id);
      const e = val(l.Elevation);
      return { expressId: id, name: storeyName(str(l.Name), str(l.LongName)) || `Geschoss ${id}`, elevation: typeof e === 'number' ? e * scale : NaN };
    });

    // Zuordnung Bauteil → Geschoss (direkt oder über übergeordnete Bauteile/Zonen)
    const parent = new Map<number, number>();
    const storeyOf = new Map<number, number>();
    for (const id of ids(T.IFCRELAGGREGATES)) {
      const l = api.GetLine(m, id);
      const rel = val(l.RelatingObject) as number;
      for (const o of (l.RelatedObjects ?? []) as unknown[]) parent.set(val(o) as number, rel);
    }
    for (const id of ids(T.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const l = api.GetLine(m, id);
      const rel = val(l.RelatingStructure) as number;
      for (const o of (l.RelatedElements ?? []) as unknown[]) storeyOf.set(val(o) as number, rel);
    }
    const storeyIndex = new Map(storeyIds.map((id, i) => [id, i]));
    const resolveStorey = (id: number): number => {
      let cur: number | undefined = id;
      for (let k = 0; k < 12 && cur !== undefined; k++) {
        if (storeyIndex.has(cur)) return storeyIndex.get(cur)!;
        const s = storeyOf.get(cur);
        if (s !== undefined && storeyIndex.has(s)) return storeyIndex.get(s)!;
        cur = s ?? parent.get(cur);
      }
      return -1;
    };

    const parentTypeOf = (id: number): string | undefined => {
      const p = parent.get(id);
      if (p === undefined) return undefined;
      try {
        return api.GetNameFromTypeCode(api.GetLine(m, p).type).toUpperCase();
      } catch {
        return undefined;
      }
    };

    // Nettoflächen der Räume aus Mengen (Qto_SpaceBaseQuantities / BaseQuantities)
    const spaceIds = ids(T.IFCSPACE);
    const spaceSet = new Set(spaceIds);
    const netArea = new Map<number, number>();
    for (const id of ids(T.IFCRELDEFINESBYPROPERTIES)) {
      const l = api.GetLine(m, id);
      const objs = ((l.RelatedObjects ?? []) as unknown[]).map((o) => val(o) as number).filter((o) => spaceSet.has(o));
      if (!objs.length) continue;
      const def = api.GetLine(m, val(l.RelatingPropertyDefinition) as number);
      const qs = (def?.Quantities ?? []) as unknown[];
      for (const q of qs) {
        const ql = api.GetLine(m, val(q) as number);
        const n = str(ql?.Name);
        const a = val(ql?.AreaValue);
        if (typeof a === 'number' && (n === 'NetFloorArea' || n === 'NetArea')) for (const o of objs) netArea.set(o, a);
      }
    }

    // Geometrie
    onProgress?.('Geometrie wird berechnet …');
    const elements: IfcMeshPart[] = [];
    const spaceTris = new Map<number, Float32Array>();
    const collect = (mesh: { expressID: number; geometries: { size(): number; get(i: number): { geometryExpressID: number; flatTransformation: number[]; color: { x: number; y: number; z: number; w: number } } } }) => {
      const tris: number[] = [];
      let color: [number, number, number, number] = [0.7, 0.7, 0.7, 1];
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const pg = mesh.geometries.get(i);
        color = [pg.color.x, pg.color.y, pg.color.z, pg.color.w];
        const g = api.GetGeometry(m, pg.geometryExpressID);
        const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
        const M = pg.flatTransformation;
        for (let k = 0; k < idx.length; k++) {
          const o = idx[k] * 6;
          const x = v[o];
          const y = v[o + 1];
          const z = v[o + 2];
          const X = M[0] * x + M[4] * y + M[8] * z + M[12];
          const Y = M[1] * x + M[5] * y + M[9] * z + M[13];
          const Z = M[2] * x + M[6] * y + M[10] * z + M[14];
          tris.push(X, Z, Y); // Grundriss: x, y = −Nord = Z(three), Höhe = Y(three)
        }
        g.delete?.();
      }
      return { tris: Float32Array.from(tris), color };
    };

    api.StreamAllMeshes(m, (mesh) => {
      const line = api.GetLine(m, mesh.expressID);
      const type = api.GetNameFromTypeCode(line.type).toUpperCase();
      if (SKIP_TYPES.has(type)) return;
      const { tris, color } = collect(mesh as never);
      if (!tris.length) return;
      elements.push({
        expressId: mesh.expressID,
        type,
        name: str(line.Name),
        predefinedType: str(line.PredefinedType).toUpperCase(),
        storey: resolveStorey(mesh.expressID),
        parentType: parentTypeOf(mesh.expressID),
        tris,
        color,
      });
    });
    if (spaceIds.length) {
      // Raumkörper werden von StreamAllMeshes ausgelassen. Die Browser-Builds von web-ifc unterscheiden
      // sich in der Signatur der Stream-Funktionen, daher mehrere Wege versuchen.
      const onSpace = (mesh: { expressID: number }) => {
        if (!spaceTris.has(mesh.expressID)) spaceTris.set(mesh.expressID, collect(mesh as never).tris);
      };
      const attempts: (() => void)[] = [
        () => api.StreamMeshes(m, spaceIds, onSpace),
        () => api.StreamAllMeshesWithTypes(m, [T.IFCSPACE], onSpace),
        () => spaceIds.forEach((id) => onSpace(api.GetFlatMesh(m, id) as never)),
      ];
      for (const tryIt of attempts) {
        try {
          tryIt();
          if (spaceTris.size) break;
        } catch (e) {
          // nächsten Weg versuchen
          log.debug('Raumgeometrie: Variante nicht verfügbar, nächste wird versucht', e);
        }
      }
    }

    const spaces: IfcSpaceData[] = spaceIds
      .map((id) => {
        const l = api.GetLine(m, id);
        return {
          expressId: id,
          name: str(l.Name),
          longName: str(l.LongName),
          storey: resolveStorey(id),
          tris: spaceTris.get(id) ?? new Float32Array(),
          netFloorArea: netArea.get(id),
        };
      })
      .filter((s) => s.tris.length > 0);

    // Geschosshöhen ohne Angabe aus der Geometrie
    const storeys = storeysRaw.map((s, i) => {
      if (Number.isFinite(s.elevation)) return s;
      let minZ = Infinity;
      for (const e of elements) if (e.storey === i) for (let k = 2; k < e.tris.length; k += 3) minZ = Math.min(minZ, e.tris[k]);
      return { ...s, elevation: Number.isFinite(minZ) ? minZ : 0 };
    });

    // Georeferenzierte Modelle weit weg vom Ursprung in die Nähe von 0 verschieben
    let minX = Infinity;
    let minY = Infinity;
    for (const e of elements) {
      for (let k = 0; k < e.tris.length; k += 3) {
        minX = Math.min(minX, e.tris[k]);
        minY = Math.min(minY, e.tris[k + 1]);
      }
    }
    const offset = { x: Math.abs(minX) > 5000 ? Math.floor(minX) : 0, y: Math.abs(minY) > 5000 ? Math.floor(minY) : 0 };
    if (offset.x || offset.y) {
      const shift = (t: Float32Array) => {
        for (let k = 0; k < t.length; k += 3) {
          t[k] -= offset.x;
          t[k + 1] -= offset.y;
        }
      };
      elements.forEach((e) => shift(e.tris));
      spaces.forEach((s) => shift(s.tris));
    }

    return { schema, projectName, storeys, spaces, elements, offset };
  } finally {
    api.CloseModel(m);
  }
}

/** Faktor Modelleinheit → Meter (für Attribute wie Geschosshöhenkoten) */
function lengthUnitScale(api: IfcAPI, m: number, T: IfcTypeCodes): number {
  const PREFIX: Record<string, number> = { MILLI: 1e-3, CENTI: 1e-2, DECI: 1e-1, KILO: 1e3 };
  const ua = api.GetLineIDsWithType(m, T.IFCUNITASSIGNMENT);
  if (ua.size() === 0) return 1;
  const units = (api.GetLine(m, ua.get(0)).Units ?? []) as { value: number }[];
  for (const u of units) {
    const l = api.GetLine(m, u.value);
    if (l?.UnitType?.value !== 'LENGTHUNIT') continue;
    if (l.Prefix?.value) return PREFIX[l.Prefix.value] ?? 1;
    // IfcConversionBasedUnit (z. B. Fuß)
    if (l.ConversionFactor) {
      const mw = api.GetLine(m, l.ConversionFactor.value);
      const f = mw?.ValueComponent?.value;
      if (typeof f === 'number') return f;
    }
    return 1;
  }
  return 1;
}

/** Archicad schreibt eine interne Kennung (ACID…) in LongName – dann den Namen verwenden */
function storeyName(name: string, longName: string): string {
  if (longName && !/^ACID[0-9A-F-]+$/i.test(longName) && !name) return longName;
  return name || longName;
}
