import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";
interface UuidCellData {
  kind: "uuid-cell";
  value: string | null;
  nullable?: boolean;
  isValid?: boolean;
}

export interface UuidCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: UuidCellData;
  copyData: string;
  readonly?: boolean;
}
