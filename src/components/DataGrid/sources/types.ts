import type { GridCell, Item } from '@glideapps/glide-data-grid';
import type { GridColumnV2, GridRowModel } from '../types';
import type { CrudCommand, JsonValue } from '@/types/crud';
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
  getCurrentDocumentId: () => JsonValue | null;

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

  // Browser mode (showing list of keys instead of key contents)
  isBrowserMode?: boolean;

  // Pattern filtering (browser mode)
  pattern: string;
  setPattern: (pattern: string) => void;
  totalKeyCount?: number;
}

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Represents a segment in the document navigation path (MongoDB)
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
 * Metadata about the currently selected Redis key
 */
export interface KeyMetadata {
  key: string;
  type: RedisType;
  ttl: number;
  size?: number;
}
