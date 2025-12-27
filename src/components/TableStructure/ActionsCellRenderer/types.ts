import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

export interface ActionsCellData {
  kind: "actions-cell";
  isPendingDelete: boolean;
}

export interface ActionsCell extends CustomCell<ActionsCellData> {
  kind: GridCellKind.Custom;
}
