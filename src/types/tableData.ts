/**
 * @deprecated This file contains legacy types. Use imports from:
 * - @/types/schema for ColumnMeta and schema types
 * - @/types/filter for FilterConfig and SortConfig
 * - @/services/tableDataTypes for TableData* types
 */

// Import for local use
import type { ColumnMeta } from "./schema";
import type { FilterConfig, SortConfig } from "./filter";

// Re-export from canonical locations for backwards compatibility
export type { ColumnMeta };
export type { FilterConfig as FilterSpec, SortConfig as SortSpec };

// Legacy types - kept for backwards compatibility but prefer using tableDataTypes.ts
export interface TableReadRequest {
  connectionId: string;
  table: string;
  schema?: string;
  select?: string[];
  sorts?: SortConfig[];
  filters?: FilterConfig;
  search?: string;
  cursor?: string;
  offset?: number;
  limit?: number;
}

export type FilterOperator =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'LIKE'
  | 'ILIKE'
  | 'IN'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'BETWEEN';

export type TableDataResponse =
  | TableDataMeta
  | TableDataRows
  | TableDataDone
  | TableDataError;

export interface TableDataMeta {
  type: 'meta';
  table: string;
  schema?: string;
  columns: ColumnMeta[];
  selected: string[];
  pageSize: number;
  cursorKeyColumns: string[];
}

export interface TableDataRows {
  type: 'rows';
  rows: Record<string, unknown>[];
  nextCursor?: string;
}

export interface TableDataDone {
  type: 'done';
}

export interface TableDataError {
  type: 'error';
  code: string;
  message: string;
}

// Helper type for table data stream
export interface TableDataStream {
  streamId: string;
  meta?: TableDataMeta;
  rows: Record<string, unknown>[];
  error?: TableDataError;
  isComplete: boolean;
  nextCursor?: string;
}