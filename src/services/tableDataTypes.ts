/**
 * Type definitions for TableDataService based on db_table_data API specification
 */
import type { CellValue } from '@/components/DataTable/types';
import type { ColumnMeta } from '@/types/database';

// Sort specification for db_table_data
export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

// Filter specification with discriminated union for type safety
export type FilterSpec =
  | {
      column: string;
      operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE' | 'ILIKE';
      value: string | number | boolean | null;
    }
  | {
      column: string;
      operator: 'IN';
      value: (string | number | boolean)[];
    }
  | {
      column: string;
      operator: 'IS NULL' | 'IS NOT NULL';
    }
  | {
      column: string;
      operator: 'BETWEEN';
      value: [string | number, string | number];
    };

// Parameters for db_table_data command
export interface TableDataParams {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  select?: string[];
  sorts?: SortSpec[];
  filters?: FilterSpec[];
  search?: string;
  cursor?: string;
  offset?: number;
  limit?: number;
}

// Table data row type - each row is a map of column names to CellValues
export type TableDataRow = Record<string, CellValue>;

// Event types emitted by db_table_data stream
export interface TableDataMetaEvent {
  type: 'meta';
  table: string;
  schema?: string;
  columns: ColumnMeta[];
  selected: string[];
  page_size: number;
  cursor_key_columns: string[];
}

export interface TableDataRowsEvent {
  type: 'rows';
  rows: TableDataRow[];
  next_cursor?: string;
}

export interface TableDataDoneEvent {
  type: 'done';
}

export interface TableDataErrorEvent {
  type: 'error';
  code: string;
  message: string;
}

// Union type for all table data events
export type TableDataEvent =
  | TableDataMetaEvent
  | TableDataRowsEvent
  | TableDataDoneEvent
  | TableDataErrorEvent;

// Callback interface for handling table data stream events
export interface TableDataCallbacks {
  onMeta: (meta: TableDataMetaEvent) => void;
  onRows: (rows: TableDataRowsEvent) => void;
  onDone: () => void;
  onError: (error: TableDataErrorEvent) => void;
}

// Table data stream control interface
export interface TableDataStream {
  streamId: string;
  stop: () => Promise<void>;
  isActive: boolean;
}

// Service error types
export interface TableDataServiceError {
  type: 'connection' | 'stream' | 'parameter' | 'timeout';
  message: string;
  code?: string;
  originalError?: unknown;
}

// Stream state for tracking active streams
export interface StreamState {
  streamId: string;
  isActive: boolean;
  callbacks: TableDataCallbacks;
  unlisten?: (() => void);
  startTime: number;
}