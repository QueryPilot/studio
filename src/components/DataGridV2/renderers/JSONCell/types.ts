import { type CustomCell, type GridCellKind } from "@glideapps/glide-data-grid";

interface JsonCellData {
  kind: "json-cell";
  value: string | null;
  nullable?: boolean;
  isValid?: boolean;
}

export interface JsonCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: JsonCellData;
  copyData: string;
  readonly?: boolean;
}
