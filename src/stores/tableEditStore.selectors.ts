/**
 * Table Edit Store Selectors & Hooks
 *
 * Fine-grained subscriptions and convenience hooks for React components.
 */

import { useCallback, useMemo } from "react";
import { useTableEditStore, createScopeKey } from "./tableEditStore";
import type {
  EditingScopeKey,
  ScopeState,
  ScopeSummary,
  StructureDomainState,
  DataDomainState,
  IndexDomainState,
  TriggerDomainState,
  ConstraintDomainState,
  ColumnDraft,
  RowDraft,
  IndexDraft,
  TriggerDraft,
  DomainKind,
} from "./tableEditStore.types";
import type { ChangeRecord } from "@/utils/changeRecordUtils";

// ============================================================================
// Core Selector Hook
// ============================================================================

/**
 * Subscribe to a specific slice of a scope's state
 */
export function useTableEditScope<T>(
  scope: EditingScopeKey,
  selector: (state: ScopeState | null) => T,
  equalityFn?: (a: T, b: T) => boolean,
): T {
  const scopeKey = useMemo(() => createScopeKey(scope), [scope]);

  return useTableEditStore(
    useCallback(
      (state) => {
        const scopeState = state.scopes.get(scopeKey);
        return selector(scopeState || null);
      },
      [scopeKey, selector],
    ),
    equalityFn,
  );
}

// ============================================================================
// Domain-Specific Hooks
// ============================================================================

/**
 * Hook for structure domain (columns)
 */
export function useTableEditStructure(scope: EditingScopeKey) {
  const { upsertChange, removeChange, discardDomain } = useTableEditStore();

  const domain = useTableEditScope(
    scope,
    (state) => state?.domains.structure || null,
  );

  const addDraft = useCallback(
    (columnName: string, draft: ColumnDraft) => {
      const changeRecord: ChangeRecord<ColumnDraft, ColumnDraft> = {
        id: columnName,
        domain: "structure",
        kind: "insert",
        draft,
        original: null,
        diffKeys: [],
        touchedAt: Date.now(),
      };

      upsertChange(scope, "structure", changeRecord);
    },
    [scope, upsertChange],
  );

  const updateDraft = useCallback(
    (columnName: string, draft: ColumnDraft, original?: ColumnDraft) => {
      const changeRecord: ChangeRecord<ColumnDraft, ColumnDraft> = {
        id: columnName,
        domain: "structure",
        kind: "update",
        draft,
        original: original || null,
        diffKeys: [], // Computed by caller
        touchedAt: Date.now(),
      };

      upsertChange(scope, "structure", changeRecord);
    },
    [scope, upsertChange],
  );

  const deleteDraft = useCallback(
    (columnName: string) => {
      const changeRecord: ChangeRecord<null, ColumnDraft> = {
        id: columnName,
        domain: "structure",
        kind: "delete",
        draft: null,
        original: null,
        diffKeys: [],
        touchedAt: Date.now(),
      };

      upsertChange(scope, "structure", changeRecord);
    },
    [scope, upsertChange],
  );

  const removeDraft = useCallback(
    (columnName: string) => {
      removeChange(scope, "structure", columnName);
    },
    [scope, removeChange],
  );

  const discardAll = useCallback(() => {
    discardDomain(scope, "structure");
  }, [scope, discardDomain]);

  return {
    editedColumns: domain?.editedColumns || new Map(),
    newColumns: domain?.newColumns || new Map(),
    deletedColumns: domain?.deletedColumns || new Set(),
    orderDraft: domain?.orderDraft,
    hasDirtyComment: domain?.hasDirtyComment || false,
    addDraft,
    updateDraft,
    deleteDraft,
    removeDraft,
    discardAll,
  };
}

/**
 * Hook for data domain (rows)
 */
export function useTableEditData(scope: EditingScopeKey) {
  const { upsertChange, removeChange, discardDomain } = useTableEditStore();

  const domain = useTableEditScope(
    scope,
    (state) => state?.domains.data || null,
  );

  const upsertRowDraft = useCallback(
    (rowKey: string, draft: RowDraft) => {
      const changeRecord: ChangeRecord<RowDraft, RowDraft> = {
        id: rowKey,
        domain: "data",
        kind: draft.action,
        draft,
        original: draft.originalRow ? (draft as any) : null,
        diffKeys: Array.from(draft.cells.keys()),
        touchedAt: Date.now(),
      };

      upsertChange(scope, "data", changeRecord);
    },
    [scope, upsertChange],
  );

  const removeRowDraft = useCallback(
    (rowKey: string) => {
      removeChange(scope, "data", rowKey);
    },
    [scope, removeChange],
  );

  const discardAll = useCallback(() => {
    discardDomain(scope, "data");
  }, [scope, discardDomain]);

  return {
    rowDrafts: domain?.rowDrafts || new Map(),
    optimisticPrimaryKeySeed: domain?.optimisticPrimaryKeySeed || 0,
    pendingUploadAttachments: domain?.pendingUploadAttachments || new Map(),
    upsertRowDraft,
    removeRowDraft,
    discardAll,
  };
}

/**
 * Hook for indexes domain
 */
export function useTableEditIndexes(scope: EditingScopeKey) {
  const { upsertChange, removeChange, discardDomain } = useTableEditStore();

  const domain = useTableEditScope(
    scope,
    (state) => state?.domains.indexes || null,
  );

  const addIndex = useCallback(
    (indexName: string, draft: IndexDraft) => {
      const changeRecord: ChangeRecord<IndexDraft, IndexDraft> = {
        id: indexName,
        domain: "indexes",
        kind: "insert",
        draft,
        original: null,
        diffKeys: [],
        touchedAt: Date.now(),
      };

      upsertChange(scope, "indexes", changeRecord);
    },
    [scope, upsertChange],
  );

  const updateIndex = useCallback(
    (indexName: string, draft: IndexDraft, original?: IndexDraft) => {
      const changeRecord: ChangeRecord<IndexDraft, IndexDraft> = {
        id: indexName,
        domain: "indexes",
        kind: "update",
        draft,
        original: original || null,
        diffKeys: [],
        touchedAt: Date.now(),
      };

      upsertChange(scope, "indexes", changeRecord);
    },
    [scope, upsertChange],
  );

  const deleteIndex = useCallback(
    (indexName: string) => {
      const changeRecord: ChangeRecord<null, IndexDraft> = {
        id: indexName,
        domain: "indexes",
        kind: "delete",
        draft: null,
        original: null,
        diffKeys: [],
        touchedAt: Date.now(),
      };

      upsertChange(scope, "indexes", changeRecord);
    },
    [scope, upsertChange],
  );

  const removeIndex = useCallback(
    (indexName: string) => {
      removeChange(scope, "indexes", indexName);
    },
    [scope, removeChange],
  );

  const discardAll = useCallback(() => {
    discardDomain(scope, "indexes");
  }, [scope, discardDomain]);

  return {
    editedIndexes: domain?.editedIndexes || new Map(),
    newIndexes: domain?.newIndexes || new Map(),
    deletedIndexes: domain?.deletedIndexes || new Set(),
    addIndex,
    updateIndex,
    deleteIndex,
    removeIndex,
    discardAll,
  };
}

/**
 * Hook for triggers domain
 */
export function useTableEditTriggers(scope: EditingScopeKey) {
  const { upsertChange, removeChange, discardDomain } = useTableEditStore();

  const domain = useTableEditScope(
    scope,
    (state) => state?.domains.triggers || null,
  );

  const addTrigger = useCallback(
    (triggerName: string, draft: TriggerDraft) => {
      const changeRecord: ChangeRecord<TriggerDraft, TriggerDraft> = {
        id: triggerName,
        domain: "triggers",
        kind: "insert",
        draft,
        original: null,
        diffKeys: [],
        touchedAt: Date.now(),
      };

      upsertChange(scope, "triggers", changeRecord);
    },
    [scope, upsertChange],
  );

  const updateTrigger = useCallback(
    (triggerName: string, draft: TriggerDraft, original?: TriggerDraft) => {
      const changeRecord: ChangeRecord<TriggerDraft, TriggerDraft> = {
        id: triggerName,
        domain: "triggers",
        kind: "update",
        draft,
        original: original || null,
        diffKeys: [],
        touchedAt: Date.now(),
      };

      upsertChange(scope, "triggers", changeRecord);
    },
    [scope, upsertChange],
  );

  const toggleTrigger = useCallback(
    (triggerName: string, draft: TriggerDraft, original: TriggerDraft) => {
      const changeRecord: ChangeRecord<TriggerDraft, TriggerDraft> = {
        id: triggerName,
        domain: "triggers",
        kind: "toggle",
        draft,
        original,
        diffKeys: ["enabled"],
        touchedAt: Date.now(),
      };

      upsertChange(scope, "triggers", changeRecord);
    },
    [scope, upsertChange],
  );

  const deleteTrigger = useCallback(
    (triggerName: string) => {
      const changeRecord: ChangeRecord<null, TriggerDraft> = {
        id: triggerName,
        domain: "triggers",
        kind: "delete",
        draft: null,
        original: null,
        diffKeys: [],
        touchedAt: Date.now(),
      };

      upsertChange(scope, "triggers", changeRecord);
    },
    [scope, upsertChange],
  );

  const removeTrigger = useCallback(
    (triggerName: string) => {
      removeChange(scope, "triggers", triggerName);
    },
    [scope, removeChange],
  );

  const discardAll = useCallback(() => {
    discardDomain(scope, "triggers");
  }, [scope, discardDomain]);

  return {
    editedTriggers: domain?.editedTriggers || new Map(),
    newTriggers: domain?.newTriggers || new Map(),
    deletedTriggers: domain?.deletedTriggers || new Set(),
    nextNameCounter: domain?.nextNameCounter || 1,
    addTrigger,
    updateTrigger,
    toggleTrigger,
    deleteTrigger,
    removeTrigger,
    discardAll,
  };
}

// ============================================================================
// Summary Hooks
// ============================================================================

/**
 * Hook for scope summary
 */
export function useTableEditSummary(
  scope: EditingScopeKey,
): ScopeSummary | null {
  return useTableEditScope(scope, (state) => state?.summary || null);
}

/**
 * Hook for connection-wide summary
 */
export function useConnectionEditSummary(connectionId: string) {
  const getConnectionSummary = useTableEditStore(
    (state) => state.getConnectionSummary,
  );

  // Subscribe to any scope changes for this connection
  const allScopes = useTableEditStore((state) => state.scopes);

  return useMemo(
    () => getConnectionSummary(connectionId),
    [connectionId, getConnectionSummary, allScopes],
  );
}

/**
 * Hook for pending changes count (for status bar indicator)
 */
export function usePendingChangesCount(connectionId: string): number {
  const summary = useConnectionEditSummary(connectionId);
  return summary.totalChanges;
}

/**
 * Hook to check if scope has pending changes
 */
export function useHasPendingChanges(scope: EditingScopeKey): boolean {
  const summary = useTableEditSummary(scope);
  return summary ? summary.totalChanges > 0 : false;
}

/**
 * Hook to check if scope has destructive changes
 */
export function useHasDestructiveChanges(scope: EditingScopeKey): boolean {
  const summary = useTableEditSummary(scope);
  return summary ? summary.hasDestructiveChanges : false;
}

// ============================================================================
// Undo/Redo Hooks
// ============================================================================

/**
 * Hook for undo/redo actions
 */
export function useTableEditHistory(scope: EditingScopeKey) {
  const { performUndo, performRedo, beginMacro, endMacro, cancelMacro } =
    useTableEditStore();

  const canUndo = useTableEditScope(
    scope,
    (state) => (state?.undoStack.length || 0) > 0,
  );

  const canRedo = useTableEditScope(
    scope,
    (state) => (state?.redoStack.length || 0) > 0,
  );

  const inMacro = useTableEditScope(scope, (state) => !!state?.macroOperation);

  const undo = useCallback(() => {
    performUndo(scope);
  }, [scope, performUndo]);

  const redo = useCallback(() => {
    performRedo(scope);
  }, [scope, performRedo]);

  const startMacro = useCallback(
    (description: string) => {
      beginMacro(scope, description);
    },
    [scope, beginMacro],
  );

  const finishMacro = useCallback(() => {
    endMacro(scope);
  }, [scope, endMacro]);

  const abortMacro = useCallback(() => {
    cancelMacro(scope);
  }, [scope, cancelMacro]);

  return {
    canUndo,
    canRedo,
    inMacro,
    undo,
    redo,
    startMacro,
    finishMacro,
    abortMacro,
  };
}

// ============================================================================
// Validation Hooks
// ============================================================================

/**
 * Hook for validation state
 */
export function useTableEditValidation(scope: EditingScopeKey) {
  const { setValidationResult, clearValidation } = useTableEditStore();

  const validation = useTableEditScope(scope, (state) => state?.validation);

  const setResult = useCallback(
    (result: Parameters<typeof setValidationResult>[1]) => {
      setValidationResult(scope, result);
    },
    [scope, setValidationResult],
  );

  const clear = useCallback(() => {
    clearValidation(scope);
  }, [scope, clearValidation]);

  return {
    validation,
    setResult,
    clear,
    isPending: validation?.status === "pending",
    isPassed: validation?.status === "passed",
    isFailed: validation?.status === "failed",
  };
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to ensure scope exists
 */
export function useEnsureScope(scope: EditingScopeKey) {
  const ensureScope = useTableEditStore((state) => state.ensureScope);

  useMemo(() => {
    ensureScope(scope);
  }, [scope, ensureScope]);
}

/**
 * Hook to get full scope state
 */
export function useFullScopeState(scope: EditingScopeKey): ScopeState | null {
  return useTableEditScope(scope, (state) => state);
}

/**
 * Hook for bulk operations
 */
export function useTableEditBulkOps(scope: EditingScopeKey) {
  const { discardDomain, discardScope } = useTableEditStore();

  const discardStructure = useCallback(() => {
    discardDomain(scope, "structure");
  }, [scope, discardDomain]);

  const discardData = useCallback(() => {
    discardDomain(scope, "data");
  }, [scope, discardDomain]);

  const discardIndexes = useCallback(() => {
    discardDomain(scope, "indexes");
  }, [scope, discardDomain]);

  const discardTriggers = useCallback(() => {
    discardDomain(scope, "triggers");
  }, [scope, discardDomain]);

  const discardAll = useCallback(() => {
    discardScope(scope);
  }, [scope, discardScope]);

  return {
    discardStructure,
    discardData,
    discardIndexes,
    discardTriggers,
    discardAll,
  };
}
