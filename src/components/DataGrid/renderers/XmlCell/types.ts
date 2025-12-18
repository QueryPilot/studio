import { type GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";

interface XmlCellData {
  kind: "xml-cell";
  value: string | null;
  nullable?: boolean;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
}

export interface XmlCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: XmlCellData;
  copyData: string;
  readonly?: boolean;
}

export interface XmlValidationResult {
  isValid: boolean;
  error?: string;
  errorLine?: number;
  errorColumn?: number;
}

