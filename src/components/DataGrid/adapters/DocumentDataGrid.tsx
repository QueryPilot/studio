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
  IconBrackets,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
} from "@tabler/icons-react";
import { BaseDataGrid } from "../base/BaseDataGrid";
import { BreadcrumbNav } from "../components/BreadcrumbNav";
import { useDocumentData } from "../hooks/useDocumentData";
import type { GridActivationEvent, GridColumnV2, GridRowModel, Item } from "../types";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  type DocumentFilter,
  parseDocumentFilter,
} from "@/utils/documentFilterParser";
import { useQuickFilter } from "../hooks/useQuickFilter";
import type { FilterColumnInfo } from "@/utils/filterParser";
import { QuickFilter, type QuickFilterRef } from "../components/QuickFilter";
import type { FilterMode } from "@/utils/filterParser";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import { useGridPreferencesStore } from "../stores/gridPreferencesStore";
import type { InspectorTab } from "../components/inspector";
import { Button } from "@/components/ui/button";
import {
  buildDocumentCell,
  detectDocumentValueType,
  generateColumnsFromDocuments,
  type DocumentCellValue,
} from "../utils/documentCellFactory";
import { type GridCellValueType } from "@/types/cellValue";

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

export interface DocumentCollectionDataGridProps
  extends DocumentDataGridBaseProps {
  mode?: "collection";
  /** Collection name */
  collection: string;
  /** Page size for pagination */
  pageSize?: number;
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

function mapResultModeValueType(
  valueType: DocumentCellValue["type"],
): GridCellValueType {
  switch (valueType) {
    case "number":
      return "Integer";
    case "boolean":
      return "Boolean";
    case "date":
      return "DateTime";
    case "null":
      return "Null";
    case "object":
    case "array":
      return "Json";
    case "binary":
      return "Binary";
    case "string":
    case "objectId":
    default:
      return "Text";
  }
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
  className,
  focused,
  sortGridId,
}: DocumentCollectionDataGridProps) {
  const preferenceGridId = sortGridId ?? gridId;
  const quickFilterRef = useRef<QuickFilterRef>(null);
  const lastDrilledCellRef = useRef<string | null>(null);

  // Filter state
  const [documentFilter, setDocumentFilter] = useState<
    DocumentFilter | undefined
  >(undefined);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [flattenMode, setFlattenMode] = useState(false);
  const [flattenDepth] = useState(3);
  const { showInspector, setShowInspector, inspectorTab, setInspectorTab } =
    useDocumentGridInspectorState(gridId);
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
      return;
    }

    const result = parseDocumentFilter(value);

    if (result.success && result.filter) {
      setDocumentFilter(result.filter);
      setFilterError(null);
      logger.info("document-grid", "Filter applied", {
        mode: result.filter.mode,
        description: result.filter.description,
      });
    } else if (result.success && !result.filter) {
      // Empty filter
      setDocumentFilter(undefined);
      setFilterError(null);
    } else {
      setFilterError(result.error || "Invalid filter");
    }
  }, [quickFilter.value]);

  // Handle mode change - convert between document filter modes and standard modes
  const handleModeChange = useCallback(
    (mode: FilterMode) => {
      quickFilter.setMode(mode);
      // Clear filter when mode changes
      setDocumentFilter(undefined);
      setFilterError(null);
    },
    [quickFilter],
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
        logger.info("document-grid", `Drilled into cell [${event.rowIndex}, ${event.columnIndex}]`, {
          path: data.currentPath,
        });
        return true;
      }
      return false;
    },
    [data],
  );

  // Handle single-click drill-down for nested object/array cells
  const handleCellClicked = useCallback(
    (event: GridActivationEvent) => {
      if (data.canStepInto(event)) {
        const cellKey = `${event.rowIndex}:${event.columnIndex}`;
        lastDrilledCellRef.current = cellKey;
        data.stepInto(event);
      }
    },
    [data],
  );

  useEffect(() => {
    lastDrilledCellRef.current = null;
  }, [data.currentPath]);

  // Breadcrumb navigation toolbar with optional filter
  const topToolbar = (
    <div className="flex flex-col gap-1.5 mb-1.5 p-1">
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
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={flattenMode ? "default" : "outline"}
          className="h-7 text-[11px]"
          onClick={() => {
            setFlattenMode((prev) => !prev);
          }}
        >
          <IconBrackets className="h-3.5 w-3.5 mr-1" />
          {flattenMode ? "Flattened" : "Nested"}
        </Button>
      </div>
      {/* Show filter at root level only */}
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
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
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
        </div>
      )}
    </div>
  );

  // Determine read-only state (nested paths are read-only)
  const readOnly = data.currentPath.length > 0;

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
    <BaseDataGrid
      gridId={gridId}
      sortGridId={sortGridId}
      rows={data.rows}
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
      enableSorting={true} // ✅ ENABLE - Collections can be sorted by any field
      enableExport={true}
      enableRowPinning={true} // ✅ ENABLE - Keep reference documents visible
      enableColumnManagement={true} // ✅ ENABLE - Hide/show/reorder columns for wide documents
      enableClipboard={true} // ✅ ENABLE - Copy/paste document data
      enableFillOperations={!readOnly} // ✅ ENABLE - Bulk cell updates (disabled in nested paths)
      enableStagedChanges={!readOnly} // Disable staging toolbar for read-only nested views
      readOnly={readOnly}
      onRefetch={data.refetch}
      onReconnect={handleReconnect}
      focused={focused}
      externalQuickFilterRef={quickFilterRef}
      className={cn("document-datagrid", className)}
    />
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
            value_type: mapResultModeValueType(valueType),
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
