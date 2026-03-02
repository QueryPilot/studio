import type { CustomCell, GridCellKind } from "@glideapps/glide-data-grid";
import type { TableIndex } from "@/services/databaseService";
import type { IndexUsageStats } from "@/services/backend";

// Grid row format - index signature required for TableDataRow compatibility
export interface IndexGridRow {
  [key: string]: unknown; // Index signature for TableDataRow compatibility
  row_number: number;
  name: string;
  name_meta: {
    primary: boolean;
    unique: boolean;
  };
  columns: string;
  columns_array: string[]; // Actual array for editing (columns is display string)
  index_type: string;
  unique: string;
  statistics: string;
  stats?: IndexUsageStats;
  condition: string;
  _original?: TableIndex; // Keep reference to original data
  _tempId?: string; // For pending index additions
  _isPending?: boolean; // True for new indexes not yet committed
  _isPendingDelete?: boolean; // True for existing indexes marked for deletion
  _isModified?: boolean; // True when any field is modified
  _requiresRecreate?: boolean; // True when non-name fields changed on existing index
}

interface IndexNameCellData {
  kind: "index-name-cell";
  name: string;
  isPrimary: boolean;
  isUnique: boolean;
}

// Custom cell for index name with badges
export interface IndexNameCustomCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: IndexNameCellData;
  copyData: string;
  readonly?: boolean;
}

// Editable index name cell (for rename)
export interface EditableIndexNameCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "editable-index-name-cell";
    name: string;
    isPrimary: boolean;
    isUnique: boolean;
    isLocked: boolean; // true for PK indexes
  };
  copyData: string;
  readonly?: boolean;
}

// Index columns cell with tag display
export interface IndexColumnsCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-columns-cell";
    columns: string[];
    originalColumns?: string[];
    availableColumns: string[];
    requiresRecreate: boolean;
    isLocked: boolean;
  };
  copyData: string;
  readonly?: boolean;
}

// Index type dropdown cell
export interface IndexTypeCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-type-cell";
    value: string;
    options: string[];
    requiresRecreate: boolean;
    isLocked: boolean;
  };
  copyData: string;
  readonly?: boolean;
}

// Unique toggle cell (YES/NO)
export interface IndexUniqueCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-unique-cell";
    value: "YES" | "NO";
    requiresRecreate: boolean;
    isLocked: boolean;
  };
  copyData: string;
  readonly?: boolean;
}

// Index condition cell with SQL editor
export interface IndexConditionCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: {
    kind: "index-condition-cell";
    value: string;
    requiresRecreate: boolean;
    isLocked: boolean;
    dialect: string;
  };
  copyData: string;
  readonly?: boolean;
}
