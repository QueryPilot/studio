import { type CustomCell, type GridCellKind } from "@glideapps/glide-data-grid";

interface ExpandableCellData {
  kind: "expandable-cell";
  value: unknown;
  isExpanded?: boolean;
  nullable?: boolean;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface ExpandableCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: ExpandableCellData;
  copyData: string;
  readonly?: boolean;
}
