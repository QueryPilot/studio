import React, {
  memo,
  useCallback,
  useRef,
  useState,
  useMemo,
  useEffect,
  useDeferredValue,
} from "react";
import {
  GridCellKind,
  type GridSelection,
  type Item,
  type GridCell,
  type CustomCell,
  type Rectangle,
  type GridMouseEventArgs,
} from "@glideapps/glide-data-grid";
import { IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand } from "@tabler/icons-react";
import { toast } from "sonner";
import type {
  GridRowModel,
  GridColumnV2,
  GridEditCommitEvent,
  GridActivationEvent,
  GridRowInsertEvent,
  CrudCommandFactory,
  GridCellContentGetter,
} from "../types";
import type { ContextMenuTarget } from "../components/UnifiedContextMenu";
import type { QuickFilterRef } from "../components/QuickFilter";
import type { EditableDataGridRef } from "./EditableDataGrid";

import { EditableDataGrid } from "./EditableDataGrid";
import { DataGridStatusBar } from "../components/DataGridStatusBar";
import { DataGridErrorState } from "../components/DataGridStates";
import { InspectorPanel, type InspectorPanelProps } from "../components/InspectorPanel";
import { QuickFilter } from "../components/QuickFilter";
import { UnifiedContextMenu } from "../components/UnifiedContextMenu";
import { FKPreviewPopover } from "../components/FKPreviewPopover";
import { buildGridCellV2 } from "../utils/cellFactory";
import { cn } from "@/lib/utils";
import { useContextKey, useScopedKeybindings } from "@/hooks/useContextKey";
import { openTableObject } from "@/utils/workbench/openers";
import { quoteIdentifier } from "@/adapters/formatting";
import { dataGridRegistry } from "@/services/dataGridRegistry";
import { contextService } from "@/services/contextService";
import { commandService } from "@/services/commandService";

// Hooks
import { useQuickFilter } from "../hooks/useQuickFilter";
import { useColumnSizing } from "../hooks/useColumnSizing";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useRowPinning } from "../hooks/useRowPinning";
import { useColumnSorting } from "../hooks/useColumnSorting";
import { useClipboardBridge } from "../hooks/useClipboardBridge";
import { useFillOperations } from "../hooks/useFillOperations";
import {
  useStagedChangesIndicator,
  hasStagedCellChange,
} from "../hooks/useStagedChangesIndicator";
import { useCellHoverIcons } from "../hooks/useCellHoverIcons";
import { useOptimisticRows } from "../hooks/useOptimisticRows";
import {
  useGridPreferencesStore,
  useGridPreferencesHydrated,
  upsertGridColumnsState,
} from "../stores";
import { useCrudStore } from "@/stores/crudStore";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";

// Utils
import { createDrawHeader } from "../utils/headerUtils";
import {
  coerceToColumnType,
  detectHeaderRow,
  parsePasteData,
  type ColumnTypeHint,
} from "../utils/pasteUtils";
import { readClipboardText } from "@/lib/clipboard";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  applyClientSideFilter,
  type FilterOptions,
} from "../utils/clientSideFilter";
import { buildIsolatedGridPreferenceSnapshot } from "../utils/gridPreferenceIsolation";

const EMPTY_STAGED_CHANGES = {
  rowChanges: new Map<number, Set<string>>(),
  insertedRows: new Set<number>(),
  deletedRows: new Set<number>(),
  pkToRowIndex: new Map<string, number>(),
};

// Stable empty array to avoid unstable `?? []` references on every render
const EMPTY_PENDING_CHANGES: import("@/types/crud").CrudCommand[] = [];

const SELECTION_SUMMARY_THRESHOLD = 10_000;

// Stable theme objects to avoid allocating new objects per staged cell render
const STAGED_CELL_THEME = {
  bgCell: "rgba(251, 146, 60, 0.15)",
  accentColor: "#fb923c",
  accentLight: "rgba(251, 146, 60, 0.2)",
} as const;

const collectSelectedRowIndexes = (
  selection: GridSelection | undefined,
): Set<number> => {
  const rowsSel = selection?.rows?.toArray() ?? [];
  const selected = new Set<number>(rowsSel);

  const addRectRows = (range: Readonly<Rectangle> | undefined) => {
    if (!range) return;
    const start = Math.max(0, range.y);
    const end = Math.max(start, range.y + range.height);
    for (let i = start; i < end; i += 1) {
      selected.add(i);
    }
  };

  addRectRows(selection?.current?.range);
  (selection?.current?.rangeStack ?? []).forEach(addRectRows);

  return selected;
};

export interface BaseDataGridProps {
  // Core data (from data hooks)
  gridId: string;
  rows: GridRowModel[];
  columns: GridColumnV2[];

  // Loading & errors
  isLoading?: boolean;
  isLoadingMore?: boolean;
  error?: string | null;

  // Pagination
  hasMore?: boolean;
  onLoadMore?: () => void;
  estimatedTotal?: number;
  isEstimatedCount?: boolean;

  /**
   * Command factory for CRUD operations.
   * BaseDataGrid owns all CRUD UI and uses this to create paradigm-specific commands.
   * If not provided, CRUD operations are disabled.
   */
  commandFactory?: CrudCommandFactory;

  /**
   * Callback after a cell edit command is staged (for paradigm-specific post-processing)
   */
  onCellEditCommit?: (event: GridEditCommitEvent) => void;

  // Optional capabilities (paradigm-specific)
  onCellActivated?: (event: GridActivationEvent) => boolean; // MongoDB drill-down
  onCellClicked?: (event: GridActivationEvent) => void;

  // Slots for paradigm-specific UI
  topToolbar?: React.ReactNode; // BreadcrumbNav | KeyHeader | null
  bottomToolbar?: React.ReactNode; // Custom pagination/actions

  /**
   * Actions to render in the toolbar area (e.g., Add Row, Export buttons)
   * Rendered in the top-right of the filter toolbar area
   */
  toolbarActions?: React.ReactNode;

  // Paradigm-specific components (rendered by BaseDataGrid)
  fkPreviewComponent?: React.ReactNode; // SQL only
  hoverIconsDrawCell?: (
    cell: Item,
    ctx: CanvasRenderingContext2D,
    rect: Rectangle,
  ) => void;
  customGetCellContent?: (cell: Item, baseCell: GridCell) => GridCell; // For paradigm-specific overrides
  getCellContent?: GridCellContentGetter; // Complete override of cell content (Document/KeyValue paradigms)

  // Metadata (for context menu, filtering, etc.)
  connectionId: string;
  database?: string;
  schema?: string;
  tableName?: string;
  paradigm: "sql" | "document" | "keyvalue";

  // Entity type for views/materialized views
  entityType?: "table" | "view" | "materialized_view";
  readOnlyReason?: string;
  onRefreshMaterializedView?: () => void;
  isRefreshingMatView?: boolean;

  // Feature toggles
  enableFiltering?: boolean;
  enableSorting?: boolean;
  enableExport?: boolean;
  enableRowPinning?: boolean;
  enableColumnManagement?: boolean;
  enableClipboard?: boolean;
  enableFillOperations?: boolean;
  enableStagedChanges?: boolean;
  enableInspector?: boolean;
  enableHoverCellIcons?: boolean;
  showInspectorToggleButton?: boolean;
  inspectorDefaultOpen?: boolean;
  inspectorOpen?: boolean;
  onInspectorOpenChange?: (open: boolean) => void;
  renderInspectorPanel?: (props: InspectorPanelProps) => React.ReactNode;

  /** Minimum rendered rows before infinite load trigger can fire */
  loadMoreMinRows?: number;
  readOnly?: boolean;

  // Styling
  className?: string;

  // Dialect for SQL filtering
  dialect?: string;

  // FK data (for context menu embed feature)
  referencedTableColumns?: Record<
    string,
    Array<{ name: string; db_type: string }>
  >;
  databaseType?: string;

  /**
   * Callback to refetch data after invalidation (provided by adapter)
   * Used by data invalidation subscription to refresh data after CRUD commits
   */
  onRefetch?: () => void;

  /**
   * Callback to attempt reconnection after connection error
   * If provided, shows a Reconnect button in error state
   */
  onReconnect?: () => Promise<void>;

  // --- Query Performance Metrics ---
  /**
   * Total query execution time in milliseconds
   */
  executionTime?: number;

  /**
   * Network/database round-trip time in milliseconds
   */
  networkMs?: number;

  /**
   * Data conversion/serialization time in milliseconds
   */
  conversionMs?: number;

  /**
   * Number of fetch batches for streaming queries
   */
  fetchCount?: number;

  /**
   * Cursor setup time in milliseconds (streaming queries)
   */
  cursorSetupMs?: number;

  /**
   * Total streaming time in milliseconds
   */
  totalStreamingMs?: number;

  /**
   * Whether this grid's panel is focused.
   * When true and autoFocus is enabled, the grid will focus itself.
   */
  focused?: boolean;

  /**
   * Auto-focus the grid when it mounts or when `focused` becomes true.
   * Defaults to true.
   */
  autoFocus?: boolean;

  /**
   * External QuickFilter ref for Cmd+F handling.
   * Use this when the parent component renders its own QuickFilter
   * (e.g., SqlDataGrid with enableFiltering={false}).
   */
  externalQuickFilterRef?: React.RefObject<QuickFilterRef | null>;

  /** Override grid ID used for persisted grid preferences (sort/filter/columns/pinning).
   *  Useful for per-tab isolation when sync is disabled. */
  sortGridId?: string;
}

export const BaseDataGrid = memo(function BaseDataGrid(
  props: BaseDataGridProps,
) {
  const {
    gridId,
    rows,
    columns,
    connectionId,
    database,
    schema,
    tableName,
    paradigm,
    dialect,
    enableFiltering = true,
    enableSorting = true,
    enableExport: _enableExport = true,
    enableRowPinning = true,
    enableColumnManagement = true,
    enableClipboard = true,
    enableFillOperations = true,
    enableStagedChanges = true,
    enableInspector = true,
    enableHoverCellIcons = true,
    showInspectorToggleButton = true,
    inspectorDefaultOpen = false,
    inspectorOpen,
    onInspectorOpenChange,
    readOnly = false,
    // Command factory for CRUD
    commandFactory,
    onCellEditCommit: onCellEditCommitCallback,
    // Entity type
    entityType: _entityType,
    readOnlyReason,
    onRefreshMaterializedView,
    isRefreshingMatView,
    // Paradigm-specific
    onCellActivated,
    onCellClicked,
    topToolbar,
    bottomToolbar,
    toolbarActions,
    fkPreviewComponent,
    hoverIconsDrawCell,
    customGetCellContent,
    renderInspectorPanel,
    className,
    // FK data
    referencedTableColumns,
    databaseType,
    // Data invalidation
    onRefetch,
    // Error handling
    error,
    onReconnect,
    // Focus management
    focused,
    autoFocus = true,
    // External QuickFilter ref (for parent-managed QuickFilter)
    externalQuickFilterRef,
    loadMoreMinRows = 100,
    // Per-tab sort isolation
    sortGridId,
  } = props;
  const preferenceGridId = sortGridId ?? gridId;

  // --- CRUD Store Integration ---
  // Use scoped selectors to avoid re-renders from changes in other tabs.
  // Functions are stable references and safe to select individually.
  const stageCommand = useCrudStore((s) => s.stageCommand);
  const stageBatchWithSingleHistoryEntry = useCrudStore((s) => s.stageBatchWithSingleHistoryEntry);
  const getTableKey = useCrudStore((s) => s.getTableKey);
  const tableKey = commandFactory
    ? getTableKey({
        connectionId: commandFactory.connectionId,
        database: commandFactory.database ?? "",
        schema: commandFactory.schema,
        table: commandFactory.table,
      })
    : "";
  // Scope to this table's commands only — edits in other tabs won't trigger re-renders.
  const pendingChanges = useCrudStore((s) => s.stagedCommands.get(tableKey)) ?? EMPTY_PENDING_CHANGES;

  // --- Data Invalidation Subscription ---
  // When data is invalidated (e.g., after CRUD commit), refetch data and clear committed changes
  useEffect(() => {
    if (!commandFactory) return;

    const unsubscribe = useDataInvalidationStore
      .getState()
      .subscribe(
        commandFactory.connectionId,
        commandFactory.database ?? "",
        commandFactory.schema,
        commandFactory.table,
        async () => {
          // Refetch data from the adapter
          onRefetch?.();
          // Clear committed changes since data is now fresh
          const { clearCommittedChanges, getTableKey: getKey } =
            useCrudStore.getState();
          const key = getKey({
            connectionId: commandFactory.connectionId,
            database: commandFactory.database ?? "",
            schema: commandFactory.schema,
            table: commandFactory.table,
          });
          clearCommittedChanges(key);
        },
      );

    return unsubscribe;
  }, [commandFactory, onRefetch]);

  // --- Refs ---
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<EditableDataGridRef>(null);
  const quickFilterRef = useRef<QuickFilterRef>(null);
  const scrollDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const loadingMoreRef = useRef(false); // Ref-based guard to prevent duplicate fetches
  const inspectorPanelRef = useRef<ImperativePanelHandle>(null);
  // Use external ref if provided (parent-managed QuickFilter), otherwise use internal ref
  const effectiveQuickFilterRef = externalQuickFilterRef ?? quickFilterRef;

  // Ref-based focus tracking for synchronous checks in keyboard handlers
  // This is critical for multi-panel scenarios where state updates are async
  const isGridFocusedRef = useRef(false);
  // Prevent repeated auto-focus attempts while the same panel focus state is active
  const hasAutoFocusedRef = useRef(false);
  const lastPointerInteractionAtRef = useRef(0);

  // Store refs for callbacks
  const onCellEditCommitRef = useRef(onCellEditCommitCallback);
  const commandFactoryRef = useRef(commandFactory);

  // --- State ---
  const [isGridFocused, setIsGridFocused] = useState(false);
  const [isEditingCell, setIsEditingCell] = useState(false);
  const isEditingCellRef = useRef(false);

  useEffect(() => {
    onCellEditCommitRef.current = onCellEditCommitCallback;
    commandFactoryRef.current = commandFactory;
  });

  useEffect(() => {
    hasAutoFocusedRef.current = false;
  }, [gridId]);

  useEffect(() => {
    if (!focused) {
      hasAutoFocusedRef.current = false;
    }
  }, [focused]);

  useEffect(() => {
    const markPointerInteraction = () => {
      lastPointerInteractionAtRef.current = Date.now();
    };

    document.addEventListener("pointerdown", markPointerInteraction, true);
    document.addEventListener("mousedown", markPointerInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", markPointerInteraction, true);
      document.removeEventListener("mousedown", markPointerInteraction, true);
    };
  }, []);

  // --- Auto-focus when panel becomes focused ---
  // This handles the case where a tab is opened from CommandPalette
  // and the grid should receive focus to enable keyboard navigation
  useEffect(() => {
    if (!focused || !autoFocus || hasAutoFocusedRef.current) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 24;
    const RETRY_INTERVAL_MS = 16;
    const INITIAL_DELAY_MS = 60;
    const POINTER_INTERACTION_GRACE_MS = 250;

    const hasRecentPointerInteraction = () =>
      Date.now() - lastPointerInteractionAtRef.current <
      POINTER_INTERACTION_GRACE_MS;

    const shouldAbortForCurrentFocusTarget = () => {
      if (effectiveQuickFilterRef.current?.isFocusWithin?.()) {
        return true;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      if (!activeElement) return false;

      const activeElementIsTextInput =
        activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.isContentEditable;
      const activeElementInsideGrid = Boolean(
        wrapperRef.current?.contains(activeElement),
      );

      if (activeElementIsTextInput && activeElementInsideGrid) {
        return true;
      }

      return false;
    };

    const scheduleRetry = () => {
      attempts += 1;
      if (attempts < MAX_ATTEMPTS) {
        timeoutId = setTimeout(tryFocusGrid, RETRY_INTERVAL_MS);
      }
    };

    const tryFocusGrid = () => {
      if (cancelled || hasAutoFocusedRef.current) return;

      // Respect user pointer interactions so clicked controls can take focus first.
      if (shouldAbortForCurrentFocusTarget()) {
        return;
      }

      if (hasRecentPointerInteraction()) {
        scheduleRetry();
        return;
      }

      // Retry while grid ref is not mounted yet (common during async column/data setup).
      if (!gridRef.current) {
        scheduleRetry();
        return;
      }

      // Re-check right before focus to avoid stealing focus from newly-focused editors.
      if (shouldAbortForCurrentFocusTarget()) {
        return;
      }

      if (hasRecentPointerInteraction()) {
        scheduleRetry();
        return;
      }

      gridRef.current.focus();
      isGridFocusedRef.current = true;
      setIsGridFocused(true);
      hasAutoFocusedRef.current = true;
    };

    timeoutId = setTimeout(tryFocusGrid, INITIAL_DELAY_MS);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
    // rows.length intentionally excluded — during streaming, every batch changes
    // row count which would re-trigger this effect needlessly. The internal retry
    // logic (MAX_ATTEMPTS) handles the case where gridRef isn't mounted yet.
  }, [focused, autoFocus, effectiveQuickFilterRef, columns.length]);

  // Scoped keybindings for this grid instance
  const scopeId = useScopedKeybindings(gridId);

  // Track focus state for context keys
  useContextKey("dataGridFocus", isGridFocused, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("dataGridEditable", !readOnly, {
    scopeId,
    resetOnUnmount: true,
  });
  useContextKey("editingCell", isEditingCell, {
    scopeId,
    resetOnUnmount: true,
  });
  const [uncontrolledInspectorOpen, setUncontrolledInspectorOpen] =
    useState(inspectorDefaultOpen);
  const showInspector = inspectorOpen ?? uncontrolledInspectorOpen;
  const setInspectorOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: boolean) => boolean)(showInspector)
          : next;

      if (inspectorOpen === undefined) {
        setUncontrolledInspectorOpen(resolved);
      }
      onInspectorOpenChange?.(resolved);
    },
    [inspectorOpen, onInspectorOpenChange, showInspector],
  );
  const [inspectorSelectedRow, setInspectorSelectedRow] =
    useState<GridRowModel | null>(null);
  const [inspectorBaselineRow, setInspectorBaselineRow] =
    useState<GridRowModel | null>(null);

  // Programmatically collapse/expand inspector panel without unmounting grid
  useEffect(() => {
    const panel = inspectorPanelRef.current;
    if (!panel) return;
    try {
      if (showInspector) {
        if (panel.isCollapsed()) panel.resize(28);
      } else {
        if (!panel.isCollapsed()) panel.collapse();
      }
    } catch {
      // Panel may not be sized yet (e.g., in tests without layout)
    }
  }, [showInspector]);

  // Grid selection - managed internally
  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(
    undefined,
  );
  const hasSelection = useMemo(() => {
    const selection = gridSelection?.current;
    const hasRowSelection = (gridSelection?.rows?.length ?? 0) > 0;
    const hasColumnSelection =
      (gridSelection?.columns?.length ?? 0) > 0;

    if (hasRowSelection || hasColumnSelection) {
      return true;
    }

    if (!selection) return false;
    if (
      selection.range &&
      selection.range.width > 0 &&
      selection.range.height > 0
    ) {
      return true;
    }
    if (selection.cell) {
      return true;
    }
    return false;
  }, [gridSelection]);

  const gridSelectionRef = useRef<GridSelection | undefined>(undefined);
  const contextMenuTargetRef = useRef<ContextMenuTarget | null>(null);

  useContextKey("selectionEmpty", !hasSelection, {
    scopeId,
    resetOnUnmount: true,
  });

  // --- Column State from Store ---
  const preferences = useGridPreferencesStore(
    (s) => s.preferences[preferenceGridId],
  );
  const sharedPreferences = useGridPreferencesStore(
    useCallback(
      (s) =>
        preferenceGridId !== gridId ? s.preferences[gridId] : undefined,
      [preferenceGridId, gridId],
    ),
  );
  const hydrated = useGridPreferencesHydrated();

  const wasIsolatedRef = useRef(preferenceGridId !== gridId);

  // Seed isolated preferences from the shared key when sync is toggled OFF,
  // so users keep the current grid state as a starting point.
  useEffect(() => {
    const isIsolated = preferenceGridId !== gridId;
    const switchedToIsolated = isIsolated && !wasIsolatedRef.current;
    wasIsolatedRef.current = isIsolated;

    if (!hydrated || !isIsolated || !sharedPreferences) return;
    if (!switchedToIsolated && preferences) return;

    const snapshot = buildIsolatedGridPreferenceSnapshot(sharedPreferences);
    if (!snapshot) return;

    useGridPreferencesStore.getState().upsert(preferenceGridId, (draft) => {
      draft.columns = snapshot.columns;
      draft.pinnedRows = snapshot.pinnedRows;
      draft.sortColumns = snapshot.sortColumns;
      draft.quickFilter = snapshot.quickFilter;
      draft.structureSearch = snapshot.structureSearch;
    });
  }, [
    preferenceGridId,
    gridId,
    hydrated,
    sharedPreferences,
    preferences,
  ]);

  const columnState = preferences?.columns ?? {
    order: [],
    widths: {},
    visibility: {},
    pinned: [],
  };

  // --- Filter Columns ---
  // Convert GridColumnV2 to FilterColumnInfo for filter hooks
  const filterColumns = useMemo(() => {
    return columns
      .filter(
        (col) =>
          !["_rowIndex", "_rowSelection"].includes(col.id) &&
          col.meta?.db_type !== "BYTEA" &&
          col.meta?.db_type !== "bytea" &&
          col.meta?.db_type !== "BLOB" &&
          col.meta?.db_type !== "blob",
      )
      .map((col) => ({
        name: col.name,
        dataType: col.meta?.db_type ?? col.type ?? "text",
        nullable: col.meta?.nullable,
        enumValues: col.meta?.enum_values,
        isPrimaryKey: col.meta?.is_pk,
        isForeignKey: col.meta?.is_fk,
      }));
  }, [columns]);

  // --- Quick Filter ---
  const {
    value: quickFilterValue,
    mode: quickFilterMode,
    error: quickFilterError,
    aiExplanation,
    activeFilter,
    setValue: setQuickFilterValue,
    setMode: setQuickFilterMode,
    submit: handleFilterSubmit,
    clear: _clearFilter,
  } = useQuickFilter({
    columns: filterColumns,
    initialFilter: undefined,
    generateAIFilter: undefined,
    clientSideFiltering: true,
    gridId: preferenceGridId,
  });

  // --- Helper: Check if a cell editor is currently active ---
  // This checks the DOM directly since blur events may not fire correctly with portals
  const isCellEditorActive = useCallback(() => {
    // Check if focus is inside a cell editor overlay
    const activeElement = document.activeElement;
    if (activeElement) {
      const editorShell = activeElement.closest(
        ".gdg-editor-shell, .click-outside-ignore",
      );
      if (editorShell) return true;
    }
    // Also check if the active element is an input/textarea inside the grid context
    // This catches cases where the editor is open but focus tracking didn't update
    if (
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA")
    ) {
      // Check if this input is part of a data grid editor (not QuickFilter or other UI)
      const isInGridEditor = activeElement.closest(
        '.gdg-style, [data-slot="grid-editor"]',
      );
      if (isInGridEditor) return true;
    }
    return false;
  }, []);

  // --- Focus/Blur Handlers ---
  // Use capture phase to track focus state synchronously via ref
  // This ensures keyboard handlers always have accurate focus state
  const handleFocusCapture = useCallback(() => {
    // Keep the focused grid scope last so scoped keybindings/context resolve to this grid.
    contextService.enterScope(scopeId);
    contextService.setValue("dataGridFocus", true, scopeId);
    isGridFocusedRef.current = true;
    setIsGridFocused(true);
    dataGridRegistry.setFocused(gridId);
  }, [gridId, scopeId]);

  const handleBlurCapture = useCallback((e: React.FocusEvent) => {
    const currentTarget = e.currentTarget as HTMLElement;
    // Check synchronously first using relatedTarget (the element receiving focus)
    const relatedTarget = e.relatedTarget as HTMLElement | null;

    // If focus is moving to another element within this grid, don't blur
    if (relatedTarget && currentTarget.contains(relatedTarget)) {
      return;
    }

    // Also check wrapperRef since containerRef is nested inside it
    if (relatedTarget && wrapperRef.current?.contains(relatedTarget)) {
      return;
    }

    // Check if focus is moving to a cell editor overlay (renders in a portal outside the grid)
    // Cell editors have the class 'gdg-editor-shell' or 'click-outside-ignore'
    if (relatedTarget) {
      const editorShell = relatedTarget.closest(
        ".gdg-editor-shell, .click-outside-ignore",
      );
      if (editorShell) {
        // Focus is moving to cell editor - keep editing state
        return;
      }
    }

    // Focus is leaving the grid - update synchronously
    contextService.setValue("dataGridFocus", false, scopeId);
    isGridFocusedRef.current = false;
    setIsGridFocused(false);
    setIsEditingCell(false);
    isEditingCellRef.current = false;
    dataGridRegistry.clearFocused(gridId);
  }, [gridId, scopeId]);

  // --- Column Management ---
  const reorderColumns = useCallback(
    (cols: GridColumnV2[], order: string[]): GridColumnV2[] => {
      if (!order || order.length === 0) return cols;
      const orderMap = new Map(order.map((id, index) => [id, index]));
      return [...cols].sort((a, b) => {
        const aIdx = orderMap.get(a.id) ?? 9999;
        const bIdx = orderMap.get(b.id) ?? 9999;
        return aIdx - bIdx;
      });
    },
    [],
  );

  const baseColumns = useMemo(() => columns, [columns]);

  // Initialize column order and visibility on first load
  useEffect(() => {
    if (!hydrated || !enableColumnManagement || baseColumns.length === 0)
      return;

    const expectedOrder = baseColumns.map((column) => column.id);
    const isInitialLoad = columnState.order.length === 0;

    if (isInitialLoad) {
      upsertGridColumnsState(preferenceGridId, (draft) => {
        draft.order = expectedOrder;
        expectedOrder.forEach((id) => {
          if (!id) return;
          draft.visibility[id] = true;
        });
      });
    }
  }, [
    baseColumns,
    columnState.order.length,
    preferenceGridId,
    hydrated,
    enableColumnManagement,
  ]);

  const reorderedColumns = useMemo(
    () => reorderColumns(baseColumns, columnState.order),
    [baseColumns, columnState.order, reorderColumns],
  );

  // Memoized persistence callbacks to prevent infinite loops
  const handleColumnVisibilityChange = useCallback(
    (visibility: Record<string, boolean>) => {
      if (!hydrated || !enableColumnManagement) return;
      upsertGridColumnsState(preferenceGridId, (draft) => {
        draft.visibility = visibility;
      });
    },
    [preferenceGridId, hydrated, enableColumnManagement],
  );

  const {
    sizedColumns: _sizedColumns,
    columnWidths,
    handleColumnResize,
    handleColumnResizeEnd,
    isDragging: _isResizingColumns,
  } = useColumnSizing({
    columns: reorderedColumns,
    initialWidths: columnState.widths,
    // Don't persist during resize - only on resize end for better performance
    onChange: undefined,
  });

  // Batch width persistence - only persist on resize end, not during drag
  const flushWidths = useCallback(
    (widths: Record<string, number>) => {
      if (!hydrated || !enableColumnManagement) return;
      const state = useGridPreferencesStore.getState();
      const current = state.preferences[preferenceGridId]?.columns?.widths ?? {};
      const changed = Object.keys(widths).some(
        (key) => current[key] !== widths[key],
      );
      if (changed) {
        // Use requestIdleCallback to defer persistence until browser is idle
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(() => {
            upsertGridColumnsState(preferenceGridId, (draft) => {
              draft.widths = widths;
            });
          });
        } else {
          // Fallback for browsers without requestIdleCallback
          setTimeout(() => {
            upsertGridColumnsState(preferenceGridId, (draft) => {
              draft.widths = widths;
            });
          }, 0);
        }
      }
    },
    [preferenceGridId, hydrated, enableColumnManagement],
  );

  const { visibleColumns } = useColumnVisibility({
    columns: reorderedColumns,
    initialHidden: Object.entries(columnState.visibility)
      .filter(([, visible]) => !visible)
      .map(([id]) => id),
    onChange: enableColumnManagement ? handleColumnVisibilityChange : undefined,
  });

  const filterVisibleColumns = useCallback(
    (
      cols: GridColumnV2[],
      visibilityMap: Record<string, boolean>,
    ): GridColumnV2[] => {
      return cols.filter((col) => visibilityMap[col.id] !== false);
    },
    [],
  );

  const applyPinnedOrdering = useCallback(
    (
      cols: GridColumnV2[],
      pinnedIds: string[],
    ): { columns: GridColumnV2[]; freezeColumns: number } => {
      if (!pinnedIds || pinnedIds.length === 0) {
        return { columns: cols, freezeColumns: 0 };
      }
      const pinnedSet = new Set(pinnedIds);
      const pinned = cols.filter((col) => pinnedSet.has(col.id));
      const unpinned = cols.filter((col) => !pinnedSet.has(col.id));
      return {
        columns: [...pinned, ...unpinned],
        freezeColumns: pinned.length,
      };
    },
    [],
  );

  const { columns: computedColumns, freezeColumns } = useMemo(() => {
    const filtered = filterVisibleColumns(
      visibleColumns,
      columnState.visibility,
    );
    return applyPinnedOrdering(filtered, columnState.pinned);
  }, [
    columnState.pinned,
    columnState.visibility,
    visibleColumns,
    filterVisibleColumns,
    applyPinnedOrdering,
  ]);

  // Keep stable columns during transitions to prevent flashing
  const columnsRef = useRef(computedColumns);
  if (computedColumns.length > 0) {
    columnsRef.current = computedColumns;
  }
  const stableComputedColumns =
    computedColumns.length > 0 ? computedColumns : columnsRef.current;

  // Apply widths at the END - cache column objects to avoid recreating unchanged ones
  const finalColumnsCache = useRef<Map<string, GridColumnV2>>(new Map());

  const finalColumns = useMemo(() => {
    if (!enableColumnManagement) return columns;

    const cache = finalColumnsCache.current;
    const result = stableComputedColumns.map((column) => {
      const width = columnWidths[column.id] ?? column.width;
      const cached = cache.get(column.id);

      // Reuse cached if width unchanged - this prevents object churn
      if (cached && cached.width === width && cached.id === column.id) {
        return cached;
      }

      const withWidth = width !== column.width ? { ...column, width } : column;
      cache.set(column.id, withWidth);
      return withWidth;
    });

    return result;
  }, [enableColumnManagement, columns, stableComputedColumns, columnWidths]);

  const finalColumnsRef = useRef(finalColumns);
  // Update synchronously during render (not in useEffect) to avoid delay
  finalColumnsRef.current = finalColumns;

  // --- Column Index Mapping for Custom getCellContent ---
  // Maps visual column index (after reordering) to original column index (in props.columns)
  // This is needed because custom getCellContent from adapters uses their local columns array
  // which is in the original order, but Glide Data Grid calls with the visual index
  const visualToOriginalColIndexRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    const map = new Map<number, number>();
    if (
      enableColumnManagement &&
      columns.length > 0 &&
      finalColumns.length > 0
    ) {
      // Build a lookup from column.id to original index
      const idToOriginalIndex = new Map<string, number>();
      columns.forEach((col, idx) => {
        idToOriginalIndex.set(col.id, idx);
      });
      // Map each visual index to its original index
      finalColumns.forEach((col, visualIdx) => {
        const originalIdx = idToOriginalIndex.get(col.id);
        if (originalIdx !== undefined) {
          map.set(visualIdx, originalIdx);
        }
      });
    }
    visualToOriginalColIndexRef.current = map;
  }, [enableColumnManagement, columns, finalColumns]);

  // --- Row Pinning ---
  const rowKeyPkColumns = useMemo(
    () => columns.filter((col) => col.meta?.is_pk),
    [columns],
  );
  const getRowKey = useCallback(
    (row: GridRowModel | undefined, index: number): string => {
      if (!row) return `row-${index}`;
      if (rowKeyPkColumns.length === 0) return `row-${index}`;
      const pkParts: string[] = [];
      for (const pkCol of rowKeyPkColumns) {
        const cellValue = row[pkCol.field];
        const value =
          cellValue && typeof cellValue === "object" && "value" in cellValue
            ? cellValue.value
            : cellValue;
        pkParts.push(value != null ? String(value) : "null");
      }
      return `pk-${pkParts.join("-")}`;
    },
    [rowKeyPkColumns],
  );

  // --- Column Sorting (must be before sortedRows) ---
  const {
    sortColumns,
    getSortIndex,
    getSortDirection,
    toggleSort,
    sortedData,
  } = useColumnSorting({
    gridId: preferenceGridId,
    columns: finalColumns,
  });

  // Apply sorting to rows BEFORE pinning (so unpinned rows are sorted)
  const sortedRows = useMemo(() => {
    if (!enableSorting || sortColumns.length === 0) return rows;
    return sortedData(rows);
  }, [enableSorting, sortColumns.length, rows, sortedData]);

  // --- Client-side Filtering ---
  // Apply filter to sorted rows (for query results mode)
  // Use useDeferredValue to keep UI responsive during filtering
  const deferredFilter = useDeferredValue(activeFilter);

  const filteredRows = useMemo(() => {
    if (!enableFiltering || !deferredFilter) {
      return sortedRows;
    }

    // Build column name to field key map (columns use col_0, col_1, etc.)
    const columnKeyMap = new Map<string, string>();
    columns.forEach((col, index) => {
      if (col.name) {
        columnKeyMap.set(col.name, `col_${index}`);
      }
    });

    const columnNames = columns.map((c) => c.name).filter(Boolean);
    const filterOptions: FilterOptions = {
      columnKeyMap,
      wrappedValues: true, // Query mode wraps values in {value: ...} objects
    };

    return applyClientSideFilter(
      sortedRows,
      deferredFilter,
      columnNames,
      filterOptions,
    );
  }, [enableFiltering, deferredFilter, sortedRows, columns]);

  const handlePinnedRowsChange = useCallback(
    (ids: string[]) => {
      if (!hydrated || !enableRowPinning) return;
      useGridPreferencesStore.getState().updatePinnedRows(
        preferenceGridId,
        () => ids,
      );
    },
    [preferenceGridId, hydrated, enableRowPinning],
  );

  const { pinnedRows, unpinnedRows, pinnedRowIds, pinRow, unpinRow } =
    useRowPinning({
      rows: filteredRows, // Use filtered rows as input
      initialPinned: enableRowPinning ? (preferences?.pinnedRows ?? []) : [],
      maxPinnedRows: 5,
      getRowId: getRowKey,
      onChange: enableRowPinning ? handlePinnedRowsChange : undefined,
    });

  const displayRows = useMemo(() => {
    if (!enableRowPinning) return filteredRows;
    return [...pinnedRows, ...unpinnedRows];
  }, [enableRowPinning, filteredRows, pinnedRows, unpinnedRows]);

  // --- Optimistic Updates ---
  // Apply staged changes to display rows for immediate visual feedback
  const displayRowsWithOptimistic = useOptimisticRows({
    displayRows,
    stagedCommands: pendingChanges,
    primaryKeyColumns: commandFactory?.primaryKeyColumns ?? [],
    columnNameToFieldMap: commandFactory?.columnNameToFieldMap ?? new Map(),
    columnByFieldMap: commandFactory?.columnByFieldMap ?? new Map(),
    columns,
    getRowKey: commandFactory?.getRowKey ?? getRowKey,
  });

  const activeRows = enableStagedChanges && commandFactory
    ? displayRowsWithOptimistic
    : displayRows;
  // useDeferredValue helps keep the UI responsive when optimistic rows change
  // during CRUD editing. For read-only grids (query results), skip the deferral
  // — streaming throttle already handles frame pacing, and deferral adds latency.
  const deferredActiveRows = useDeferredValue(activeRows);
  const effectiveDisplayRows = (enableStagedChanges && commandFactory)
    ? deferredActiveRows
    : activeRows;
  const rowsRef = useRef(effectiveDisplayRows);
  // Update synchronously during render (not in useEffect) to avoid delay
  rowsRef.current = effectiveDisplayRows;

  // --- Infinite Loading ---
  // Update ref when isLoadingMore changes
  useEffect(() => {
    loadingMoreRef.current = props.isLoadingMore ?? false;
  }, [props.isLoadingMore]);

  const handleVisibleRegionChanged = useCallback(
    (region: Rectangle) => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
      scrollDebounceRef.current = setTimeout(() => {
        // Scroll position persistence could be added here if needed
      }, 150);

      // Trigger loading when within 20 rows of the end (or immediately if fewer rows)
      const threshold = Math.max(0, rowsRef.current.length - 20);
      const nearEnd = region.y + region.height >= threshold;
      const hasFirstPage = rowsRef.current.length >= loadMoreMinRows;

      // Use both state and ref guards to prevent duplicate fetches
      if (
        nearEnd &&
        hasFirstPage && // avoid prefetching before the first page finishes streaming
        props.hasMore &&
        !props.isLoadingMore &&
        !loadingMoreRef.current &&
        props.onLoadMore
      ) {
        loadingMoreRef.current = true; // Set immediately to prevent duplicates

        void Promise.resolve(props.onLoadMore()).finally(() => {
          loadingMoreRef.current = false;
        });
      }
    },
    [props.hasMore, props.isLoadingMore, props.onLoadMore, loadMoreMinRows],
  );

  // Cleanup scroll debounce on unmount
  useEffect(() => {
    return () => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
    };
  }, []);

  // --- Staged Changes Highlighting ---
  // Important: call hooks unconditionally to preserve hook ordering.
  const stagedChangesFromStore = useStagedChangesIndicator({
    connectionId,
    database: database ?? "",
    schema: schema ?? "",
    table: tableName ?? "",
    rows: effectiveDisplayRows,
    baseRows: displayRows, // Stable pre-optimistic reference for PK map
    columns: finalColumns,
  });

  const stagedChanges = enableStagedChanges
    ? stagedChangesFromStore
    : EMPTY_STAGED_CHANGES;

  const stagedChangesRef = useRef(stagedChanges);
  // Update synchronously during render (not in useEffect) to avoid delay
  stagedChangesRef.current = stagedChanges;

  // --- Staged Values Map (for Document/KeyValue paradigms) ---
  // Build a map of staged new values to override cell display.
  // Reuses the pkToRowIndex map from useStagedChangesIndicator to avoid
  // a duplicate O(N) scan over all rows.
  const stagedValuesMap = useMemo(() => {
    const map = new Map<string, unknown>();
    // Only Document/KeyValue paradigms use stagedValuesMap for cell display override.
    // SQL paradigm uses useOptimisticRows to transform row data directly.
    if (!enableStagedChanges || pendingChanges.length === 0 || paradigm === "sql") {
      return map;
    }

    // Reuse the shared PK→rowIndex map from stagedChanges
    const sharedPkMap = stagedChanges.pkToRowIndex;

    for (const command of pendingChanges) {
      if (command.type !== "data.update") continue;

      const payload = command.payload as {
        column?: string;
        newValue?: unknown;
        primaryKeys?: Record<string, unknown>;
      };
      if (!payload.column || !payload.primaryKeys) continue;

      // Build PK string from command payload (same format as createPrimaryKeyStringFromRecord)
      const pkKey = Object.entries(payload.primaryKeys)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([_key, value]) => {
          if (value === null || value === undefined) return "null";
          if (typeof value === "object") return JSON.stringify(value);
          return String(value);
        })
        .join("|");

      const rowIndex = sharedPkMap.get(pkKey);
      if (rowIndex !== undefined) {
        const key = `${rowIndex}:${payload.column}`;
        map.set(key, payload.newValue);
      }
    }

    return map;
  }, [enableStagedChanges, pendingChanges, stagedChanges.pkToRowIndex, paradigm]);

  const stagedValuesMapRef = useRef(stagedValuesMap);
  stagedValuesMapRef.current = stagedValuesMap;

  // --- Cell Hover Icons (Copy button, FK preview) ---
  // Only use internal hook if no external hoverIconsDrawCell is provided
  const isLargeDataset = effectiveDisplayRows.length > 5000;
  const {
    onItemHovered: handleCellHovered,
    drawCell: internalDrawCellWithHoverIcons,
    fkPreviewState,
    clearFkPreview,
  } = useCellHoverIcons({
    columns: finalColumns,
    rows: effectiveDisplayRows,
    enabled: enableHoverCellIcons && !hoverIconsDrawCell && !isLargeDataset,
    containerRef: containerRef,
    enableFKPreview: paradigm === "sql",
    gridRef: gridRef,
  });

  // Use external drawCell if provided, otherwise use internal
  // Note: Type assertion needed because external hoverIconsDrawCell may have different signature
  const effectiveDrawCell = (hoverIconsDrawCell ??
    internalDrawCellWithHoverIcons) as typeof internalDrawCellWithHoverIcons;

  // Combined item hover handler - merges hover icons with context menu target tracking
  const handleItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      // Call hover icons handler
      handleCellHovered(args);

      // Update context menu target based on what's being hovered
      if (args.kind === "header") {
        const [colIndex] = args.location;
        const column = finalColumnsRef.current[colIndex];
        if (column) {
          contextMenuTargetRef.current = {
            type: "header",
            columnIndex: colIndex,
            column,
          };
        }
      } else if (args.kind === "cell") {
        const [colIndex, rowIndex] = args.location;
        contextMenuTargetRef.current = {
          type: "cell",
          columnIndex: colIndex,
          rowIndex,
        };
      } else if (args.kind === "out-of-bounds") {
        contextMenuTargetRef.current = { type: "out-of-bounds" };
      }
    },
    [handleCellHovered],
  );

  // --- Column Sorting (already defined earlier) ---

  const drawHeader = useMemo(
    () =>
      enableSorting
        ? createDrawHeader({
            getSortDirection,
            getSortIndex,
            columns: finalColumnsRef.current,
            sortedColumnCount: sortColumns.length,
          })
        : undefined,
    // Use finalColumns.length (not reference) to avoid recreating on every
    // column resize pixel. Column metadata (PK icons) only changes when
    // columns are added/removed, which also changes length.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      enableSorting,
      getSortDirection,
      getSortIndex,
      finalColumns.length,
      sortColumns.length,
    ],
  );

  // --- Header Click Handler (for sorting) ---
  const handleHeaderClicked = useCallback(
    (
      colIndex: number,
      event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
    ) => {
      if (enableSorting) {
        const column = finalColumnsRef.current[colIndex];
        if (column) {
          toggleSort(column.id, event.shiftKey || false);
        }
      }
    },
    [enableSorting, toggleSort],
  );

  // --- Clipboard Operations ---
  const toTextCallback = useCallback((selection: GridSelection) => {
    // Handle full row selections
    if (selection.rows.length > 0) {
      const selected = selection.rows
        .toArray()
        .map((idx) => rowsRef.current[idx])
        .filter(Boolean);
      if (selected.length === 0) return "";
      const body = selected.map((row) =>
        finalColumnsRef.current
          .map((col) => {
            const value = row?.[col.field];
            if (!value || typeof value !== "object") return "";
            return String((value as any).value ?? "");
          })
          .join("\t"),
      );
      return body.join("\n");
    }

    // Handle cell-level selections (rectangular ranges)
    if (selection.current?.range) {
      const { range } = selection.current;
      const { x: startCol, y: startRow, width, height } = range;

      const selectedCols = finalColumnsRef.current.slice(
        startCol,
        startCol + width,
      );

      // Build data rows (no headers)
      const body: string[] = [];
      for (let rowIdx = startRow; rowIdx < startRow + height; rowIdx++) {
        const row = rowsRef.current[rowIdx];
        if (!row) continue;

        const rowData = selectedCols
          .map((col) => {
            const value = row[col.field];
            if (!value || typeof value !== "object") return "";
            return String((value as any).value ?? "");
          })
          .join("\t");
        body.push(rowData);
      }

      return body.join("\n");
    }

    return "";
  }, []);

  const toJsonCallback = useCallback((selection: GridSelection) => {
    // Handle full row selections
    if (selection.rows.length > 0) {
      return selection.rows
        .toArray()
        .map((idx) => rowsRef.current[idx])
        .filter(Boolean)
        .map((row) => {
          const jsonRow: Record<string, unknown> = {};
          finalColumnsRef.current.forEach((col) => {
            const value = row?.[col.field];
            if (value && typeof value === "object" && "value" in value) {
              const cellValue = (value as any).value;
              // Use column name for JSON key, not internal field identifier
              jsonRow[col.name] =
                typeof cellValue === "bigint"
                  ? cellValue.toString()
                  : cellValue;
            }
          });
          return jsonRow;
        });
    }

    // Handle cell-level selections (rectangular ranges)
    if (selection.current?.range) {
      const { range } = selection.current;
      const { x: startCol, y: startRow, width, height } = range;

      const selectedCols = finalColumnsRef.current.slice(
        startCol,
        startCol + width,
      );
      const result: Record<string, unknown>[] = [];

      for (let rowIdx = startRow; rowIdx < startRow + height; rowIdx++) {
        const row = rowsRef.current[rowIdx];
        if (!row) continue;

        const jsonRow: Record<string, unknown> = {};
        selectedCols.forEach((col) => {
          const value = row[col.field];
          if (value && typeof value === "object" && "value" in value) {
            const cellValue = (value as any).value;
            // Use column name for JSON key, not internal field identifier
            jsonRow[col.name] =
              typeof cellValue === "bigint" ? cellValue.toString() : cellValue;
          }
        });
        result.push(jsonRow);
      }

      return result;
    }

    return [];
  }, []);

  const { copySelection } = useClipboardBridge({
    toText: toTextCallback,
    toJson: toJsonCallback,
    onCopySuccess: () => {},
    onCopyError: () => {},
  });

  // --- Export to CSV ---
  // TODO: Implement export to CSV
  // useEffect(() => {
  //   if (!enableExport) return;
  //   const handleExport = () => {
  //     if (isGridFocused) {
  //       void exportToCSV(effectiveDisplayRows, finalColumns, `${tableName ?? 'export'}.csv`);
  //       toast.success('Export started');
  //     }
  //   };
  //   eventBus.on('data-grid:export-csv', handleExport);
  //   return () => eventBus.off('data-grid:export-csv', handleExport);
  // }, [enableExport, effectiveDisplayRows, finalColumns, tableName, isGridFocused]);

  // --- getCellContent ---
  // Internal cell content builder (used when props.getCellContent is not provided)
  const connectionContext = useMemo(() => ({
    connectionId,
    database,
    schema: schema ?? "",
    table: tableName ?? "",
  }), [connectionId, database, schema, tableName]);

  const internalGetCellContent = useCallback(
    (cell: Item): GridCell => {
      const [colIndex, rowIndex] = cell;
      const column = finalColumnsRef.current[colIndex];
      const row = rowsRef.current[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
        };
      }

      const cellValue = row[column.field];
      const isReadOnly = readOnly || column.meta?.is_pk || false;

      const gridCell = buildGridCellV2({
        value: cellValue,
        column,
        readOnly: isReadOnly,
        connectionContext,
      });

      // Apply custom getCellContent from paradigm-specific adapter
      return customGetCellContent
        ? customGetCellContent(cell, gridCell)
        : gridCell;
    },
    // Use finalColumns.length (not reference) to avoid recreating on every
    // column resize. The actual column data is accessed via finalColumnsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      readOnly,
      connectionContext,
      customGetCellContent,
      finalColumns.length,
    ],
  );

  // Use prop getCellContent if provided, otherwise use internal
  const propGetCellContentRef = React.useRef(props.getCellContent);
  React.useEffect(() => {
    propGetCellContentRef.current = props.getCellContent;
  });

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      // Use prop getCellContent if provided (Document/KeyValue paradigms)
      // IMPORTANT: When column reordering is enabled, we need to map the visual column index
      // back to the original column index that the adapter's getCellContent expects
      let baseCell: GridCell;
      if (propGetCellContentRef.current) {
        const [visualColIdx, rowIdx] = cell;
        const originalColIdx =
          visualToOriginalColIndexRef.current.get(visualColIdx);
        // If we have a mapping, use the original index; otherwise fall back to visual index
        const mappedCell: Item =
          originalColIdx !== undefined ? [originalColIdx, rowIdx] : cell;
        baseCell = propGetCellContentRef.current(mappedCell, {
          rowIndex: rowIdx,
          columnIndex: visualColIdx,
          row: rowsRef.current[rowIdx],
          column: finalColumnsRef.current[visualColIdx],
        });
      } else {
        baseCell = internalGetCellContent(cell);
      }

      // Apply staged changes highlighting and value override
      // Use column.name for checking staged changes (not column.field)
      // because CRUD commands store changes by actual column name
      if (enableStagedChanges) {
        const [colIndex, rowIndex] = cell;
        const column = finalColumnsRef.current[colIndex];
        if (column) {
          const hasPendingChange = hasStagedCellChange(
            stagedChangesRef.current,
            rowIndex,
            column.name,
          );
          if (hasPendingChange) {
            // Build the cell with staged value override and highlighting
            let updatedCell = baseCell;

            // Override display value if we have a staged value
            // ONLY for Document/KeyValue paradigms that don't use useOptimisticRows to transform row data.
            // SQL paradigm uses useOptimisticRows, so row data is already updated and
            // buildGridCellV2 builds the correct cell type (boolean dropdown, number, etc.).
            if (paradigm === "document" || paradigm === "keyvalue") {
              const stagedValueKey = `${rowIndex}:${column.name}`;
              const stagedValue =
                stagedValuesMapRef.current.get(stagedValueKey);
              if (stagedValue !== undefined) {
                const isCustomCellWithKind =
                  baseCell.kind === GridCellKind.Custom &&
                  typeof baseCell.data === "object" &&
                  baseCell.data !== null &&
                  "kind" in baseCell.data;

                if (isCustomCellWithKind) {
                  const customCell = baseCell as CustomCell;
                  updatedCell = {
                    ...customCell,
                    data: {
                      ...(customCell.data as Record<string, unknown>),
                      value: stagedValue,
                    },
                    copyData:
                      stagedValue === null ? "NULL" : String(stagedValue),
                  };
                } else if (baseCell.kind === GridCellKind.Text) {
                  const displayValue =
                    stagedValue === null ? "NULL" : String(stagedValue);
                  updatedCell = {
                    ...baseCell,
                    data: displayValue,
                    displayData: displayValue,
                  };
                }
              }
            }

            // Apply orange highlighting
            return {
              ...updatedCell,
              themeOverride: updatedCell.themeOverride
                ? { ...updatedCell.themeOverride, ...STAGED_CELL_THEME }
                : STAGED_CELL_THEME,
            };
          }
        }
      }

      return baseCell;
    },
    // Include effectiveDisplayRows in deps to invalidate Glide's cell cache when data changes
    // Include stagedChanges and stagedValuesMap to refresh cells when staged changes update
    // The actual data access uses refs for performance, but the dependency array change
    // forces Glide Data Grid to re-query getCellContent for all cells
    [
      internalGetCellContent,
      enableStagedChanges,
      effectiveDisplayRows,
      stagedChanges,
      stagedValuesMap,
    ],
  );

  // --- getRowThemeOverride ---
  const getRowThemeOverride = useCallback(
    (rowIndex: number) => {
      // Pinned row (check first, higher priority)
      if (enableRowPinning && rowIndex < pinnedRows.length) {
        return { bgCell: "rgba(59, 130, 246, 0.08)" }; // Blue
      }

      if (!enableStagedChanges) return undefined;

      const changes = stagedChangesRef.current;

      // Deletion pending
      if (changes.deletedRows.has(rowIndex)) {
        return { bgCell: "rgba(239, 68, 68, 0.06)" }; // Red
      }

      // Insertion pending
      if (changes.insertedRows.has(rowIndex)) {
        return { bgCell: "rgba(34, 197, 94, 0.06)" }; // Green
      }

      // Staged changes (cell updates)
      if (changes.rowChanges.has(rowIndex)) {
        return { bgCell: "rgba(212, 165, 43, 0.04)" }; // Golden
      }

      return undefined;
    },
    [enableStagedChanges, enableRowPinning, pinnedRows.length],
  );

  // --- CRUD Handlers (using commandFactory) ---
  const handleCellEditCommit = useCallback(
    (event: GridEditCommitEvent) => {
      if (readOnly) return undefined;

      const factory = commandFactoryRef.current;

      // If commandFactory exists (SQL paradigm), use it to create and stage commands
      if (factory) {
        const command = factory.createEditCommand(event);
        if (command) {
          stageCommand(command);
        }
        // Call optional callback for paradigm-specific post-processing
        onCellEditCommitRef.current?.(event);
      } else {
        // No commandFactory - let the paradigm adapter handle staging directly
        // (Document and KeyValue paradigms provide their own onCellEditCommit)
        onCellEditCommitRef.current?.(event);
      }

      return undefined;
    },
    [stageCommand, readOnly],
  );

  const handleAddRow = useCallback(() => {
    const factory = commandFactoryRef.current;
    if (!factory || readOnly) return;

    const command = factory.createInsertCommand();
    stageCommand(command);
    toast.success("New row staged");
  }, [stageCommand, readOnly]);

  const handleInsertRowBelow = useCallback(() => {
    const factory = commandFactoryRef.current;
    if (!factory || readOnly || !gridSelection?.current?.cell) return;

    const [, rowIndex] = gridSelection.current.cell;
    const selectedRow = rowsRef.current[rowIndex];
    const rowKey = selectedRow
      ? factory.getRowKey(selectedRow, rowIndex)
      : undefined;

    const command = factory.createInsertCommand();
    // Add metadata for position if we have a selected row
    if (rowKey) {
      (command.metadata as any).insertAfterRowKey = rowKey;
    }
    stageCommand(command);
    toast.success("New row staged");
  }, [stageCommand, readOnly, gridSelection]);

  const handleInsertRowAbove = useCallback(() => {
    const factory = commandFactoryRef.current;
    if (!factory || readOnly || !gridSelection?.current?.cell) return;

    const [, rowIndex] = gridSelection.current.cell;
    const command = factory.createInsertCommand();

    if (rowIndex === 0) {
      // Insert at top - mark with special metadata
      (command.metadata as any).insertAtTop = true;
    } else {
      // Insert after the row ABOVE the selected row (effectively inserting before)
      const prevRow = rowsRef.current[rowIndex - 1];
      if (prevRow) {
        const rowKey = factory.getRowKey(prevRow, rowIndex - 1);
        (command.metadata as any).insertAfterRowKey = rowKey;
      }
    }

    stageCommand(command);
    toast.success("New row staged");
  }, [stageCommand, readOnly, gridSelection]);

  // Duplicate selected rows (excluding PK columns)
  const handleDuplicateRows = useCallback(() => {
    const factory = commandFactoryRef.current;
    if (!factory || readOnly) return;

    // Get selected row indices
    const selectedIndices = gridSelection?.rows?.toArray() ?? [];
    let rowsToDuplicate: GridRowModel[] = [];

    if (selectedIndices.length > 0) {
      // Multiple rows selected
      rowsToDuplicate = selectedIndices
        .map((idx) => rowsRef.current[idx])
        .filter((row): row is GridRowModel => Boolean(row));
    } else if (gridSelection?.current?.cell) {
      // Single cell selection - duplicate that row
      const [, rowIndex] = gridSelection.current.cell;
      const row = rowsRef.current[rowIndex];
      if (row) {
        rowsToDuplicate = [row];
      }
    }

    if (rowsToDuplicate.length === 0) return;

    // Get PK column fields to exclude
    const pkFields = new Set<string>();
    for (const pkColName of factory.primaryKeyColumns) {
      const field = factory.columnNameToFieldMap.get(pkColName);
      if (field) {
        pkFields.add(field);
      }
    }

    // Also exclude auto-increment/identity columns (usually PKs but let's be thorough)
    // and unique columns if they have auto-generated values
    const columnsToExclude = new Set<string>(pkFields);
    for (const [field, col] of factory.columnByFieldMap.entries()) {
      const meta = col.meta;
      if (meta) {
        // Exclude primary keys
        if (meta.is_pk) {
          columnsToExclude.add(field);
        }
        // Exclude auto-increment columns
        if (
          meta.default?.toLowerCase().includes("nextval") ||
          meta.default?.toLowerCase().includes("auto_increment") ||
          meta.default?.toLowerCase().includes("identity")
        ) {
          columnsToExclude.add(field);
        }
      }
    }

    // Create insert commands with duplicated data (excluding PK/auto columns)
    const commands: import("@/types/crud").CrudCommand[] = [];
    for (const row of rowsToDuplicate) {
      // Build data using column NAMES (not field IDs) since createInsertCommand expects col.name
      const duplicateData: Record<string, unknown> = {};

      for (const [field, value] of Object.entries(row)) {
        if (!columnsToExclude.has(field)) {
          // Get the column to find its actual name
          const col = factory.columnByFieldMap.get(field);
          if (!col) continue;

          const columnName = col.name ?? col.field;

          // Extract raw value from cell format if needed
          const rawValue =
            value && typeof value === "object" && "value" in value
              ? (value as { value: unknown }).value
              : value;
          duplicateData[columnName] = rawValue;
        }
      }

      const command = factory.createInsertCommand(duplicateData);
      commands.push(command);
    }

    if (commands.length > 0) {
      stageBatchWithSingleHistoryEntry(commands);
      toast.success(
        `${commands.length} row${commands.length > 1 ? "s" : ""} duplicated (staged)`,
      );
    }
  }, [stageBatchWithSingleHistoryEntry, readOnly, gridSelection]);

  const handleDeleteRows = useCallback(() => {
    const factory = commandFactoryRef.current;
    if (!factory || readOnly) return;

    const hasExplicitRowSelection = (gridSelection?.rows?.length ?? 0) > 0;
    const selectedIndices = Array.from(collectSelectedRowIndexes(gridSelection));

    if (!hasExplicitRowSelection && selectedIndices.length <= 1) {
      // Single-cell selection path: preserve existing single-command staging semantics.
      const rowIndex = gridSelection?.current?.cell[1] ?? selectedIndices[0];
      if (typeof rowIndex === "number") {
        const row = rowsRef.current[rowIndex];
        if (row) {
          const rowKey = factory.getRowKey(row, rowIndex);
          const command = factory.createDeleteCommand(row, rowKey);
          stageCommand(command);
          toast.success("Row deletion staged");
        }
      }
      return;
    }

    // Multiple rows selected - batch stage for single undo
    const commands: import("@/types/crud").CrudCommand[] = [];
    for (const rowIndex of selectedIndices) {
      const row = rowsRef.current[rowIndex];
      if (row) {
        const rowKey = factory.getRowKey(row, rowIndex);
        const command = factory.createDeleteCommand(row, rowKey);
        commands.push(command);
      }
    }
    if (commands.length > 0) {
      stageBatchWithSingleHistoryEntry(commands);
      toast.success(`${commands.length} row deletion(s) staged`);
    }
  }, [stageCommand, stageBatchWithSingleHistoryEntry, readOnly, gridSelection]);

  // Adapter for EditableDataGrid's onRowDelete prop (Glide onDelete → batch stage).
  // Without this, Glide falls through to clearing every cell individually via
  // onCellEdited, causing O(N×C) individual stageCommand calls that freeze the UI.
  const handleRowDeleteEvent = useCallback(
    (event: import("../types").GridRowDeleteEvent) => {
      const factory = commandFactoryRef.current;
      if (!factory || readOnly) return undefined;

      const commands: import("@/types/crud").CrudCommand[] = [];
      for (let i = 0; i < event.rowIndexes.length; i++) {
        const row = event.rows[i];
        const rowIndex = event.rowIndexes[i];
        if (row && rowIndex !== undefined) {
          const rowKey = factory.getRowKey(row, rowIndex);
          const command = factory.createDeleteCommand(row, rowKey);
          commands.push(command);
        }
      }
      if (commands.length > 0) {
        stageBatchWithSingleHistoryEntry(commands);
        toast.success(`${commands.length} row deletion(s) staged`);
      }
      return undefined;
    },
    [stageBatchWithSingleHistoryEntry, readOnly],
  );

  const handleBatchEdit = useCallback(
    (edits: Array<{ cell: Item; value: unknown }>, _rows: GridRowModel[]) => {
      const factory = commandFactoryRef.current;
      if (!factory || readOnly) return;

      // Collect all commands for batch staging (single undo)
      const commands: import("@/types/crud").CrudCommand[] = [];

      for (const edit of edits) {
        const [colIndex, rowIndex] = edit.cell;
        const column = finalColumnsRef.current[colIndex];
        const row = rowsRef.current[rowIndex];
        if (!column || !row) continue;

        const event: GridEditCommitEvent = {
          cell: edit.cell,
          rowIndex,
          columnIndex: colIndex,
          column,
          row,
          newValue: {
            kind: GridCellKind.Text,
            data: String(edit.value ?? ""),
            displayData: String(edit.value ?? ""),
            allowOverlay: true,
          },
          previousValue: null,
        };

        const command = factory.createEditCommand(event);
        if (command) {
          commands.push(command);
        }
      }

      // Stage all commands with a single history entry for atomic undo
      if (commands.length > 0) {
        stageBatchWithSingleHistoryEntry(commands);
      }
    },
    [stageBatchWithSingleHistoryEntry, readOnly],
  );

  const handleBatchClear = useCallback(
    (cells: Item[]) => {
      if (readOnly || cells.length === 0 || !commandFactory) return;
      const edits = cells.map((cell) => ({ cell, value: null }));
      handleBatchEdit(edits, rowsRef.current);
    },
    [readOnly, commandFactory, handleBatchEdit],
  );

  const handleClearSelection = useCallback(() => {
    if (readOnly || !commandFactory || isCellEditorActive()) return;

    const hasActiveElementInGrid = wrapperRef.current?.contains(
      document.activeElement,
    );
    if (!isGridFocusedRef.current && !hasActiveElementInGrid) return;
    if (isEditingCellRef.current) return;

    const selection = gridSelectionRef.current;
    if (!selection?.current?.range) return;

    const { range } = selection.current;
    const { x: startCol, y: startRow, width, height } = range;

    const cells: Item[] = [];
    for (let row = startRow; row < startRow + height; row++) {
      for (let col = startCol; col < startCol + width; col++) {
        const column = finalColumnsRef.current[col];
        if (column?.meta?.is_pk) continue;
        cells.push([col, row]);
      }
    }

    if (cells.length > 0) {
      handleBatchClear(cells);
      toast.success(`${cells.length} cell(s) staged for clearing`);
    } else {
      toast.info("Cannot clear read-only columns");
    }
  }, [readOnly, commandFactory, isCellEditorActive, handleBatchClear]);

  // Paste handler for clipboard data (called from context menu)
  const handlePaste = useCallback(async () => {
    if (readOnly || !commandFactory) return;

    try {
      // Focus the grid first to ensure clipboard permission works
      // Context menu clicks steal focus, so we need to restore it
      if (gridRef.current) {
        gridRef.current.focus();
        // Small delay to allow focus to settle
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const text = await readClipboardText();
      if (!text) {
        toast.info("Clipboard is empty");
        return;
      }

      // Parse clipboard text using smart format detection (TSV, CSV, JSON)
      const parseResult = parsePasteData(text);
      if (parseResult.error) {
        toast.error(`Parse error: ${parseResult.error}`);
        return;
      }

      let rows = parseResult.rows;
      if (rows.length === 0) return;

      // Use the hovered cell from context menu target if no explicit selection
      // If no selection at all, default to first non-PK column and append as new rows
      const selection = gridSelectionRef.current;
      let startCol: number;
      let startRow: number;

      if (selection?.current?.cell) {
        [startCol, startRow] = selection.current.cell;
      } else if (contextMenuTargetRef.current?.type === "cell") {
        // Use the cell that was right-clicked
        startCol = contextMenuTargetRef.current.columnIndex;
        startRow = contextMenuTargetRef.current.rowIndex;
      } else {
        // No cell selected - paste as new rows starting at first non-PK column
        const columns = finalColumnsRef.current;
        const firstNonPkIndex = columns.findIndex((col) => !col.meta?.is_pk);
        startCol = firstNonPkIndex >= 0 ? firstNonPkIndex : 0;
        startRow = rowsRef.current.length; // Append at end
      }

      // Detect and skip header row if present
      const columnNames = finalColumnsRef.current.map((c) => c.id);
      const firstRow = rows[0];
      if (firstRow && detectHeaderRow(firstRow, columnNames, startCol)) {
        rows = rows.slice(1);
        if (rows.length === 0) {
          toast.info("Clipboard only contained headers");
          return;
        }
      }

      const edits: Array<{ cell: Item; value: unknown }> = [];
      const insertCommands: import("@/types/crud").CrudCommand[] = [];
      const columns = finalColumnsRef.current;

      // Process each row of pasted data
      rows.forEach((values, lineIndex) => {
        const targetRow = startRow + lineIndex;
        const isNewRow = targetRow >= rowsRef.current.length;

        if (isNewRow) {
          // Create a new row with the pasted data directly
          const factory = commandFactoryRef.current;
          if (!factory) return;

          // Build data object for the new row
          const rowData: Record<string, unknown> = {};
          values.forEach((value, colIndex) => {
            const targetCol = startCol + colIndex;
            if (targetCol >= columns.length) return;

            const column = columns[targetCol];
            if (!column || column.meta?.is_pk) return;

            // Coerce value to appropriate type
            const columnTypeHint: ColumnTypeHint = {
              dbType: column.meta?.db_type ?? column.type ?? "text",
              nullable: column.meta?.nullable ?? true,
            };
            const coercedValue = coerceToColumnType(
              typeof value === "string" ? value.trim() : value,
              columnTypeHint,
            );

            // Use column.name as the key - this matches what createInsertCommand expects
            rowData[column.name] = coercedValue;
          });

          // Create insert command and add to batch
          const command = factory.createInsertCommand(rowData);
          insertCommands.push(command);
        } else {
          // Edit existing row
          values.forEach((value, colIndex) => {
            const targetCol = startCol + colIndex;

            // Skip if out of column bounds
            if (targetCol >= columns.length) return;

            // Skip PK columns
            const column = columns[targetCol];
            if (column?.meta?.is_pk) return;

            // Coerce value to appropriate type based on column metadata
            const columnTypeHint: ColumnTypeHint = {
              dbType: column?.meta?.db_type ?? column?.type ?? "text",
              nullable: column?.meta?.nullable ?? true,
            };
            const coercedValue = coerceToColumnType(
              typeof value === "string" ? value.trim() : value,
              columnTypeHint,
            );

            edits.push({
              cell: [targetCol, targetRow],
              value: coercedValue,
            });
          });
        }
      });

      // Apply edits to existing rows
      if (edits.length > 0) {
        handleBatchEdit(edits, rowsRef.current);
      }

      // Stage all insert commands with a single history entry
      if (insertCommands.length > 0) {
        stageBatchWithSingleHistoryEntry(insertCommands);
      }

      const totalRowsPasted =
        (edits.length > 0 ? new Set(edits.map((e) => e.cell[1])).size : 0) +
        insertCommands.length;
      if (totalRowsPasted > 0) {
        toast.success(`Pasted ${totalRowsPasted} row(s)`);
      }
    } catch (err) {
      console.error("Paste failed:", err);
      // Differentiate clipboard permission errors
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        toast.error(
          "Clipboard access denied. Please grant clipboard permission in your browser settings.",
        );
      } else {
        toast.error("Failed to paste from clipboard");
      }
    }
  }, [
    readOnly,
    commandFactory,
    handleBatchEdit,
    stageBatchWithSingleHistoryEntry,
  ]);

  // --- Native Paste Handler (fallback when Glide doesn't handle it) ---
  // Glide Data Grid only handles paste when a cell is selected AND focused.
  // This handler catches Cmd+V/Ctrl+V as a fallback.
  const handleNativePaste = useCallback(
    (e: React.ClipboardEvent) => {
      // Don't handle if we're in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.hasAttribute("contenteditable")
      ) {
        return;
      }

      // Always handle paste ourselves - Glide's internal paste may not fire
      // for external clipboard data (e.g., from Excel)
      e.preventDefault();
      handlePaste();
    },
    [handlePaste],
  );

  // Handle row insert from paste operations (Ctrl+V creating new rows)
  const handleRowInsert = useCallback(
    (event: GridRowInsertEvent) => {
      const factory = commandFactoryRef.current;
      if (!factory || readOnly) return undefined;

      const columns = finalColumnsRef.current;

      // For each row being inserted, create an insert command with the row data
      for (const row of event.rows) {
        // Build data object from the row model
        const rowData: Record<string, unknown> = {};
        for (const column of columns) {
          const cellValue = row[column.field];
          if (
            cellValue &&
            typeof cellValue === "object" &&
            "value" in cellValue
          ) {
            // Skip PK columns and null values
            if (column.meta?.is_pk) continue;
            if (cellValue.value === null || cellValue.value === undefined)
              continue;
            rowData[column.name] = cellValue.value;
          }
        }

        // Create and stage the insert command
        const command = factory.createInsertCommand(rowData);
        stageCommand(command);
      }

      toast.success(`${event.rows.length} row(s) staged for insert`);
      return undefined;
    },
    [readOnly, stageCommand],
  );

  // --- Cell Edit State Tracking ---
  const handleCellEditStart = useCallback(() => {
    isEditingCellRef.current = true;
    setIsEditingCell(true);
  }, []);

  const handleCellEditCancel = useCallback(() => {
    isEditingCellRef.current = false;
    setIsEditingCell(false);
  }, []);

  const handleCellEditCommitWrapper = useCallback(
    (event: GridEditCommitEvent) => {
      isEditingCellRef.current = false;
      setIsEditingCell(false);
      handleCellEditCommit(event);
      return undefined;
    },
    [handleCellEditCommit],
  );

  // --- Fill Operations ---
  const { fillDown, fillRight } = useFillOperations({
    getCellContent,
    onBatchEdit:
      enableFillOperations && commandFactory && !readOnly
        ? (edits) => {
            handleBatchEdit(edits, effectiveDisplayRows);
          }
        : undefined,
    columnCount: finalColumns.length,
    rowCount: effectiveDisplayRows.length,
  });

  useEffect(() => {
    dataGridRegistry.register({
      id: gridId,
      focusFilter: () => {
        effectiveQuickFilterRef.current?.focus();
      },
      copySelection: async () => {
        if (!enableClipboard || isCellEditorActive() || isEditingCellRef.current) {
          return;
        }
        const selection = gridSelectionRef.current;
        if (selection) {
          await copySelection(selection, "text");
        }
      },
      copySelectionAsJson: async () => {
        if (!enableClipboard || isCellEditorActive() || isEditingCellRef.current) {
          return;
        }
        const selection = gridSelectionRef.current;
        if (selection) {
          await copySelection(selection, "json");
        }
      },
      fillDown: () => {
        if (!enableFillOperations || isCellEditorActive() || isEditingCellRef.current) {
          return;
        }
        fillDown(gridSelectionRef.current);
      },
      fillRight: () => {
        if (!enableFillOperations || isCellEditorActive() || isEditingCellRef.current) {
          return;
        }
        fillRight(gridSelectionRef.current);
      },
      duplicateRows: () => {
        if (readOnly || !commandFactory || isCellEditorActive()) {
          return;
        }
        handleDuplicateRows();
      },
      deleteRows: () => {
        if (readOnly || !commandFactory || isCellEditorActive()) {
          return;
        }
        handleDeleteRows();
      },
      clearSelection: () => {
        handleClearSelection();
      },
      showContextMenu: () => {
        // Find the canvas inside the grid — events must originate from INSIDE
        // the ContextMenuTrigger so they bubble UP to its onContextMenu handler.
        const canvas = containerRef.current?.querySelector("canvas");
        if (!canvas) return;

        const sel = gridSelectionRef.current;
        let x: number;
        let y: number;

        // Position context menu near the selected cell using grid's getBounds API
        if (sel?.current?.cell && gridRef.current) {
          const [colIndex, rowIndex] = sel.current.cell;
          const cellBounds = gridRef.current.getBounds(colIndex, rowIndex);
          if (cellBounds) {
            // Place at the bottom-right of the selected cell
            x = cellBounds.x + cellBounds.width;
            y = cellBounds.y + cellBounds.height;
          } else {
            // Fallback to canvas center if cell bounds not available
            const rect = canvas.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.top + rect.height / 2;
          }
          contextMenuTargetRef.current = {
            type: "cell",
            columnIndex: colIndex,
            rowIndex,
          };
        } else {
          // No cell selected — fallback to canvas center
          const rect = canvas.getBoundingClientRect();
          x = rect.left + rect.width / 2;
          y = rect.top + rect.height / 2;
        }

        // Dispatch contextmenu on the canvas so it bubbles through the trigger
        canvas.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
      },
    });

    // Restore focused state after re-registration.
    // When this effect re-runs (due to dependency changes like copySelection),
    // the cleanup above called unregister() which cleared focusedGridId.
    // If the grid is still focused, re-set it so command handlers can find it.
    if (isGridFocusedRef.current) {
      dataGridRegistry.setFocused(gridId);
    }

    return () => {
      dataGridRegistry.unregister(gridId);
    };
  }, [
    commandFactory,
    copySelection,
    enableClipboard,
    enableFillOperations,
    fillDown,
    fillRight,
    gridId,
    handleClearSelection,
    handleDeleteRows,
    handleDuplicateRows,
    isCellEditorActive,
    readOnly,
    effectiveQuickFilterRef,
  ]);

  // Keyboard fallback for DataGrid shortcuts.
  // This keeps critical shortcuts working even if global keybinding context resolution
  // is temporarily out of sync across multiple mounted grid scopes.
  useEffect(() => {
    const handleDataGridShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isMod = event.metaKey || event.ctrlKey;

      if (event.defaultPrevented) return;

      const target = event.target as HTMLElement | null;
      const isTextInputTarget =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      const focusedGridId = dataGridRegistry.getFocused()?.id;
      const activeElement = document.activeElement;
      const isFocusedByRegistry = focusedGridId === gridId;
      const isFocusedByDom =
        !!activeElement &&
        !!wrapperRef.current?.contains(activeElement);
      const isFocused =
        isFocusedByRegistry || isFocusedByDom || isGridFocusedRef.current;

      if (!isFocused) {
        return;
      }

      // Cmd/Ctrl + F -> focus quick filter
      if (isMod && key === "f") {
        event.preventDefault();
        event.stopPropagation();
        effectiveQuickFilterRef.current?.focus();
        return;
      }

      // Don't override native text-input behavior for copy/delete —
      // UNLESS the target is GlideDataGrid's internal hidden <input>,
      // which lives inside the grid wrapper. Skip only for external inputs.
      if (isTextInputTarget && !wrapperRef.current?.contains(target)) {
        return;
      }

      // Cmd/Ctrl + C / Cmd/Ctrl + Shift + C
      if (
        enableClipboard &&
        isMod &&
        key === "c" &&
        !isEditingCellRef.current &&
        !isCellEditorActive()
      ) {
        const selection = gridSelectionRef.current;
        if (!selection) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void copySelection(selection, event.shiftKey ? "json" : "text");
        return;
      }

      // Guard remaining shortcuts against cell editing
      if (isEditingCellRef.current || isCellEditorActive()) {
        return;
      }

      // Workspace shortcuts fallback for Glide's internal hidden input focus.
      if (isMod && !event.shiftKey && key === "s") {
        event.preventDefault();
        event.stopPropagation();
        void commandService.execute("workspace.commitAll").catch((error: unknown) => {
          logger.error(
            "[BaseDataGrid] Failed to execute workspace.commitAll fallback",
            error,
          );
        });
        return;
      }

      if (isMod && event.shiftKey && key === "g") {
        event.preventDefault();
        event.stopPropagation();
        void commandService.execute("workspace.reviewChanges").catch((error: unknown) => {
          logger.error(
            "[BaseDataGrid] Failed to execute workspace.reviewChanges fallback",
            error,
          );
        });
        return;
      }

      if (isMod && event.shiftKey && key === "d") {
        event.preventDefault();
        event.stopPropagation();
        void commandService.execute("workspace.discardAll").catch((error: unknown) => {
          logger.error(
            "[BaseDataGrid] Failed to execute workspace.discardAll fallback",
            error,
          );
        });
        return;
      }

      // Cmd + Delete / Cmd + Backspace -> delete rows
      if (
        event.metaKey &&
        (key === "delete" || key === "backspace") &&
        !readOnly &&
        !!commandFactoryRef.current
      ) {
        event.preventDefault();
        event.stopPropagation();
        handleDeleteRows();
        return;
      }

      // Cmd + D -> delete rows
      if (isMod && key === "d" && !readOnly && !!commandFactoryRef.current) {
        event.preventDefault();
        event.stopPropagation();
        handleDeleteRows();
        return;
      }

      // Cmd + . -> show context menu
      if (isMod && key === ".") {
        event.preventDefault();
        event.stopPropagation();
        dataGridRegistry.getFocused()?.showContextMenu?.();
        return;
      }
    };

    document.addEventListener("keydown", handleDataGridShortcuts, true);
    return () => {
      document.removeEventListener("keydown", handleDataGridShortcuts, true);
    };
  }, [
    commandFactory,
    copySelection,
    effectiveQuickFilterRef,
    enableClipboard,
    gridId,
    handleDeleteRows,
    isCellEditorActive,
    readOnly,
  ]);

  // Native copy event handler.
  // On macOS, the native Edit > Copy menu item (PredefinedMenuItem::copy) intercepts
  // Cmd+C at the OS level before JS keydown handlers can process it. The native menu
  // dispatches a ClipboardEvent "copy" to the focused element instead. We listen for
  // this event on the grid container to ensure copy works even when keydown is consumed.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enableClipboard) return;

    const handleNativeCopy = (event: ClipboardEvent) => {
      if (isEditingCellRef.current || isCellEditorActive()) return;

      const selection = gridSelectionRef.current;
      if (!selection) return;

      event.preventDefault();
      void copySelection(selection, "text");
    };

    el.addEventListener("copy", handleNativeCopy);
    return () => {
      el.removeEventListener("copy", handleNativeCopy);
    };
  }, [enableClipboard, copySelection, isCellEditorActive]);

  // --- Filter by Column (from context menu) ---
  const handleFilterByColumn = useCallback(
    (columnId: string) => {
      if (!enableFiltering) return;

      const column = finalColumnsRef.current.find((c) => c.id === columnId);
      if (!column) return;

      // Focus QuickFilter and set initial filter expression
      quickFilterRef.current?.focus();
      const columnName = column.name ?? column.id;
      setQuickFilterValue(`"${columnName}" IS NOT NULL`);
    },
    [enableFiltering, setQuickFilterValue],
  );

  // --- Selection Management ---
  const handleGridSelectionChange = useCallback(
    (newSelection: GridSelection) => {
      setGridSelection(newSelection);
      gridSelectionRef.current = newSelection;
    },
    [],
  );

  // Compute selected row count efficiently from CompactSelection (O(1))
  // instead of materializing the full Set<number> on every selection change.
  // Note: rows in both row selection AND range selection may be double-counted,
  // which is acceptable for display purposes.
  const selectedRowCount = useMemo(() => {
    let count = gridSelection?.rows?.length ?? 0;

    const addRectRowCount = (range: Readonly<Rectangle> | undefined) => {
      if (!range) return;
      count += Math.max(0, range.height);
    };
    addRectRowCount(gridSelection?.current?.range);
    (gridSelection?.current?.rangeStack ?? []).forEach(addRectRowCount);

    return count;
  }, [gridSelection]);

  // Lazy materialization — only compute the full Set/arrays when actually needed
  // (context menu, copy, delete, export), not on every selection change.
  const getSelectedRowsSet = useCallback((): Set<number> => {
    return collectSelectedRowIndexes(gridSelection);
  }, [gridSelection]);

  const getSelectedRowsData = useCallback((): GridRowModel[] => {
    const set = getSelectedRowsSet();
    return Array.from(set)
      .map((idx) => rowsRef.current[idx])
      .filter((row): row is GridRowModel => Boolean(row));
  }, [getSelectedRowsSet]);

  const getSelectedRowKeys = useCallback((): string[] => {
    const set = getSelectedRowsSet();
    return Array.from(set)
      .map((idx) => getRowKey(rowsRef.current[idx], idx))
      .filter((key): key is string => Boolean(key));
  }, [getSelectedRowsSet, getRowKey]);

  // Materialize selection data on-demand for the context menu.
  // This avoids computing full row data/keys on every selection change.
  const [contextMenuRowsData, setContextMenuRowsData] = useState<GridRowModel[]>([]);
  const [contextMenuRowKeys, setContextMenuRowKeys] = useState<string[]>([]);
  const handleContextMenuOpen = useCallback(() => {
    setContextMenuRowsData(getSelectedRowsData());
    setContextMenuRowKeys(getSelectedRowKeys());
  }, [getSelectedRowsData, getSelectedRowKeys]);

  // --- Column Reordering ---
  const handleColumnMoved = useCallback(
    (startIndex: number, endIndex: number) => {
      if (!hydrated || !enableColumnManagement) return;

      const newOrder = [...finalColumns.map((c) => c.id)];
      const [movedId] = newOrder.splice(startIndex, 1);
      newOrder.splice(endIndex, 0, movedId!);

      upsertGridColumnsState(preferenceGridId, (draft) => {
        draft.order = newOrder;
      });
    },
    [preferenceGridId, finalColumns, hydrated, enableColumnManagement],
  );

  // --- Context Menu Actions ---
  const handleColumnSort = useCallback(
    (columnId: string) => {
      if (enableSorting) {
        toggleSort(columnId, false);
      }
      contextMenuTargetRef.current = null;
    },
    [enableSorting, toggleSort],
  );

  const handleColumnHide = useCallback(
    (columnId: string) => {
      if (!hydrated || !enableColumnManagement) return;
      upsertGridColumnsState(preferenceGridId, (draft) => {
        draft.visibility[columnId] = false;
      });
      contextMenuTargetRef.current = null;
    },
    [preferenceGridId, hydrated, enableColumnManagement],
  );

  const handlePinRowsFromMenu = useCallback(
    (rowKeys: string[]) => {
      if (!enableRowPinning) return;
      for (const key of rowKeys) {
        pinRow(key);
      }
      contextMenuTargetRef.current = null;
    },
    [enableRowPinning, pinRow],
  );

  const handleUnpinRowsFromMenu = useCallback(
    (rowKeys: string[]) => {
      if (!enableRowPinning) return;
      for (const key of rowKeys) {
        unpinRow(key);
      }
      contextMenuTargetRef.current = null;
    },
    [enableRowPinning, unpinRow],
  );

  const handleClearSort = useCallback(
    (columnId: string) => {
      if (!enableSorting) return;
      // Toggle sort clears if already sorted, so we toggle twice to clear
      toggleSort(columnId, false);
      toggleSort(columnId, false);
      contextMenuTargetRef.current = null;
    },
    [enableSorting, toggleSort],
  );

  const handlePinColumn = useCallback(
    (columnId: string) => {
      if (!hydrated || !enableColumnManagement) return;
      upsertGridColumnsState(preferenceGridId, (draft) => {
        if (!draft.pinned.includes(columnId)) {
          draft.pinned.push(columnId);
        }
      });
      contextMenuTargetRef.current = null;
    },
    [preferenceGridId, hydrated, enableColumnManagement],
  );

  const handleUnpinColumn = useCallback(
    (columnId: string) => {
      if (!hydrated || !enableColumnManagement) return;
      upsertGridColumnsState(preferenceGridId, (draft) => {
        draft.pinned = draft.pinned.filter((id: string) => id !== columnId);
      });
      contextMenuTargetRef.current = null;
    },
    [preferenceGridId, hydrated, enableColumnManagement],
  );

  const handleToggleColumnVisibility = useCallback(
    (columnId: string) => {
      if (!hydrated || !enableColumnManagement) return;
      upsertGridColumnsState(preferenceGridId, (draft) => {
        const currentVisible = draft.visibility[columnId] !== false;
        draft.visibility[columnId] = !currentVisible;
      });
      contextMenuTargetRef.current = null;
    },
    [preferenceGridId, hydrated, enableColumnManagement],
  );

  const handleShowAllColumns = useCallback(() => {
    if (!hydrated || !enableColumnManagement) return;
    upsertGridColumnsState(preferenceGridId, (draft) => {
      // Clear all visibility settings (everything visible by default)
      draft.visibility = {};
    });
    contextMenuTargetRef.current = null;
  }, [preferenceGridId, hydrated, enableColumnManagement]);

  const handleInspectorViewDetails = useCallback(
    (rowsToInspect: GridRowModel[]) => {
      if (!enableInspector || rowsToInspect.length === 0) {
        return;
      }
      setInspectorSelectedRow(rowsToInspect[0] ?? null);
      setInspectorOpen(true);
    },
    [enableInspector, setInspectorOpen],
  );

  const handleInspectorCellActivated = useCallback(
    (event: GridActivationEvent) => {
      if (enableInspector && event.row) {
        setInspectorSelectedRow(event.row);
      }
      return onCellActivated?.(event);
    },
    [enableInspector, onCellActivated],
  );

  const handleInspectorCellClicked = useCallback(
    (event: GridActivationEvent) => {
      if (enableInspector && event.row) {
        setInspectorSelectedRow(event.row);
      }
      onCellClicked?.(event);
    },
    [enableInspector, onCellClicked],
  );

  // Prefer the currently selected row from the live grid data.
  // This avoids stale inspector rows after drill-in path changes.
  // Compute just the first selected row index via CompactSelection.first() (O(1))
  // instead of materializing the full selection set into selectedRowsData.
  const firstSelectedRowIndex = useMemo((): number | undefined => {
    // Check explicit row selection first (CompactSelection.first() is O(1))
    const firstRowIdx = gridSelection?.rows.first();
    if (firstRowIdx !== undefined) return firstRowIdx;
    // Fall back to range selection
    const range = gridSelection?.current?.range;
    if (range && range.height > 0) return range.y;
    return undefined;
  }, [gridSelection]);
  const activeInspectorRow =
    (firstSelectedRowIndex !== undefined
      ? effectiveDisplayRows[firstSelectedRowIndex]
      : undefined) ?? inspectorSelectedRow ?? null;
  const activeInspectorPanel = (showInspector && enableInspector)
    ? (renderInspectorPanel
        ? renderInspectorPanel({
            selectedRow: activeInspectorRow,
            columns: finalColumns,
            baselineRow: inspectorBaselineRow,
            onSetBaseline: setInspectorBaselineRow,
          })
        : <InspectorPanel
            selectedRow={activeInspectorRow}
            columns={finalColumns}
            baselineRow={inspectorBaselineRow}
            onSetBaseline={setInspectorBaselineRow}
          />)
    : null;

  // Only materialize full selection data for the status bar's SelectionSummary
  // when the selection is small enough to be practical. For large selections
  // (e.g. select-all of 100k rows), skip the expensive materialization.
  // Threshold is 10k to absorb potential double-counting from overlapping row+range selections.
  const statusBarRowsData = useMemo(() => {
    if (selectedRowCount <= 0 || selectedRowCount > SELECTION_SUMMARY_THRESHOLD) return undefined;
    return getSelectedRowsData();
  }, [selectedRowCount, getSelectedRowsData]);
  const statusBarRowIndices = useMemo(() => {
    if (selectedRowCount <= 0 || selectedRowCount > SELECTION_SUMMARY_THRESHOLD) return undefined;
    return getSelectedRowsSet();
  }, [selectedRowCount, getSelectedRowsSet]);

  // Grid container - extracted to avoid duplication across inspector branches
  const gridContainer = (
    <div
      ref={containerRef}
      className="h-full min-h-0 outline-none"
      tabIndex={-1}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      onPaste={handleNativePaste}
      onMouseDown={(e) => {
        // Canvas interactions don't always emit a focus event on the wrapper.
        // Route commands to this grid immediately on pointer interaction.
        contextService.enterScope(scopeId);
        contextService.setValue("dataGridFocus", true, scopeId);
        dataGridRegistry.setFocused(gridId);
        isGridFocusedRef.current = true;
        setIsGridFocused(true);
        if (e.currentTarget instanceof HTMLElement) {
          e.currentTarget.focus();
        }
      }}
    >
      <UnifiedContextMenu
        selectedRows={contextMenuRowsData}
        selectedRowKeys={contextMenuRowKeys}
        onOpen={handleContextMenuOpen}
        allRows={effectiveDisplayRows}
        columns={finalColumns}
        pinnedRowKeys={pinnedRowIds}
        tableName={tableName}
        schema={schema}
        databaseType={databaseType as any}
        paradigm={paradigm}
        onViewDetails={handleInspectorViewDetails}
        onPinRows={handlePinRowsFromMenu}
        onUnpinRows={handleUnpinRowsFromMenu}
        onAddRow={commandFactory && !readOnly ? handleAddRow : undefined}
        onInsertRowAbove={
          commandFactory && !readOnly ? handleInsertRowAbove : undefined
        }
        onInsertRowBelow={
          commandFactory && !readOnly ? handleInsertRowBelow : undefined
        }
        onDuplicateRows={
          commandFactory && !readOnly ? handleDuplicateRows : undefined
        }
        onDeleteRows={
          commandFactory && !readOnly ? handleDeleteRows : undefined
        }
        onPaste={commandFactory && !readOnly ? handlePaste : undefined}
        onFilterByColumn={
          enableFiltering ? handleFilterByColumn : undefined
        }
        allColumnsForVisibility={finalColumns}
        pinnedColumns={columnState.pinned}
        columnVisibility={columnState.visibility}
        getSortDirection={getSortDirection}
        onSort={handleColumnSort}
        onClearSort={handleClearSort}
        onHideColumn={handleColumnHide}
        onPinColumn={handlePinColumn}
        onUnpinColumn={handleUnpinColumn}
        onToggleColumnVisibility={handleToggleColumnVisibility}
        onShowAllColumns={handleShowAllColumns}
        contextMenuTargetRef={contextMenuTargetRef}
        connectionId={connectionId}
        referencedTableColumns={referencedTableColumns ?? {}}
      >
        <EditableDataGrid
          ref={gridRef}
          tableKey={gridId}
          rows={effectiveDisplayRows}
          columns={finalColumns}
          getCellContent={getCellContent}
          drawHeader={drawHeader}
          drawCell={effectiveDrawCell}
          getRowThemeOverride={getRowThemeOverride}
          freezeColumns={enableColumnManagement ? freezeColumns : 0}
          gridSelection={gridSelection}
          onSelectionChange={handleGridSelectionChange}
          onCellActivated={handleInspectorCellActivated}
          onCellClicked={handleInspectorCellClicked}
          onCellEditStart={handleCellEditStart}
          onCellEditCancel={handleCellEditCancel}
          onCellEditCommit={
            (commandFactory || onCellEditCommitCallback) && !readOnly
              ? handleCellEditCommitWrapper
              : undefined
          }
          onRowInsert={
            commandFactory && !readOnly ? handleRowInsert : undefined
          }
          onRowDelete={
            commandFactory && !readOnly ? handleRowDeleteEvent : undefined
          }
          onBatchClear={
            commandFactory && !readOnly ? handleBatchClear : undefined
          }
          onColumnResize={
            enableColumnManagement ? handleColumnResize : undefined
          }
          onColumnResizeEnd={
            enableColumnManagement
              ? (column, size) => {
                  handleColumnResizeEnd(column, size);
                  flushWidths(columnWidths);
                }
              : undefined
          }
          onColumnMoved={
            enableColumnManagement ? handleColumnMoved : undefined
          }
          onHeaderClicked={handleHeaderClicked}
          onItemHovered={handleItemHovered}
          onVisibleRegionChanged={handleVisibleRegionChanged}
          maxColumnWidth={1000}
        />
      </UnifiedContextMenu>
    </div>
  );

  // --- Render ---
  return (
    <div
      ref={wrapperRef}
      className={cn("flex flex-col h-full outline-none", className)}
      data-testid="base-datagrid"
    >
      {/* Top slot - paradigm-specific toolbar */}
      {topToolbar}

      {/* Quick Filter + Toolbar Actions */}
      {((enableFiltering && filterColumns.length > 0) ||
        toolbarActions ||
        (enableInspector && showInspectorToggleButton)) && (
        <div className="flex items-center gap-2 py-1.5">
          {enableFiltering && filterColumns.length > 0 && (
            <div className="flex-1 min-w-0">
              <QuickFilter
                ref={quickFilterRef}
                columns={filterColumns}
                value={quickFilterValue}
                mode={quickFilterMode}
                onValueChange={setQuickFilterValue}
                onModeChange={setQuickFilterMode}
                onSubmit={handleFilterSubmit}
                isLoading={false}
                error={quickFilterError}
                explanation={aiExplanation}
                clientSideFiltering={false}
              />
            </div>
          )}
          <div className="shrink-0 flex items-center gap-1.5">
            {toolbarActions}
            {enableInspector && showInspectorToggleButton && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => {
                  setInspectorOpen((prev) => !prev);
                }}
              >
                {showInspector ? (
                  <IconLayoutSidebarRightCollapse className="h-3.5 w-3.5 mr-1" />
                ) : (
                  <IconLayoutSidebarRightExpand className="h-3.5 w-3.5 mr-1" />
                )}
                Inspector
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Error State / Main Grid */}
      {error ? (
        <div className="flex-1 min-h-0">
          <DataGridErrorState
            error={error}
            onReload={onRefetch}
            onReconnect={onReconnect}
          />
        </div>
      ) : enableInspector ? (
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={inspectorDefaultOpen ? 72 : 100} minSize={40} order={1}>
            {gridContainer}
          </ResizablePanel>
          <ResizableHandle withHandle className={cn(!showInspector && "sr-only")} />
          <ResizablePanel
            ref={inspectorPanelRef}
            defaultSize={inspectorDefaultOpen ? 28 : 0}
            minSize={20}
            collapsible
            collapsedSize={0}
            order={2}
            onCollapse={() => { setInspectorOpen(false); }}
            onExpand={() => { setInspectorOpen(true); }}
          >
            {activeInspectorPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        gridContainer
      )}

      {/* FK Preview - either external or internal */}
      {fkPreviewComponent}
      {/* Internal FK preview when no external is provided and we have a preview state */}
      {!fkPreviewComponent &&
        paradigm === "sql" &&
        fkPreviewState &&
        !isEditingCell && (
          <FKPreviewPopover
            open={true}
            onOpenChange={(open) => {
              if (!open) {
                clearFkPreview();
              }
            }}
            fkReference={fkPreviewState.fkReference}
            fkValue={fkPreviewState.fkValue}
            connectionId={connectionId}
            database={database ?? ""}
            cellBounds={fkPreviewState.cellBounds}
            sourceColumnName={finalColumns[fkPreviewState.col]?.name}
            sourceTable={tableName ?? ""}
            sourceSchema={schema ?? "public"}
            onOpenReference={() => {
              const { fkReference, fkValue } = fkPreviewState;
              const quotedCol = quoteIdentifier(fkReference.referenced_column, dialect ?? "postgresql");
              let filterValue: string;
              if (fkValue === null) {
                filterValue = `${quotedCol} IS NULL`;
              } else if (typeof fkValue === "string") {
                const escaped = String(fkValue).replace(/'/g, "''");
                filterValue = `${quotedCol} = '${escaped}'`;
              } else if (
                typeof fkValue === "number" ||
                typeof fkValue === "boolean"
              ) {
                filterValue = `${quotedCol} = ${fkValue}`;
              } else {
                const escaped = String(fkValue).replace(/'/g, "''");
                filterValue = `${quotedCol} = '${escaped}'`;
              }

              openTableObject({
                table: {
                  name: fkReference.referenced_table,
                  schema: fkReference.referenced_schema,
                  kind: "Table",
                },
                connectionId,
                database: database ?? "",
                viewType: "data",
                initialFilter: filterValue,
              });
              clearFkPreview();
            }}
          />
        )}

      {/* Bottom slot - paradigm-specific */}
      {bottomToolbar}

      {/* Status bar */}
      <DataGridStatusBar
        loadedRows={effectiveDisplayRows.length}
        estimatedTotal={props.estimatedTotal}
        isEstimatedCount={props.isEstimatedCount}
        hasMore={props.hasMore}
        isStreaming={props.isLoadingMore}
        selectedRows={selectedRowCount}
        selectedRowsData={statusBarRowsData}
        selectedRowIndices={statusBarRowIndices}
        allRows={effectiveDisplayRows}
        columns={finalColumns}
        gridSelection={gridSelection as any}
        readOnlyReason={readOnlyReason}
        onRefreshMaterializedView={onRefreshMaterializedView}
        isRefreshingMatView={isRefreshingMatView}
        // Query performance metrics
        executionTime={props.executionTime}
        networkMs={props.networkMs}
        conversionMs={props.conversionMs}
        fetchCount={props.fetchCount}
        cursorSetupMs={props.cursorSetupMs}
        totalStreamingMs={props.totalStreamingMs}
      />
    </div>
  );
});
