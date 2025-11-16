import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface NullableCellData {
  kind: "nullable-cell";
  value: "YES" | "NO";
  columnName?: string; // Column name for display in editor header
}

export interface NullableCell extends CustomCell<NullableCellData> {
  kind: GridCellKind.Custom;
}
