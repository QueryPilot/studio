import type {
  GridColumnV2,
  GridRowModel,
  CrudCommandFactory,
  GridActivationEvent,
  GridCellContentGetter,
} from '../types';
import type { CrudCommand, JsonValue } from '@/types/crud';
import type { GridEditCommitEvent } from '../types';
import type { RedisType } from '@/adapters/types/redis';
import type { DocumentSchemaSample } from '@/adapters/types/mongodb';

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
  getCellContent: GridCellContentGetter;

  // Loading state
  isLoading: boolean;
  isLoadingMore?: boolean;
  error: Error | null;

  // Pagination
  hasMore: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;

  // Query performance metrics
  executionTime?: number;

  // CRUD helpers (legacy - use commandFactory instead)
  createEditCommand: (event: GridEditCommitEvent) => CrudCommand | null;
  createInsertCommand: (values: Record<string, unknown>) => CrudCommand;
  createDeleteCommand: (row: GridRowModel) => CrudCommand;

  /**
   * Command factory for BaseDataGrid CRUD operations.
   * When provided, enables insert/delete row buttons in context menu.
   */
  commandFactory?: CrudCommandFactory;
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
  canStepInto: (event: GridActivationEvent) => boolean;
  stepInto: (event: GridActivationEvent) => void;
  stepOut: () => void;
  navigateToPath: (pathIndex: number) => void;
  getCurrentDocumentId: () => JsonValue | null;

  // Total count
  totalCount?: number;
  schemaSample?: DocumentSchemaSample;
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

  // Pattern filtering (browser mode, key filter via SCAN MATCH)
  pattern: string;
  setPattern: (pattern: string) => void;
  totalKeyCount?: number;
  /** Number of keys loaded from server (before client-side value filter) */
  loadedKeyCount: number;

  // Value search (browser mode, client-side filter on loaded previews)
  valueFilter: string;
  setValueFilter: (filter: string) => void;
  /** Whether all keys have been loaded from server */
  allKeysLoaded: boolean;
  /** Whether to show "Load all keys" button (totalKeyCount >= threshold) */
  showLoadAll: boolean;
  /** Trigger loading all remaining keys */
  loadAllKeys: () => void;
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
