import type { IfcExtract } from '../ifcData';
/** IFC-Modell zur Anzeige in der 3D-Ansicht (Dreiecksnetze je Bauteiltyp und Farbe) */
export interface IfcReference {
  name: string;
  meshes: { type: string; positions: Float32Array; indices: Uint32Array; color: [number, number, number, number] }[];
}
import { extractIfc } from './ifcExtract';

/**
 * Lädt eine IFC-Datei im Browser bzw. in der Tauri-WebView mit web-ifc (WebAssembly).
 * web-ifc wird erst bei Bedarf nachgeladen.
 */
export async function loadIfc(data: Uint8Array, onProgress?: (msg: string) => void): Promise<IfcExtract> {
  onProgress?.('IFC-Modul wird geladen …');
  const W = await import('web-ifc');
  const wasmUrl = (await import('web-ifc/web-ifc.wasm?url')).default;
  const api = new W.IfcAPI();
  // einfädig: kein SharedArrayBuffer/COOP-Header nötig (Web-Hosting und Tauri)
  await api.Init((path: string) => (path.endsWith('.wasm') ? wasmUrl : path), true);
  // dem Browser Zeit für die Fortschrittsanzeige lassen
  await new Promise((r) => setTimeout(r, 30));
  return extractIfc(api, W as never, data, onProgress);
}

/** Dreiecksnetze für die 3D-Ansicht (three.js: x, Höhe, y) */
export function ifcReference(x: IfcExtract, name: string): IfcReference {
  const byType = new Map<string, { pos: number[]; color: [number, number, number, number] }>();
  for (const e of x.elements) {
    if (e.type === 'IFCSITE') continue;
    const key = `${e.type}|${e.color.join(',')}`;
    let g = byType.get(key);
    if (!g) byType.set(key, (g = { pos: [], color: e.color }));
    const t = e.tris;
    for (let k = 0; k < t.length; k += 3) g.pos.push(t[k], t[k + 2], t[k + 1]);
  }
  return {
    name,
    meshes: [...byType.entries()].map(([key, g]) => {
      const positions = Float32Array.from(g.pos);
      const indices = new Uint32Array(positions.length / 3);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return { type: key.split('|')[0], positions, indices, color: g.color };
    }),
  };
}
