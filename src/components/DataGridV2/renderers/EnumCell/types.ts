import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";

interface EnumCellData {
  kind: "enum-cell";
  value: string | null;
  allowedValues: string[];
  nullable?: boolean;
}

// Define our custom enum cell type
export interface EnumCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: EnumCellData;
  copyData: string;
  readonly?: boolean;
}
