import type { GridCell, Item } from '@glideapps/glide-data-grid';
import type { GridColumnV2, GridRowModel } from '../types';
import type { CrudCommand } from '@/types/crud';
import type { GridEditCommitEvent } from '../types';
import type { RedisType } from '@/adapters/types/redis';

// ============================================================================
// Hook-Based Data Provider Types (Preferred Pattern)
// ============================================================================

/**
 * Base result type for all data hooks
 * Returns data compatible with EditableDataGrid props
 */
export interface BaseDataHookResult {
  // EditableDataGrid-compatible props
  rows: GridRowModel[];
  columns: GridColumnV2[];
  getCellContent: (cell: Item) => GridCell;

  // Loading state
  isLoading: boolean;
  error: Error | null;

  // Pagination
  hasMore: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;

  // CRUD helpers
  createEditCommand: (event: GridEditCommitEvent) => CrudCommand | null;
  createInsertCommand: (values: Record<string, unknown>) => CrudCommand;
  createDeleteCommand: (row: GridRowModel) => CrudCommand;
}

/**
 * SQL data hook result
 */
export interface SqlDataHookResult extends BaseDataHookResult {
  paradigm: 'sql';
  estimatedTotal?: number;
  isEstimatedCount?: boolean;
}

/**
 * Document data hook result (MongoDB)
 * Includes drill-down navigation for nested documents
 */
export interface DocumentDataHookResult extends BaseDataHookResult {
  paradigm: 'document';

  // Path navigation for drill-down
  currentPath: PathSegment[];
  canStepInto: (row: number, col: number) => boolean;
  stepInto: (row: number, col: number) => void;
  stepOut: () => void;
  navigateToPath: (pathIndex: number) => void;
  getCurrentDocumentId: () => string | null;

  // Total count
  totalCount?: number;
}

/**
 * KeyValue data hook result (Redis)
 * Includes key selection and type-aware display
 */
export interface KeyValueDataHookResult extends BaseDataHookResult {
  paradigm: 'keyvalue';

  // Current key info
  currentKey: KeyMetadata | null;
  selectKey: (key: string) => Promise<void>;
  clearSelection: () => void;
  setKeyTTL: (seconds: number) => Promise<void>;
  deleteCurrentKey: () => Promise<void>;
}

// ============================================================================
// Shared Types
// ============================================================================

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
 * Represents a segment in the document navigation path
 */
export interface PathSegment {
  /** The key or index used to navigate */
  key: string | number;
  /** Display label for breadcrumb */
  label: string;
  /** Type of the value at this segment */
  type: 'object' | 'array' | 'document';
}

/**
 * Document database-specific data source (MongoDB)
 * Extends GridDataSource with path navigation for nested documents
 */
export interface DocumentDataSource extends GridDataSource {
  readonly paradigm: 'document';
  readonly identifier: Extract<DataSourceIdentifier, { type: 'collection' }>;

  // Path navigation for nested documents/arrays
  readonly currentPath: PathSegment[];

  /**
   * Check if user can navigate into the cell (is object/array)
   */
  canStepInto(row: number, col: number): boolean;

  /**
   * Navigate into a nested object/array at the given cell
   */
  stepInto(row: number, col: number): void;

  /**
   * Navigate back up one level in the path
   */
  stepOut(): void;

  /**
   * Navigate to a specific path segment (breadcrumb click)
   */
  navigateToPath(pathIndex: number): void;

  /**
   * Get the document ID for the currently focused document
   */
  getCurrentDocumentId(): string | null;
}

/**
 * Metadata about the currently selected Redis key
 */
export interface KeyMetadata {
  key: string;
  type: RedisType;
  ttl: number;
  size?: number;
}

/**
 * Key-Value database-specific data source (Redis)
 * Displays key data with type-aware column mapping
 */
export interface KeyValueDataSource extends GridDataSource {
  readonly paradigm: 'keyvalue';
  readonly identifier: Extract<DataSourceIdentifier, { type: 'keyspace' }>;

  readonly currentKey: KeyMetadata | null;

  selectKey(key: string): Promise<void>;

  clearSelection(): void;

  setKeyTTL(seconds: number): Promise<void>;

  deleteCurrentKey(): Promise<void>;
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
