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
  /** Embedded FK display value (e.g., "john@email.com" when FK value is 42) */
  embeddedValue?: string | null;
  // Column metadata for editor header display
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;
  // Connection context for FK lookup queries
  connectionId?: string;
  database?: string;
  sourceSchema?: string;
  sourceTable?: string;
}

export interface ReferenceCustomCell extends CustomCell {
  kind: typeof GridCellKind.Custom;
  data: ReferenceCellData;
  copyData: string;
  readonly?: boolean;
}
