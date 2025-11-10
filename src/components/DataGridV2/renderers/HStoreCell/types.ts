import { type CustomCell, type GridCellKind } from "@glideapps/glide-data-grid";

interface HStoreCellData {
  kind: "hstore-cell";
  value: string | null;
  nullable?: boolean;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface HStoreCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: HStoreCellData;
  copyData: string;
  readonly?: boolean;
}
