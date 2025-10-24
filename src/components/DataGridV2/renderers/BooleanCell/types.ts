import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

interface BooleanCellData {
  kind: "boolean-cell";
  value: boolean | null;
}

// Define our custom boolean cell type
export interface BooleanCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: BooleanCellData;
  copyData: string;
  readonly?: boolean;
}
