import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface IndexColumnsCellData {
  kind: "index-columns-cell";
  columns: string[];
  availableColumns: string[];
  requiresRecreate: boolean;
  isLocked: boolean;
}

export interface IndexColumnsCell extends CustomCell<IndexColumnsCellData> {
  kind: GridCellKind.Custom;
  copyData: string;
  readonly?: boolean;
}
