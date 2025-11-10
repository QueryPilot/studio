import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";

export type DateTimeKind = "date-cell" | "time-cell" | "datetime-cell";

interface DateTimeCellData {
  kind: DateTimeKind;
  value: string | null;
  nullable?: boolean;
  format?: string; // display/parse hint
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface DateTimeCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: DateTimeCellData;
  copyData: string;
  readonly?: boolean;
}

export type Bounds = "[]" | "[)" | "(]" | "()";

export interface TstzRangeCellData {
  kind: "tstzrange-cell";
  // Canonical text representation, e.g. "[2025-01-01T00:00:00Z,2025-01-02T00:00:00Z)"
  value: string | null;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface TstzRangeCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: TstzRangeCellData;
  copyData: string;
  readonly?: boolean;
}
