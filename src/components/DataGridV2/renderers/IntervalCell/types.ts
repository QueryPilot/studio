import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";

interface IntervalCellData {
  kind: "interval-cell";
  value: string | null;
  nullable?: boolean;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface IntervalCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: IntervalCellData;
  copyData: string;
  readonly?: boolean;
}

export interface IntervalParts {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  negative: boolean;
}

