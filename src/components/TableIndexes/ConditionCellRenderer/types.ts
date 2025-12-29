import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface IndexConditionCellData {
  kind: "index-condition-cell";
  value: string;
  requiresRecreate: boolean;
  isLocked: boolean;
  dialect: string;
}

export interface IndexConditionCell extends CustomCell<IndexConditionCellData> {
  kind: GridCellKind.Custom;
  copyData: string;
  readonly?: boolean;
}
