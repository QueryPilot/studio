import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";

interface ByteaCellData {
  kind: "bytea-cell";
  value: string | null; // Base64 encoded
  nullable?: boolean;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface ByteaCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: ByteaCellData;
  copyData: string;
  readonly?: boolean;
}

export type ByteaDisplayMode = "base64" | "hex" | "ascii";

