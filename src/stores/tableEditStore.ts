/**
 * Table Edit Store
 *
 * Centralized Zustand store for managing all table editing operations.
 * Supports undo/redo, SQL preview, validation, and cross-component state sharing.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  TableEditStoreState,
  EditingScopeKey,
  ScopeKeyString,
  ScopeState,
  ScopeMeta,
  ScopeSummary,
  ConnectionSummary,
  UndoStackEntry,
  ValidationResult,
  DomainKind,
  StructureDomainState,
  DataDomainState,
  IndexDomainState,
  TriggerDomainState,
  ConstraintDomainState,
} from "./tableEditStore.types";
import type { ChangeRecord } from "@/utils/changeRecordUtils";

// ============================================================================
// Constants
// ============================================================================

const SCOPE_KEY_DELIMITER = "|||";
const MAX_UNDO_STACK_SIZE = 50;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a unique string key for a scope
 */
export function createScopeKey(scope: EditingScopeKey): ScopeKeyString {
  const { connectionId, database, schema, table } = scope;
  return `${connectionId}${SCOPE_KEY_DELIMITER}${database}${SCOPE_KEY_DELIMITER}${schema}${SCOPE_KEY_DELIMITER}${table}`;
}

/**
 * Parse scope key back to EditingScopeKey
 */
export function parseScopeKey(key: ScopeKeyString): EditingScopeKey | null {
  const parts = key.split(SCOPE_KEY_DELIMITER);
  if (parts.length !== 4) return null;

  const [connectionId, database, schema, table] = parts;
  return { connectionId, database, schema, table };
}

/**
 * Create empty scope state
 */
function createEmptyScope(meta: ScopeMeta): ScopeState {
  return {
    meta,
    domains: {
      structure: {
        editedColumns: new Map(),
        newColumns: new Map(),
        deletedColumns: new Set(),
        hasDirtyComment: false,
      },
      data: {
        rowDrafts: new Map(),
        optimisticPrimaryKeySeed: 0,
        pendingUploadAttachments: new Map(),
      },
      indexes: {
        editedIndexes: new Map(),
        newIndexes: new Map(),
        deletedIndexes: new Set(),
      },
      triggers: {
        editedTriggers: new Map(),
        newTriggers: new Map(),
        deletedTriggers: new Set(),
        nextNameCounter: 1,
      },
      constraints: {
        editedConstraints: new Map(),
        newConstraints: new Map(),
        deletedConstraints: new Set(),
      },
    },
    summary: {
      totalChanges: 0,
      byDomain: {
        structure: 0,
        data: 0,
        indexes: 0,
        triggers: 0,
        constraints: 0,
      },
      pendingInserts: 0,
      pendingUpdates: 0,
      pendingDeletes: 0,
      lastTouchedAt: Date.now(),
      hasDestructiveChanges: false,
    },
    lastTouchedAt: Date.now(),
    undoStack: [],
    redoStack: [],
  };
}

/**
 * Compute summary for a scope
 */
function computeScopeSummary(scope: ScopeState): ScopeSummary {
  const summary: ScopeSummary = {
    totalChanges: 0,
    byDomain: {
      structure: 0,
      data: 0,
      indexes: 0,
      triggers: 0,
      constraints: 0,
    },
    pendingInserts: 0,
    pendingUpdates: 0,
    pendingDeletes: 0,
    lastTouchedAt: scope.lastTouchedAt,
    hasDestructiveChanges: false,
  };

  // Structure changes
  summary.byDomain.structure =
    scope.domains.structure.editedColumns.size +
    scope.domains.structure.newColumns.size +
    scope.domains.structure.deletedColumns.size;

  if (scope.domains.structure.deletedColumns.size > 0) {
    summary.hasDestructiveChanges = true;
    summary.pendingDeletes += scope.domains.structure.deletedColumns.size;
  }
  summary.pendingInserts += scope.domains.structure.newColumns.size;
  summary.pendingUpdates += scope.domains.structure.editedColumns.size;

  // Data changes
  summary.byDomain.data = scope.domains.data.rowDrafts.size;

  for (const draft of scope.domains.data.rowDrafts.values()) {
    if (draft.action === "insert") {
      summary.pendingInserts++;
    } else if (draft.action === "update") {
      summary.pendingUpdates++;
    } else if (draft.action === "delete") {
      summary.pendingDeletes++;
      summary.hasDestructiveChanges = true;
    }
  }

  // Index changes
  summary.byDomain.indexes =
    scope.domains.indexes.editedIndexes.size +
    scope.domains.indexes.newIndexes.size +
    scope.domains.indexes.deletedIndexes.size;

  if (scope.domains.indexes.deletedIndexes.size > 0) {
    summary.hasDestructiveChanges = true;
    summary.pendingDeletes += scope.domains.indexes.deletedIndexes.size;
  }
  summary.pendingInserts += scope.domains.indexes.newIndexes.size;
  summary.pendingUpdates += scope.domains.indexes.editedIndexes.size;

  // Trigger changes
  summary.byDomain.triggers =
    scope.domains.triggers.editedTriggers.size +
    scope.domains.triggers.newTriggers.size +
    scope.domains.triggers.deletedTriggers.size;

  if (scope.domains.triggers.deletedTriggers.size > 0) {
    summary.hasDestructiveChanges = true;
    summary.pendingDeletes += scope.domains.triggers.deletedTriggers.size;
  }
  summary.pendingInserts += scope.domains.triggers.newTriggers.size;
  summary.pendingUpdates += scope.domains.triggers.editedTriggers.size;

  // Constraint changes
  summary.byDomain.constraints =
    scope.domains.constraints.editedConstraints.size +
    scope.domains.constraints.newConstraints.size +
    scope.domains.constraints.deletedConstraints.size;

  // Total
  summary.totalChanges =
    summary.byDomain.structure +
    summary.byDomain.data +
    summary.byDomain.indexes +
    summary.byDomain.triggers +
    summary.byDomain.constraints;

  return summary;
}

/**
 * Update scope summary (mutating)
 */
function updateScopeSummary(scope: ScopeState): void {
  scope.summary = computeScopeSummary(scope);
  scope.lastTouchedAt = Date.now();
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useTableEditStore = create<TableEditStoreState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      scopes: new Map(),

      // ========================================================================
      // Core Actions
      // ========================================================================

      ensureScope: (key: EditingScopeKey): ScopeState => {
        const scopeKey = createScopeKey(key);
        const existing = get().scopes.get(scopeKey);

        if (existing) {
          return existing;
        }

        // Create new scope
        const meta: ScopeMeta = {
          connectionId: key.connectionId,
          database: key.database,
          schema: key.schema,
          table: key.table,
          displayName: `${key.schema}.${key.table}`,
          primaryKey: [],
          fetchedAt: Date.now(),
        };

        const newScope = createEmptyScope(meta);

        set((state) => {
          state.scopes.set(scopeKey, newScope);
        });

        return newScope;
      },

      setScopeMeta: (key: EditingScopeKey, meta: Partial<ScopeMeta>): void => {
        set((state) => {
          const scopeKey = createScopeKey(key);
          const scope = state.scopes.get(scopeKey);

          if (!scope) return;

          Object.assign(scope.meta, meta);
        });
      },

      // ========================================================================
      // Change Operations
      // ========================================================================

      upsertChange: (
        key: EditingScopeKey,
        domain: DomainKind,
        changeRecord: ChangeRecord,
      ): void => {
        set((state) => {
          const scopeKey = createScopeKey(key);
          let scope = state.scopes.get(scopeKey);

          if (!scope) {
            // Auto-create scope if it doesn't exist
            const meta: ScopeMeta = {
              connectionId: key.connectionId,
              database: key.database,
              schema: key.schema,
              table: key.table,
              displayName: `${key.schema}.${key.table}`,
              primaryKey: [],
              fetchedAt: Date.now(),
            };
            scope = createEmptyScope(meta);
            state.scopes.set(scopeKey, scope);
          }

          // Apply change based on domain and kind
          switch (domain) {
            case "structure":
              applyStructureChange(scope.domains.structure, changeRecord);
              break;
            case "data":
              applyDataChange(scope.domains.data, changeRecord);
              break;
            case "indexes":
              applyIndexChange(scope.domains.indexes, changeRecord);
              break;
            case "triggers":
              applyTriggerChange(scope.domains.triggers, changeRecord);
              break;
            case "constraints":
              applyConstraintChange(scope.domains.constraints, changeRecord);
              break;
          }

          // Update summary
          updateScopeSummary(scope);

          // Clear redo stack when new change is made
          scope.redoStack = [];

          // Add to undo stack if not in macro
          if (!scope.macroOperation) {
            const undoEntry: UndoStackEntry = {
              domain,
              changeId: changeRecord.id,
              previousState: null, // Will be implemented with proper snapshotting
              nextState: changeRecord,
              appliedAt: Date.now(),
              description: `${changeRecord.kind} ${domain}`,
            };

            scope.undoStack.push(undoEntry);

            // Limit stack size
            if (scope.undoStack.length > MAX_UNDO_STACK_SIZE) {
              scope.undoStack.shift();
            }
          }
        });
      },

      removeChange: (
        key: EditingScopeKey,
        domain: DomainKind,
        changeId: string,
      ): void => {
        set((state) => {
          const scopeKey = createScopeKey(key);
          const scope = state.scopes.get(scopeKey);

          if (!scope) return;

          // Remove change based on domain
          switch (domain) {
            case "structure":
              removeStructureChange(scope.domains.structure, changeId);
              break;
            case "data":
              removeDataChange(scope.domains.data, changeId);
              break;
            case "indexes":
              removeIndexChange(scope.domains.indexes, changeId);
              break;
            case "triggers":
              removeTriggerChange(scope.domains.triggers, changeId);
              break;
            case "constraints":
              removeConstraintChange(scope.domains.constraints, changeId);
              break;
          }

          // Update summary
          updateScopeSummary(scope);

          // Clean up empty scope
          if (scope.summary.totalChanges === 0) {
            state.scopes.delete(scopeKey);
          }
        });
      },

      // ========================================================================
      // Bulk Operations
      // ========================================================================

      discardDomain: (key: EditingScopeKey, domain: DomainKind): void => {
        set((state) => {
          const scopeKey = createScopeKey(key);
          const scope = state.scopes.get(scopeKey);

          if (!scope) return;

          // Clear domain
          switch (domain) {
            case "structure":
              scope.domains.structure.editedColumns.clear();
              scope.domains.structure.newColumns.clear();
              scope.domains.structure.deletedColumns.clear();
              scope.domains.structure.orderDraft = undefined;
              scope.domains.structure.hasDirtyComment = false;
              break;
            case "data":
              scope.domains.data.rowDrafts.clear();
              scope.domains.data.pendingUploadAttachments.clear();
              break;
            case "indexes":
              scope.domains.indexes.editedIndexes.clear();
              scope.domains.indexes.newIndexes.clear();
              scope.domains.indexes.deletedIndexes.clear();
              break;
            case "triggers":
              scope.domains.triggers.editedTriggers.clear();
              scope.domains.triggers.newTriggers.clear();
              scope.domains.triggers.deletedTriggers.clear();
              break;
            case "constraints":
              scope.domains.constraints.editedConstraints.clear();
              scope.domains.constraints.newConstraints.clear();
              scope.domains.constraints.deletedConstraints.clear();
              break;
          }

          // Update summary
          updateScopeSummary(scope);

          // Clean up empty scope
          if (scope.summary.totalChanges === 0) {
            state.scopes.delete(scopeKey);
          }
        });
      },

      discardScope: (key: EditingScopeKey): void => {
        set((state) => {
          const scopeKey = createScopeKey(key);
          state.scopes.delete(scopeKey);
        });
      },

      discardAll: (connectionId: string): void => {
        set((state) => {
          // Remove all scopes for this connection
          const keysToDelete: ScopeKeyString[] = [];

          for (const [scopeKey, scope] of state.scopes) {
            if (scope.meta.connectionId === connectionId) {
              keysToDelete.push(scopeKey);
            }
          }

          for (const key of keysToDelete) {
            state.scopes.delete(key);
          }
        });
      },

      // ========================================================================
      // Undo/Redo (Simplified implementation for now)
      // ========================================================================

      performUndo: (key: EditingScopeKey): boolean => {
        // Simplified - will be fully implemented with proper state snapshots
        console.log("Undo not yet fully implemented");
        return false;
      },

      performRedo: (key: EditingScopeKey): boolean => {
        // Simplified - will be fully implemented with proper state snapshots
        console.log("Redo not yet fully implemented");
        return false;
      },

      beginMacro: (key: EditingScopeKey, description: string): void => {
        set((state) => {
          const scopeKey = createScopeKey(key);
          const scope = state.scopes.get(scopeKey);

          if (!scope) return;

          scope.macroOperation = {
            description,
            startedAt: Date.now(),
            changes: [],
          };
        });
      },

      endMacro: (key: EditingScopeKey): void => {
        set((state) => {
          const scopeKey = createScopeKey(key);
          const scope = state.scopes.get(scopeKey);

          if (!scope || !scope.macroOperation) return;

          // Add macro as single undo entry
          if (scope.macroOperation.changes.length > 0) {
            const undoEntry: UndoStackEntry = {
              domain: "structure", // Placeholder
              changeId: `macro_${Date.now()}`,
              previousState: null,
              nextState: scope.macroOperation,
              appliedAt: Date.now(),
              description: scope.macroOperation.description,
            };

            scope.undoStack.push(undoEntry);

            if (scope.undoStack.length > MAX_UNDO_STACK_SIZE) {
              scope.undoStack.shift();
            }
          }

          scope.macroOperation = undefined;
        });
      },

      cancelMacro: (key: EditingScopeKey): void => {
        set((state) => {
          const scopeKey = createScopeKey(key);
          const scope = state.scopes.get(scopeKey);

          if (!scope) return;

          scope.macroOperation = undefined;
        });
      },

      // ========================================================================
      // Queries
      // ========================================================================

      getScopeSummary: (key: EditingScopeKey): ScopeSummary | null => {
        const scopeKey = createScopeKey(key);
        const scope = get().scopes.get(scopeKey);
        return scope ? scope.summary : null;
      },

      getConnectionSummary: (connectionId: string): ConnectionSummary => {
        const scopes = get().scopes;
        const byScope = new Map<ScopeKeyString, ScopeSummary>();
        let totalChanges = 0;
        let lastTouchedAt = 0;

        for (const [scopeKey, scope] of scopes) {
          if (
            scope.meta.connectionId === connectionId &&
            scope.summary.totalChanges > 0
          ) {
            byScope.set(scopeKey, scope.summary);
            totalChanges += scope.summary.totalChanges;
            lastTouchedAt = Math.max(lastTouchedAt, scope.lastTouchedAt);
          }
        }

        return {
          connectionId,
          totalChanges,
          scopeCount: byScope.size,
          byScope,
          lastTouchedAt,
        };
      },

      getScopeState: (key: EditingScopeKey): ScopeState | null => {
        const scopeKey = createScopeKey(key);
        return get().scopes.get(scopeKey) || null;
      },

      // ========================================================================
      // Validation
      // ========================================================================

      setValidationResult: (
        key: EditingScopeKey,
        result: ValidationResult,
      ): void => {
        set((state) => {
          const scopeKey = createScopeKey(key);
          const scope = state.scopes.get(scopeKey);

          if (!scope) return;

          scope.validation = result;
        });
      },

      clearValidation: (key: EditingScopeKey): void => {
        set((state) => {
          const scopeKey = createScopeKey(key);
          const scope = state.scopes.get(scopeKey);

          if (!scope) return;

          scope.validation = undefined;
        });
      },
    })),
  ),
);

// ============================================================================
// Domain-Specific Change Handlers
// ============================================================================

function applyStructureChange(
  domain: StructureDomainState,
  change: ChangeRecord,
): void {
  // Implementation depends on change.kind and change.draft structure
  // This is a simplified version
  if (change.kind === "insert") {
    domain.newColumns.set(change.id, change.draft);
  } else if (change.kind === "update") {
    domain.editedColumns.set(change.id, change.draft);
  } else if (change.kind === "delete") {
    domain.deletedColumns.add(change.id);
  }
}

function applyDataChange(domain: DataDomainState, change: ChangeRecord): void {
  if (
    change.kind === "insert" ||
    change.kind === "update" ||
    change.kind === "delete"
  ) {
    domain.rowDrafts.set(change.id, change.draft);
  }
}

function applyIndexChange(
  domain: IndexDomainState,
  change: ChangeRecord,
): void {
  if (change.kind === "insert") {
    domain.newIndexes.set(change.id, change.draft);
  } else if (change.kind === "update") {
    domain.editedIndexes.set(change.id, change.draft);
  } else if (change.kind === "delete") {
    domain.deletedIndexes.add(change.id);
  }
}

function applyTriggerChange(
  domain: TriggerDomainState,
  change: ChangeRecord,
): void {
  if (change.kind === "insert") {
    domain.newTriggers.set(change.id, change.draft);
  } else if (change.kind === "update" || change.kind === "toggle") {
    domain.editedTriggers.set(change.id, change.draft);
  } else if (change.kind === "delete") {
    domain.deletedTriggers.add(change.id);
  }
}

function applyConstraintChange(
  domain: ConstraintDomainState,
  change: ChangeRecord,
): void {
  if (change.kind === "insert") {
    domain.newConstraints.set(change.id, change.draft);
  } else if (change.kind === "update") {
    domain.editedConstraints.set(change.id, change.draft);
  } else if (change.kind === "delete") {
    domain.deletedConstraints.add(change.id);
  }
}

// Remove handlers
function removeStructureChange(
  domain: StructureDomainState,
  changeId: string,
): void {
  domain.editedColumns.delete(changeId);
  domain.newColumns.delete(changeId);
  domain.deletedColumns.delete(changeId);
}

function removeDataChange(domain: DataDomainState, changeId: string): void {
  domain.rowDrafts.delete(changeId);
}

function removeIndexChange(domain: IndexDomainState, changeId: string): void {
  domain.editedIndexes.delete(changeId);
  domain.newIndexes.delete(changeId);
  domain.deletedIndexes.delete(changeId);
}

function removeTriggerChange(
  domain: TriggerDomainState,
  changeId: string,
): void {
  domain.editedTriggers.delete(changeId);
  domain.newTriggers.delete(changeId);
  domain.deletedTriggers.delete(changeId);
}

function removeConstraintChange(
  domain: ConstraintDomainState,
  changeId: string,
): void {
  domain.editedConstraints.delete(changeId);
  domain.newConstraints.delete(changeId);
  domain.deletedConstraints.delete(changeId);
}
