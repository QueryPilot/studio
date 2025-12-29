import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface IndexUniqueCellData {
  kind: "index-unique-cell";
  value: "YES" | "NO";
  requiresRecreate: boolean;
  isLocked: boolean;
}

export interface IndexUniqueCell extends CustomCell<IndexUniqueCellData> {
  kind: GridCellKind.Custom;
  copyData: string;
  readonly?: boolean;
}
