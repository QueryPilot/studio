/**
 * Table Edit Store Types
 *
 * Complete type system for the centralized table editing store.
 */

import type { CellValue } from "@/types/cellValue";
import type { ColumnMeta } from "@/types/database";
import type { GridRowModel } from "@/components/DataGridV2/types";
import type {
  ChangeRecord,
  ChangeKind,
  DomainKind,
} from "@/utils/changeRecordUtils";

// ============================================================================
// Core Types
// ============================================================================

/**
 * Unique identifier for a table editing scope
 */
export interface EditingScopeKey {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

/**
 * String representation of scope key using safe delimiter
 */
export type ScopeKeyString = string;

/**
 * Metadata about a table editing scope
 */
export interface ScopeMeta {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  displayName: string;
  primaryKey: string[];
  fetchedAt?: number;
  originalColumns?: Record<string, ColumnMeta>;
}

// ============================================================================
// Domain-Specific Types
// ============================================================================

// --- Structure Domain ---

export interface ColumnDraft {
  name: string;
  db_type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  is_fk: boolean;
  check_constraint: string | null;
  foreign_key_ref: ForeignKeyRef | null;
  comment: string | null;
  enum_values?: string[];
  type_category?: string;
  originalName?: string; // For renames
  ordinal?: number;
}

export interface ForeignKeyRef {
  constraint_name?: string;
  table: string;
  column: string;
  onUpdate?: string;
  onDelete?: string;
  schema?: string;
}

export interface StructureDomainState {
  editedColumns: Map<string, ColumnDraft>;
  newColumns: Map<string, ColumnDraft>;
  deletedColumns: Set<string>;
  orderDraft?: string[];
  hasDirtyComment: boolean;
}

// --- Data Domain ---

export interface CellDraft {
  columnId: string;
  originalValue: CellValue | null;
  draftValue: CellValue | null;
  hasChanged: boolean;
}

export interface RowDraft {
  rowKey: string;
  rowIndex: number;
  action: "insert" | "update" | "delete";
  createdAt: number;
  updatedAt: number;
  originalRow: GridRowModel | null;
  draftRow: GridRowModel | null;
  cells: Map<string, CellDraft>;
}

export interface DataDomainState {
  rowDrafts: Map<string, RowDraft>;
  optimisticPrimaryKeySeed: number;
  pendingUploadAttachments: Map<string, FileHandle>;
}

export interface FileHandle {
  name: string;
  size: number;
  type: string;
  path?: string;
}

// --- Index Domain ---

export interface IndexDraft {
  name: string;
  columns: string[];
  unique: boolean;
  type: string; // btree, hash, gin, gist, etc.
  condition?: string; // WHERE clause for partial indexes
  originalName?: string; // For renames
  size?: string;
  is_primary?: boolean;
}

export interface IndexDomainState {
  editedIndexes: Map<string, IndexDraft>;
  newIndexes: Map<string, IndexDraft>;
  deletedIndexes: Set<string>;
}

// --- Trigger Domain ---

export interface TriggerDraft {
  name: string;
  event: string; // INSERT, UPDATE, DELETE (can be OR-separated)
  timing: string; // BEFORE, AFTER, INSTEAD OF
  level: string; // ROW, STATEMENT
  enabled: boolean;
  function: string;
  condition?: string;
  originalName?: string; // For renames
}

export interface TriggerDomainState {
  editedTriggers: Map<string, TriggerDraft>;
  newTriggers: Map<string, TriggerDraft>;
  deletedTriggers: Set<string>;
  nextNameCounter: number;
}

// --- Constraint Domain (Future) ---

export interface ConstraintDraft {
  name: string;
  type: "check" | "foreign_key" | "unique" | "primary_key";
  definition: string;
  originalName?: string;
}

export interface ConstraintDomainState {
  editedConstraints: Map<string, ConstraintDraft>;
  newConstraints: Map<string, ConstraintDraft>;
  deletedConstraints: Set<string>;
}

// ============================================================================
// Summary & Aggregation Types
// ============================================================================

/**
 * Summary of changes in a scope
 */
export interface ScopeSummary {
  totalChanges: number;
  byDomain: Record<DomainKind, number>;
  pendingInserts: number;
  pendingUpdates: number;
  pendingDeletes: number;
  lastTouchedAt: number;
  hasDestructiveChanges: boolean;
}

/**
 * Summary of changes across all scopes in a connection
 */
export interface ConnectionSummary {
  connectionId: string;
  totalChanges: number;
  scopeCount: number;
  byScope: Map<ScopeKeyString, ScopeSummary>;
  lastTouchedAt: number;
}

// ============================================================================
// Undo/Redo Types
// ============================================================================

/**
 * Entry in the undo/redo stack
 */
export interface UndoStackEntry {
  domain: DomainKind;
  changeId: string;
  previousState: any; // Snapshot of state before change
  nextState: any; // Snapshot of state after change
  appliedAt: number;
  description: string;
}

/**
 * Macro operation grouping multiple changes
 */
export interface MacroOperation {
  description: string;
  startedAt: number;
  changes: UndoStackEntry[];
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
  line?: number;
  column?: number;
}

export interface ValidationResult {
  status: "pending" | "passed" | "failed" | "cancelled";
  checkedAt: number;
  diagnostics: ValidationDiagnostic[];
  executionTimeMs?: number;
}

// ============================================================================
// Scope State
// ============================================================================

/**
 * Complete state for a table editing scope
 */
export interface ScopeState {
  meta: ScopeMeta;
  domains: {
    structure: StructureDomainState;
    data: DataDomainState;
    indexes: IndexDomainState;
    triggers: TriggerDomainState;
    constraints: ConstraintDomainState;
  };
  summary: ScopeSummary;
  lastTouchedAt: number;
  undoStack: UndoStackEntry[];
  redoStack: UndoStackEntry[];
  macroOperation?: MacroOperation;
  validation?: ValidationResult;
}

// ============================================================================
// Store State
// ============================================================================

/**
 * Root state of the table edit store
 */
export interface TableEditStoreState {
  scopes: Map<ScopeKeyString, ScopeState>;

  // Core Actions
  ensureScope: (key: EditingScopeKey) => ScopeState;
  setScopeMeta: (key: EditingScopeKey, meta: Partial<ScopeMeta>) => void;

  // Change Operations
  upsertChange: (
    key: EditingScopeKey,
    domain: DomainKind,
    changeRecord: ChangeRecord,
  ) => void;
  removeChange: (
    key: EditingScopeKey,
    domain: DomainKind,
    changeId: string,
  ) => void;

  // Bulk Operations
  discardDomain: (key: EditingScopeKey, domain: DomainKind) => void;
  discardScope: (key: EditingScopeKey) => void;
  discardAll: (connectionId: string) => void;

  // Undo/Redo
  performUndo: (key: EditingScopeKey) => boolean;
  performRedo: (key: EditingScopeKey) => boolean;
  beginMacro: (key: EditingScopeKey, description: string) => void;
  endMacro: (key: EditingScopeKey) => void;
  cancelMacro: (key: EditingScopeKey) => void;

  // Queries
  getScopeSummary: (key: EditingScopeKey) => ScopeSummary | null;
  getConnectionSummary: (connectionId: string) => ConnectionSummary;
  getScopeState: (key: EditingScopeKey) => ScopeState | null;

  // Validation
  setValidationResult: (key: EditingScopeKey, result: ValidationResult) => void;
  clearValidation: (key: EditingScopeKey) => void;
}

// ============================================================================
// Helper Types for Actions
// ============================================================================

export interface UpsertStructureChangeParams {
  columnName: string;
  draft: ColumnDraft;
  action: "edit" | "add" | "delete";
}

export interface UpsertDataChangeParams {
  rowKey: string;
  rowIndex: number;
  action: "insert" | "update" | "delete";
  originalRow?: GridRowModel | null;
  draftRow?: GridRowModel | null;
  cellChanges?: Map<string, CellDraft>;
}

export interface UpsertIndexChangeParams {
  indexName: string;
  draft: IndexDraft;
  action: "edit" | "add" | "delete";
}

export interface UpsertTriggerChangeParams {
  triggerName: string;
  draft: TriggerDraft;
  action: "edit" | "add" | "delete" | "toggle";
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract domain state type by domain kind
 */
export type DomainStateType<T extends DomainKind> = T extends "structure"
  ? StructureDomainState
  : T extends "data"
  ? DataDomainState
  : T extends "indexes"
  ? IndexDomainState
  : T extends "triggers"
  ? TriggerDomainState
  : T extends "constraints"
  ? ConstraintDomainState
  : never;

/**
 * Extract draft type by domain kind
 */
export type DraftType<T extends DomainKind> = T extends "structure"
  ? ColumnDraft
  : T extends "data"
  ? RowDraft
  : T extends "indexes"
  ? IndexDraft
  : T extends "triggers"
  ? TriggerDraft
  : T extends "constraints"
  ? ConstraintDraft
  : never;
