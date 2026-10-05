/** Aus einem IFC-Modell gelesene Rohdaten (unabhängig von web-ifc). */

export interface IfcMeshPart {
  expressId: number;
  /** IFC-GlobalId (bleibt bei erneutem Export gleich) */
  globalId?: string;
  /** Außenbauteil laut Eigenschaften (IsExternal); ohne Angabe unbekannt */
  isExternal?: boolean;
  type: string;
  name: string;
  predefinedType: string;
  /** Typ des übergeordneten Bauteils (z. B. IFCCURTAINWALL bei Pfosten/Paneelen) */
  parentType?: string;
  /** Index in storeys oder −1 */
  storey: number;
  /** Dreiecke: je 9 Werte (x, y, z) in Grundrisskoordinaten, z = absolute Höhe */
  tris: Float32Array;
  color: [number, number, number, number];
}

export interface IfcSpaceData {
  expressId: number;
  /** Archicad: Zonennummer */
  name: string;
  /** Archicad: Zonenname */
  longName: string;
  storey: number;
  tris: Float32Array;
  /** Nettofläche aus den Mengen (Qto), falls exportiert */
  netFloorArea?: number;
}

export interface IfcExtract {
  schema: string;
  projectName: string;
  storeys: { name: string; elevation: number; expressId: number }[];
  spaces: IfcSpaceData[];
  elements: IfcMeshPart[];
  /** Versatz, um den das Modell in die Nähe des Ursprungs verschoben wurde */
  offset: { x: number; y: number };
}

