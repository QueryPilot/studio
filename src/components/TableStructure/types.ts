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
    is_computed?: boolean;
    is_identity?: boolean;
  };
  db_type: string;
  nullable: string;
  default: string | null;
  foreign_key: string;
  is_computed: string;
  check_constraint: string;
  comment: string;
  // MySQL/MariaDB specific
  character_set?: string;
  collation?: string;
  extra?: string;
  _originalData?: ColumnMeta;
  _tempId?: string; // For pending column additions
  _isPending?: boolean; // True for new columns not yet committed
  _isModified?: boolean; // True for existing columns with pending modifications
  _isPendingDelete?: boolean; // True for existing columns marked for deletion
}

// Validation result for column editing
export interface ColumnValidationResult {
  valid: boolean;
  error?: string;
}

// Column name validation
export function validateColumnName(
  name: string,
  existingColumnNames: string[],
  currentColumnName?: string
): ColumnValidationResult {
  if (!name || name.trim() === "") {
    return { valid: false, error: "Column name is required" };
  }

  const trimmedName = name.trim();

  // Check for valid identifier format (letters, numbers, underscores, starting with letter or underscore)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName)) {
    return {
      valid: false,
      error: "Column name must start with a letter or underscore and contain only letters, numbers, and underscores",
    };
  }

  // Check uniqueness (exclude current column when renaming)
  const otherColumns = currentColumnName
    ? existingColumnNames.filter((n) => n !== currentColumnName)
    : existingColumnNames;

  if (otherColumns.some((n) => n.toLowerCase() === trimmedName.toLowerCase())) {
    return { valid: false, error: "Column name already exists" };
  }

  // Check for reserved SQL keywords (common ones)
  const reservedKeywords = [
    "select", "from", "where", "insert", "update", "delete", "table",
    "column", "index", "primary", "foreign", "key", "constraint",
    "create", "drop", "alter", "null", "not", "and", "or", "order", "by",
  ];

  if (reservedKeywords.includes(trimmedName.toLowerCase())) {
    return {
      valid: false,
      error: `"${trimmedName}" is a reserved SQL keyword`,
    };
  }

  return { valid: true };
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

interface DefaultValueCellData {
  kind: "default-value-cell";
  value: string | null;
  columnName?: string;
  dbType?: string;
}

export interface DefaultValueCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: DefaultValueCellData;
  copyData: string;
  readonly?: boolean;
}

export interface ForeignKeyTargetSuggestion {
  table: string;
  column: string;
  type: string;
}

interface ForeignKeyCellData {
  kind: "foreign-key-cell";
  value: string;
  columnName?: string;
  suggestions: ForeignKeyTargetSuggestion[];
}

export interface ForeignKeyCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: ForeignKeyCellData;
  copyData: string;
  readonly?: boolean;
}

interface CheckConstraintCellData {
  kind: "check-constraint-cell";
  value: string | null;
  columnName?: string;
}

export interface CheckConstraintCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: CheckConstraintCellData;
  copyData: string;
  readonly?: boolean;
}

interface CommentCellData {
  kind: "comment-cell";
  value: string | null;
  columnName?: string;
}

export interface CommentCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: CommentCellData;
  copyData: string;
  readonly?: boolean;
}

export interface StructureData {
  columns: ColumnMeta[];
  foreignKeys: ForeignKeyInfo[];
  constraints: Constraint[];
}
