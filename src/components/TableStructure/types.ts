import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";
import type { ColumnMeta } from "@/types/database";
import type { ForeignKeyInfo, Constraint } from "@/types/tableStructure";

// Grid row format
export interface StructureGridRow {
  row_number: number;
  column_name: string;
  column_meta: {
    is_pk: boolean;
    is_fk: boolean;
  };
  db_type: string;
  nullable: string;
  default: string | null;
  foreign_key: string;
  check_constraint: string;
  comment: string;
  _original?: ColumnMeta;
  _tempId?: string; // For pending column additions
  _isPending?: boolean; // True for new columns not yet committed
  _isModified?: boolean; // True for existing columns with pending modifications
}

interface ColumnNameCellData {
  kind: "column-name-cell";
  name: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

// Custom cell for column name with PK/FK indicators
export interface ColumnNameCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: ColumnNameCellData;
  copyData: string;
  readonly?: boolean;
}

export interface StructureData {
  columns: ColumnMeta[];
  foreignKeys: ForeignKeyInfo[];
  constraints: Constraint[];
}
