import { type CustomCell, type GridCellKind } from "@glideapps/glide-data-grid";

interface JsonCellData {
  kind: "json-cell";
  value: string | null;
  nullable?: boolean;
  isValid?: boolean;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface JsonCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: JsonCellData;
  copyData: string;
  readonly?: boolean;
}
