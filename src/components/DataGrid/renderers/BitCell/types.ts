import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";

export type BitCellKind = "bit-cell" | "varbit-cell";

interface BitCellData {
  kind: BitCellKind;
  value: string | null;
  nullable?: boolean;
  // For fixed-length BIT(n), the expected length
  length?: number;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface BitCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: BitCellData;
  copyData: string;
  readonly?: boolean;
}

export type BitDisplayMode = "binary" | "hex" | "decimal";

