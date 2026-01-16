import type { GridCell } from '@glideapps/glide-data-grid';
import type { GridColumnV2, GridRowModel } from '../types';
import type { CrudCommand } from '@/types/crud';
import type { GridEditCommitEvent } from '../types';

/**
 * Identifier for different data source types
 */
export type DataSourceIdentifier =
  | { type: 'table'; database: string; schema?: string; table: string }
  | { type: 'collection'; database: string; collection: string }
  | { type: 'keyspace'; database: number; pattern?: string };

/**
 * Core abstraction for all data sources (SQL, Document, KeyValue)
 */
export interface GridDataSource<TRow = GridRowModel> {
  readonly paradigm: 'sql' | 'document' | 'keyvalue';
  readonly connectionId: string;
  readonly identifier: DataSourceIdentifier;

  // Column definition
  getColumns(): GridColumnV2[];

  // Data access
  getRowCount(): number;
  getRow(index: number): TRow | undefined;
  getCellContent(row: number, col: number): GridCell;

  // Streaming/pagination
  fetchMore(offset: number, limit: number): Promise<void>;
  readonly isLoading: boolean;
  readonly hasMore: boolean;

  // CRUD capability
  readonly editable: boolean;
  createEditCommand(event: GridEditCommitEvent): CrudCommand | null;
  createInsertCommand(values: Record<string, unknown>): CrudCommand;
  createDeleteCommand(row: TRow): CrudCommand;
}

/**
 * SQL-specific data source
 */
export interface SqlDataSource extends GridDataSource {
  readonly paradigm: 'sql';
  readonly identifier: Extract<DataSourceIdentifier, { type: 'table' }>;
}

/**
 * Document database-specific data source (MongoDB)
 */
export interface DocumentDataSource extends GridDataSource {
  readonly paradigm: 'document';
  readonly identifier: Extract<DataSourceIdentifier, { type: 'collection' }>;
}

/**
 * Key-Value database-specific data source (Redis)
 */
export interface KeyValueDataSource extends GridDataSource {
  readonly paradigm: 'keyvalue';
  readonly identifier: Extract<DataSourceIdentifier, { type: 'keyspace' }>;
}

/**
 * Type guard to check if source is SQL
 */
export function isSqlDataSource(source: GridDataSource): source is SqlDataSource {
  return source.paradigm === 'sql';
}

/**
 * Type guard to check if source is Document (MongoDB)
 */
export function isDocumentDataSource(source: GridDataSource): source is DocumentDataSource {
  return source.paradigm === 'document';
}

/**
 * Type guard to check if source is KeyValue (Redis)
 */
export function isKeyValueDataSource(source: GridDataSource): source is KeyValueDataSource {
  return source.paradigm === 'keyvalue';
}
