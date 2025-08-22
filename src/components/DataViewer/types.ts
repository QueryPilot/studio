import { type ColumnFiltersState, type ColumnOrderState, type ColumnSizingState, type RowSelectionState, type SortingState, type VisibilityState } from "@tanstack/react-table";

export interface DataViewerProps {
  tableName: string;
  schema?: string;
  connectionId?: string;
  onRowClick?: (row: any) => void;
  initialViewMode?: ViewMode;
  // For query results mode - provide data directly instead of fetching
  preloadedData?: {
    data: any[];
    columns: string[];
    totalRows?: number;
    queryTime?: number;
  };
}

export type ViewMode = "data" | "structure" | "indexes" | "triggers";
export type DetailViewMode = "table" | "json";

export interface TableColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  is_unique?: boolean;
  is_indexed?: boolean;
  check_constraint?: string;
  fk_reference?: {
    constraint_name: string;
    referenced_schema: string;
    referenced_table: string;
    referenced_column: string;
    on_delete: string;
    on_update: string;
  };
}

export interface TableState {
  data: any[];
  columns: any[];
  tableStructure: TableColumn[];
  isLoading: boolean;
  isFetchingMore: boolean;
  dataLoaded: boolean;
  structureLoaded: boolean;
  error: string | null;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  columnVisibility: VisibilityState;
  globalFilter: string;
  estimatedRowCount: number | null;
  columnSizing: ColumnSizingState;
  columnOrder: ColumnOrderState;
  rowSelection: RowSelectionState;
  selectedRow: any;
  showDetails: boolean;
  detailViewMode: DetailViewMode;
  detailsPanelSize: number;
  isSelecting: boolean;
  selectionStart: number | null;
  lastSelectedIndex: number | null;
  offset: number;
  hasMore: boolean;
}