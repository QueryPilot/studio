import { type CustomCell, type GridCellKind } from "@glideapps/glide-data-grid";

interface HStoreCellData {
  kind: "hstore-cell";
  value: string | null;
  nullable?: boolean;
}

export interface HStoreCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: HStoreCellData;
  copyData: string;
  readonly?: boolean;
}
