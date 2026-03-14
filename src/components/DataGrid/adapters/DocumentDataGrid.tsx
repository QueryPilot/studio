/**
 * DocumentDataGrid - MongoDB document browser using the unified BaseDataGrid architecture
 *
 * Features:
 * - BaseDataGrid foundation with all unified features
 * - Drill-down navigation for nested objects/arrays
 * - Dynamic column generation from document keys
 * - Breadcrumb navigation in topToolbar
 * - CRUD operations via the staging pipeline
 * - Server-side (query) and client-side (search) filtering
 */

import { memo, useCallback, useMemo, useState, useRef, useEffect } from "react";
import {
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconSearch,
  IconX,
  IconTable,
  IconListTree,
  IconBraces,
} from "@tabler/icons-react";
import { BaseDataGrid } from "../base/BaseDataGrid";
import { BreadcrumbNav } from "../components/BreadcrumbNav";
import { DocumentTreeView } from "../components/DocumentTreeView";
import { DocumentJsonView } from "../components/DocumentJsonView";
import { DataGridStatusBar } from "../components/DataGridStatusBar";
import { useDocumentData } from "../hooks/useDocumentData";
import type {
  GridActivationEvent,
  GridColumnV2,
  GridRowModel,
  Item,
} from "../types";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  type DocumentFilter,
  parseDocumentFilter,
} from "@/utils/documentFilterParser";
import { useGridSearchWorker } from "../hooks/useGridSearchWorker";
import { useQuickFilter } from "../hooks/useQuickFilter";
import type { FilterColumnInfo } from "@/utils/filterParser";
import { QuickFilter, type QuickFilterRef } from "../components/QuickFilter";
import type { FilterMode } from "@/utils/filterParser";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import { useGridPreferencesStore } from "../stores/gridPreferencesStore";
import type { InspectorTab } from "../components/inspector";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildDocumentCell,
  detectDocumentValueType,
  generateColumnsFromDocuments,
  mapDocumentValueTypeToGrid,
  type DocumentCellValue,
} from "../utils/documentCellFactory";

// ============================================================================
// Types
// ============================================================================

interface DocumentDataGridBaseProps {
  /** Unique grid ID for state management */
  gridId: string;
  /** Connection ID */
  connectionId: string;
  /** Database name */
  database: string;
  /** CSS class name */
  className?: string;
  /** Whether this grid's panel is focused (for auto-focus) */
  focused?: boolean;
  /** Override grid ID used for sort preferences (for per-tab sort isolation) */
  sortGridId?: string;
}

export type DocumentDataViewMode = "table" | "tree" | "json";

export interface DocumentCollectionDataGridProps extends DocumentDataGridBaseProps {
  mode?: "collection";
  /** Collection name */
  collection: string;
  /** Page size for pagination */
  pageSize?: number;
  /** Applied filter text shared with sibling Mongo workbench views */
  initialFilterText?: string;
  /** Notifies sibling Mongo workbench views when the applied filter changes */
  onAppliedFilterChange?: (state: {
    text: string;
    filter: DocumentFilter | undefined;
    error: string | null;
  }) => void;
  /** Active data view mode (table, tree, or json) */
  viewMode?: DocumentDataViewMode;
  /** Callback when the user switches view mode */
  onViewModeChange?: (mode: DocumentDataViewMode) => void;
}

export interface DocumentResultDataGridProps extends DocumentDataGridBaseProps {
  mode: "result";
  documents: Record<string, unknown>[];
  /** Source collection when known */
  collection?: string;
}

export type DocumentDataGridProps =
  | DocumentCollectionDataGridProps
  | DocumentResultDataGridProps;

function getInitialDocumentFilterState(initialFilterText?: string): {
  filter: DocumentFilter | undefined;
  error: string | null;
} {
  if (
    typeof initialFilterText !== "string" ||
    initialFilterText.trim().length === 0
  ) {
    return {
      filter: undefined,
      error: null,
    };
  }

  const result = parseDocumentFilter(initialFilterText);
  if (result.success) {
    return {
      filter: result.filter,
      error: null,
    };
  }

  return {
    filter: undefined,
    error: result.error || "Invalid filter",
  };
}

function useDocumentGridInspectorState(gridId: string) {
  const persistedInspector = useGridPreferencesStore(
    (s) => s.preferences[gridId]?.inspector,
  );
  const [showInspector, setShowInspector] = useState(
    () => persistedInspector?.open ?? false,
  );
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(
    () => (persistedInspector?.tab as InspectorTab | undefined) ?? "tree",
  );
  const setInspectorPref = useGridPreferencesStore((s) => s.setInspector);

  useEffect(() => {
    setInspectorPref(gridId, { open: showInspector, tab: inspectorTab });
  }, [gridId, inspectorTab, setInspectorPref, showInspector]);

  return {
    showInspector,
    setShowInspector,
    inspectorTab,
    setInspectorTab,
  };
}

function buildResultModeNullTypeHints(
  documents: Record<string, unknown>[],
): Record<string, DocumentCellValue["type"]> {
  const hints: Record<string, DocumentCellValue["type"]> = {};

  for (const document of documents) {
    for (const [key, value] of Object.entries(document)) {
      if (key in hints || value === null || value === undefined) {
        continue;
      }
      hints[key] = detectDocumentValueType(value);
    }
  }

  return hints;
}

// ============================================================================
// Component
// ============================================================================

const DocumentCollectionDataGrid = memo(function DocumentCollectionDataGrid({
  gridId,
  connectionId,
  database,
  collection,
  pageSize = 50,
  initialFilterText,
  onAppliedFilterChange,
  viewMode,
  onViewModeChange,
  className,
  focused,
  sortGridId,
}: DocumentCollectionDataGridProps) {
  const preferenceGridId = sortGridId ?? gridId;
  const quickFilterRef = useRef<QuickFilterRef>(null);
  const lastDrilledCellRef = useRef<string | null>(null);
  const initialFilterState = useMemo(
    () => getInitialDocumentFilterState(initialFilterText),
    [initialFilterText],
  );

  // Filter state
  const [documentFilter, setDocumentFilter] = useState<
    DocumentFilter | undefined
  >(() => initialFilterState.filter);
  const [filterError, setFilterError] = useState<string | null>(
    () => initialFilterState.error,
  );
  const flattenMode = false;
  const flattenDepth = 3;
  const { showInspector, setShowInspector, inspectorTab, setInspectorTab } =
    useDocumentGridInspectorState(gridId);
  const [nestedSearch, setNestedSearch] = useState({ term: "", pathKey: "" });
  // Get document data with filter
  const data = useDocumentData({
    gridId: preferenceGridId,
    connectionId,
    database,
    collection,
    pageSize,
    enabled: true,
    filter: documentFilter,
    flattenMode,
    flattenDepth,
  });

  // Derive a stable key from the current path to auto-reset search when path changes
  const pathKey = useMemo(
    () => data.currentPath.map((p) => p.key).join("/"),
    [data.currentPath],
  );

  // If path changed, the stored search term is stale — treat as empty
  const nestedSearchTerm =
    nestedSearch.pathKey === pathKey ? nestedSearch.term : "";

  const setNestedSearchTerm = useCallback(
    (term: string) => {
      setNestedSearch({ term, pathKey });
    },
    [pathKey],
  );

  const filteredRows = useGridSearchWorker(
    data.rows,
    data.columns,
    data.currentPath.length > 0 ? nestedSearchTerm : "",
  );

  // Build filter columns from data columns
  const filterColumns = useMemo<FilterColumnInfo[]>(() => {
    return data.columns.map((col) => ({
      name: col.field,
      dataType: col.type || "string",
    }));
  }, [data.columns]);

  // Quick filter hook for managing filter input state
  const quickFilter = useQuickFilter({
    columns: filterColumns,
    initialValue: initialFilterText,
    clientSideFiltering: false, // We handle both server and client filtering ourselves
    generateAIFilter: undefined,
    gridId: preferenceGridId,
  });

  // Handle filter submission
  const handleFilterSubmit = useCallback(() => {
    const value = quickFilter.value.trim();

    if (!value) {
      setDocumentFilter(undefined);
      setFilterError(null);
      onAppliedFilterChange?.({
        text: "",
        filter: undefined,
        error: null,
      });
      return;
    }

    const result = parseDocumentFilter(value);

    if (result.success && result.filter) {
      setDocumentFilter(result.filter);
      setFilterError(null);
      onAppliedFilterChange?.({
        text: quickFilter.value,
        filter: result.filter,
        error: null,
      });
      logger.info("document-grid", "Filter applied", {
        mode: result.filter.mode,
        description: result.filter.description,
      });
    } else if (result.success && !result.filter) {
      // Empty filter
      setDocumentFilter(undefined);
      setFilterError(null);
      onAppliedFilterChange?.({
        text: quickFilter.value,
        filter: undefined,
        error: null,
      });
    } else {
      const error = result.error || "Invalid filter";
      setFilterError(error);
      onAppliedFilterChange?.({
        text: quickFilter.value,
        filter: undefined,
        error,
      });
    }
  }, [onAppliedFilterChange, quickFilter.value]);

  // Handle mode change - convert between document filter modes and standard modes
  const handleModeChange = useCallback(
    (mode: FilterMode) => {
      quickFilter.setMode(mode);
      // Clear filter when mode changes
      setDocumentFilter(undefined);
      setFilterError(null);
      onAppliedFilterChange?.({
        text: "",
        filter: undefined,
        error: null,
      });
    },
    [onAppliedFilterChange, quickFilter],
  );

  // Handle cell activation for drill-down
  const handleCellActivated = useCallback(
    (event: GridActivationEvent) => {
      if (data.canStepInto(event)) {
        const cellKey = `${event.rowIndex}:${event.columnIndex}`;
        if (lastDrilledCellRef.current === cellKey) {
          return true;
        }
        lastDrilledCellRef.current = cellKey;
        data.stepInto(event);
        logger.info(
          "document-grid",
          `Drilled into cell [${event.rowIndex}, ${event.columnIndex}]`,
          {
            path: data.currentPath,
          },
        );
        return true;
      }
      return false;
    },
    [data],
  );

  // Single-click on cells — no drill-down (double-click only via onCellActivated)
  const handleCellClicked = useCallback((_event: GridActivationEvent) => {
    // Intentionally empty — drill-down is handled by handleCellActivated (double-click)
  }, []);

  useEffect(() => {
    lastDrilledCellRef.current = null;
  }, [data.currentPath]);

  const activeViewMode = viewMode ?? "table";

  const flattenControl = null;

  const inspectorToggle = (
    <Button
      size="icon"
      variant="outline"
      className="h-7 w-7 shrink-0"
      onClick={() => {
        setShowInspector((prev) => !prev);
      }}
    >
      {showInspector ? (
        <IconLayoutSidebarRightCollapse className="h-3.5 w-3.5" />
      ) : (
        <IconLayoutSidebarRightExpand className="h-3.5 w-3.5" />
      )}
    </Button>
  );

  const viewModeToggle = onViewModeChange ? (
    <Tabs
      value={activeViewMode}
      onValueChange={(v) => {
        onViewModeChange(v as DocumentDataViewMode);
      }}
    >
      <TabsList>
        <TabsTrigger value="table">
          <IconTable /> Table
        </TabsTrigger>
        <TabsTrigger value="tree">
          <IconListTree /> Tree
        </TabsTrigger>
        <TabsTrigger value="json">
          <IconBraces /> JSON
        </TabsTrigger>
      </TabsList>
    </Tabs>
  ) : null;

  const topToolbar = (
    <div className="flex flex-col gap-1.5 mb-1.5 p-1">
      {/* Row 1: BreadcrumbNav (only when drilled in) */}
      {data.currentPath.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <BreadcrumbNav
              path={data.currentPath}
              collectionName={collection}
              documentId={data.getCurrentDocumentId()}
              onNavigate={data.navigateToPath}
              onNavigateToRoot={() => {
                data.navigateToPath(-1);
              }}
              onStepOut={data.stepOut}
            />
          </div>
          {flattenControl}
          {inspectorToggle}
        </div>
      )}

      {/* Nested search - client-side only */}
      {data.currentPath.length > 0 && (
        <div className="relative flex-1 min-w-0">
          <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={nestedSearchTerm}
            onChange={(e) => {
              setNestedSearchTerm(e.target.value);
            }}
            placeholder="Search nested values..."
            className="h-7 w-full rounded border bg-background pl-7 pr-7 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {nestedSearchTerm && (
            <button
              type="button"
              onClick={() => {
                setNestedSearchTerm("");
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <IconX className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* Row 2 (or Row 1 at root): QuickFilter + controls */}
      {data.currentPath.length === 0 && filterColumns.length > 0 ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <QuickFilter
              ref={quickFilterRef}
              columns={filterColumns}
              value={quickFilter.value}
              mode={quickFilter.mode}
              onValueChange={quickFilter.setValue}
              onModeChange={handleModeChange}
              onSubmit={handleFilterSubmit}
              onClear={quickFilter.clear}
              error={filterError}
              explanation={quickFilter.aiExplanation}
              isLoading={false}
              searchModeOnly={false}
              clientSideFiltering={false}
            />
          </div>
          {viewModeToggle}
          {flattenControl}
          {inspectorToggle}
        </div>
      ) : data.currentPath.length === 0 ? (
        <div className="flex justify-end gap-2">
          {viewModeToggle}
          {flattenControl}
          {inspectorToggle}
        </div>
      ) : null}
    </div>
  );

  const readOnly = false;

  // Loading and error states
  const isLoading = data.isLoading && data.rows.length === 0;
  const errorMessage = data.error ? data.error.message : null;

  // Reconnection handler
  const handleReconnect = useCallback(async () => {
    try {
      // Test connection by fetching a single document
      const adapter = new MongoDBAdapter(connectionId);
      await adapter.findDocuments(collection, {}, { limit: 1 });
      await data.refetch();
    } catch (err) {
      console.error("Reconnection failed:", err);
      await data.refetch(); // Still try to refetch
    }
  }, [connectionId, collection, data]);

  return (
    <>
      <div
        style={{ display: activeViewMode === "table" ? undefined : "none" }}
        className={cn("h-full", className)}
      >
        <BaseDataGrid
          gridId={gridId}
          sortGridId={sortGridId}
          rows={data.currentPath.length > 0 ? filteredRows : data.rows}
          columns={data.columns}
          getCellContent={data.getCellContent}
          isLoading={isLoading}
          isLoadingMore={data.isLoadingMore}
          error={errorMessage}
          hasMore={data.hasMore}
          onLoadMore={data.fetchNextPage}
          loadMoreMinRows={pageSize}
          estimatedTotal={data.totalCount}
          isEstimatedCount={false}
          executionTime={data.executionTime}
          onCellActivated={handleCellActivated}
          onCellClicked={handleCellClicked}
          // Command factory for CRUD operations (insert/delete documents)
          // Returns undefined when in nested path (read-only mode)
          commandFactory={data.commandFactory}
          topToolbar={topToolbar}
          inspectorOpen={showInspector}
          onInspectorOpenChange={setShowInspector}
          inspectorDefaultTab={inspectorTab}
          onInspectorTabChange={setInspectorTab}
          showInspectorToggleButton={false}
          enableHoverCellIcons={false}
          connectionId={connectionId}
          database={database}
          tableName={collection}
          paradigm="document"
          enableFiltering={false} // Keep false - has custom QuickFilter
          enableSorting={true}
          enableExport={true}
          enableRowPinning={true}
          enableColumnManagement={true}
          enableClipboard={true}
          enableFillOperations={!readOnly}
          enableStagedChanges={!readOnly}
          readOnly={readOnly}
          onRefetch={data.refetch}
          onReconnect={handleReconnect}
          focused={focused}
          externalQuickFilterRef={quickFilterRef}
          className="document-datagrid h-full"
        />
      </div>
      {activeViewMode === "tree" && (
        <div className={cn("flex flex-col h-full", className)}>
          <div className="flex-none">{topToolbar}</div>
          <DocumentTreeView
            documents={data.rawDocuments}
            className="min-h-0 flex-1"
            hasMore={data.hasMore}
            isLoadingMore={data.isLoadingMore}
            onLoadMore={data.fetchNextPage}
            editable={true}
            onFieldEdit={(docIndex, fieldPath, newValue) => {
              // TODO: Wire to CRUD store in a future task
              console.log("Edit:", docIndex, fieldPath, newValue);
            }}
          />
          <DataGridStatusBar
            loadedRows={data.rawDocuments.length}
            estimatedTotal={data.totalCount}
            hasMore={data.hasMore}
            executionTime={data.executionTime}
          />
        </div>
      )}
      {activeViewMode === "json" && (
        <div className={cn("flex flex-col h-full", className)}>
          <div className="flex-none">{topToolbar}</div>
          <DocumentJsonView
            documents={data.rawDocuments}
            className="min-h-0 flex-1"
          />
          <DataGridStatusBar
            loadedRows={data.rawDocuments.length}
            estimatedTotal={data.totalCount}
            hasMore={data.hasMore}
            executionTime={data.executionTime}
          />
        </div>
      )}
    </>
  );
});

const DocumentResultDataGrid = memo(function DocumentResultDataGrid({
  gridId,
  connectionId,
  database,
  documents,
  collection,
  className,
  focused,
  sortGridId,
}: DocumentResultDataGridProps) {
  const { showInspector, setShowInspector, inspectorTab, setInspectorTab } =
    useDocumentGridInspectorState(gridId);
  const columns = useMemo<GridColumnV2[]>(
    () =>
      documents.length > 0
        ? generateColumnsFromDocuments(documents)
        : [{ id: "_id", field: "_id", title: "_id", name: "_id", width: 220 }],
    [documents],
  );
  const rows = useMemo<GridRowModel[]>(
    () =>
      documents.map((document) => {
        const row: GridRowModel = {};
        for (const column of columns) {
          const value = document[column.field];
          const valueType = detectDocumentValueType(value);
          row[column.field] = {
            value,
            db_type: valueType,
            value_type: mapDocumentValueTypeToGrid(valueType),
            is_truncated: false,
          };
        }
        return row;
      }),
    [columns, documents],
  );
  const nullTypeHints = useMemo(
    () => buildResultModeNullTypeHints(documents),
    [documents],
  );

  const getCellContent = useCallback(
    ([columnIndex, rowIndex]: Item) => {
      const column = columns[columnIndex];
      const row = rows[rowIndex];

      if (!column) {
        return buildDocumentCell({
          value: null,
          column: {
            id: "__missing__",
            field: "__missing__",
            title: "",
            name: "",
          },
          readOnly: true,
          canDrillDown: false,
        });
      }

      return buildDocumentCell({
        value: row?.[column.field]?.value ?? null,
        column,
        nullTypeHint: nullTypeHints[column.field],
        readOnly: true,
        canDrillDown: false,
      });
    },
    [columns, nullTypeHints, rows],
  );

  return (
    <BaseDataGrid
      gridId={gridId}
      sortGridId={sortGridId}
      rows={rows}
      columns={columns}
      getCellContent={getCellContent}
      isLoading={false}
      isLoadingMore={false}
      error={null}
      hasMore={false}
      estimatedTotal={rows.length}
      isEstimatedCount={false}
      inspectorOpen={showInspector}
      onInspectorOpenChange={setShowInspector}
      inspectorDefaultTab={inspectorTab}
      onInspectorTabChange={setInspectorTab}
      connectionId={connectionId}
      database={database}
      tableName={collection}
      paradigm="document"
      enableFiltering={false}
      enableSorting={true}
      enableExport={true}
      enableRowPinning={true}
      enableColumnManagement={true}
      enableClipboard={true}
      enableFillOperations={false}
      enableStagedChanges={false}
      readOnly={true}
      focused={focused}
      className={cn("document-datagrid", className)}
    />
  );
});

export const DocumentDataGrid = memo(function DocumentDataGrid(
  props: DocumentDataGridProps,
) {
  if (props.mode === "result") {
    return <DocumentResultDataGrid {...props} />;
  }

  return <DocumentCollectionDataGrid {...props} />;
});

export default DocumentDataGrid;
