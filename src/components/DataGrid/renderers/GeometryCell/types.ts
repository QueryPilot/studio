import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";

export type GeometryCellKind = "geometry-cell" | "geography-cell";

export type GeometryType =
  | "POINT"
  | "LINESTRING"
  | "POLYGON"
  | "MULTIPOINT"
  | "MULTILINESTRING"
  | "MULTIPOLYGON"
  | "GEOMETRYCOLLECTION";

interface GeometryCellData {
  kind: GeometryCellKind;
  value: string | null; // WKT or EWKT format
  nullable?: boolean;
  // SRID for the geometry
  srid?: number;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface GeometryCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: GeometryCellData;
  copyData: string;
  readonly?: boolean;
}

export interface ParsedGeometry {
  type: GeometryType | null;
  srid: number | null;
  coordinates: string;
  isValid: boolean;
  error?: string;
}

