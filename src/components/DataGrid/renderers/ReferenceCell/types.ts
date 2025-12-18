import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";

interface ReferenceCellData {
  kind: "reference-cell";
  value: string | number | null;
  nullable?: boolean;
  fkReference?: {
    schema: string;
    table: string;
    column: string;
  };
  displayValue?: string;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface ReferenceCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: ReferenceCellData;
  copyData: string;
  readonly?: boolean;
}
