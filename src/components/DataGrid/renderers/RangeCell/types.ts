import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";

export type RangeCellKind =
  | "int4range-cell"
  | "int8range-cell"
  | "numrange-cell"
  | "daterange-cell"
  | "tsrange-cell";

export type RangeValueType = "integer" | "numeric" | "date" | "timestamp";

export type Bounds = "[]" | "[)" | "(]" | "()";

interface RangeCellData {
  kind: RangeCellKind;
  value: string | null;
  nullable?: boolean;
  // Type of the range elements
  elementType?: RangeValueType;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
  // For numeric ranges
  precision?: number;
  scale?: number;
}

export interface RangeCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: RangeCellData;
  copyData: string;
  readonly?: boolean;
}

export interface ParsedRange {
  lower: string | null;
  upper: string | null;
  bounds: Bounds;
  lowerInclusive: boolean;
  upperInclusive: boolean;
}

