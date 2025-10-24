import { type CustomCell, type GridCellKind } from "@glideapps/glide-data-grid";

export interface NumberCellData {
  kind: "number-cell";
  value: string | null;
  nullable?: boolean;
  dbType?: string;
  precision?: number | null;
  scale?: number | null;
}

export interface NumberCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: NumberCellData;
  copyData: string;
  readonly?: boolean;
}
