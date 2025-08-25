/**
 * DataTable TypeScript type definitions based on CellValue from API spec
 */

// Import CellValue types from API spec
export interface CellValue {
  value: unknown | null;
  db_type: string;
  value_type: CellValueType;
  metadata?: CellMetadata;
  is_truncated: boolean;
  byte_size?: number;
}

export type CellValueType =
  | "Null"
  | "Text"
  | "Integer"
  | "Decimal"
  | "Boolean"
  | "Date"
  | "DateTime"
  | "Time"
  | "Json"
  | "Binary"
  | "Uuid"
  | "Array"
  | "Geometry"
  | "Xml"
  | "Enum"
  | "Unknown";

export interface CellMetadata {
  precision?: number;
  scale?: number;
  max_length?: number;
  charset?: string;
  timezone?: string;
  element_type?: string;
  srid?: number;
  enum_values?: string[];
  attributes?: Record<string, unknown>;
}

// Column definition for DataTable
export interface ColumnDefinition {
  id: string;
  name: string;
  dbType: string;
  valueType: CellValueType;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  editable?: boolean;
  sticky?: 'left' | 'right';
  metadata?: CellMetadata;
}

// Row data type - each row is a record with column id as key and CellValue as value
export type DataTableRow = Record<string, CellValue>;

// Selection state management
export interface SelectionState {
  selectedRows: Set<string>;
  selectedCells: Set<string>; // "rowId:columnId" format
  anchorRow?: string;
  focusRow?: string;
  selectionMode: 'row' | 'cell' | 'range';
}

// Edit state management
export interface EditState {
  editingCell: string | null; // "rowId:columnId" format
  editingValue: CellValue | null;
  isValidValue: boolean;
  originalValue: CellValue | null;
}

// DataTable component props
export interface DataTableProps {
  // Data & Structure
  data: DataTableRow[];
  columns: ColumnDefinition[];
  isLoading: boolean;
  
  // Row identification
  rowIdField: string; // Which field to use as row ID
  
  // Data Loading
  onLoadMore: () => void;
  hasNextPage: boolean;
  
  // Selection
  selectedRows: Set<string>;
  onRowSelect: (rows: DataTableRow[], mode: 'single' | 'range' | 'toggle') => void;
  
  // Editing
  onCellEdit: (rowId: string, field: string, value: CellValue) => void;
  editableColumns?: Set<string>;
  
  // Actions
  onRowDelete: (rows: DataTableRow[]) => void;
  onCopyRows: (rows: DataTableRow[], format: 'json' | 'csv' | 'insert') => void;
  
  // UI State
  showPreviewPanel?: boolean;
  previewMode?: 'table' | 'json';
  onPreviewModeChange?: (mode: 'table' | 'json') => void;
}

// Cell renderer component props
export interface CellRendererProps {
  value: CellValue;
  rowId: string;
  columnId: string;
  isSelected: boolean;
  isEditing: boolean;
  isHovered: boolean;
  
  // Actions
  onEdit: (value: CellValue) => void;
  onCopy: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  
  // Metadata
  column: ColumnDefinition;
  rowIndex: number;
  columnIndex: number;
}

// Virtualization constants
export const VIRTUALIZATION_CONFIG = {
  ROW_HEIGHT: 32,
  HEADER_HEIGHT: 40,
  DEFAULT_COLUMN_WIDTH: 180,
  MIN_COLUMN_WIDTH: 120,
  MAX_COLUMN_WIDTH: 500,
  OVERSCAN_ROW_COUNT: 5,
  OVERSCAN_COLUMN_COUNT: 2,
} as const;

// Context menu action types
export interface ContextMenuAction {
  label: string;
  action: string;
  icon?: string;
  variant?: 'default' | 'destructive';
  type?: 'separator';
}

// Preview panel modes
export type PreviewMode = 'table' | 'json';

// Copy formats
export type CopyFormat = 'json' | 'csv' | 'insert';