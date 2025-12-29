import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface IndexTypeCellData {
  kind: "index-type-cell";
  value: string;
  options: string[];
  requiresRecreate: boolean;
  isLocked: boolean;
}

export interface IndexTypeCell extends CustomCell<IndexTypeCellData> {
  kind: GridCellKind.Custom;
  copyData: string;
  readonly?: boolean;
}
