import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";

interface TextSingleLineCellData {
  kind: "text-single-cell";
  value: string | null;
  nullable?: boolean;
  maxLength?: number;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface TextSingleLineCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: TextSingleLineCellData;
  copyData: string;
  readonly?: boolean;
}

interface TextMultiLineCellData {
  kind: "text-multi-cell";
  value: string | null;
  nullable?: boolean;
  displayValue?: string | null;
  showLineBadge?: boolean;
  formatDisplayMode?: "array-inline";
}

export interface TextMultiLineCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: TextMultiLineCellData;
  copyData: string;
  readonly?: boolean;
}
