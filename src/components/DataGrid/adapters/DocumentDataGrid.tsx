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
  IconSparkles,
  IconChevronRight,
  IconPlus,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
} from "@tabler/icons-react";
import { BaseDataGrid } from "../base/BaseDataGrid";
import { BreadcrumbNav } from "../components/BreadcrumbNav";
import { useDocumentData } from "../hooks/useDocumentData";
import type { GridActivationEvent } from "../types";
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { openCollectionDesigner } from "@/utils/workbench/openers";

// ============================================================================
// Types
// ============================================================================

export interface DocumentDataGridProps {
  /** Unique grid ID for state management */
  gridId: string;
  /** Connection ID */
  connectionId: string;
  /** Database name */
  database: string;
  /** Collection name */
  collection: string;
  /** Page size for pagination */
  pageSize?: number;
  /** CSS class name */
  className?: string;
  /** Whether this grid's panel is focused (for auto-focus) */
  focused?: boolean;
  /** Override grid ID used for sort preferences (for per-tab sort isolation) */
  sortGridId?: string;
}

interface DocumentGridView {
  id: string;
  name: string;
  flattenMode: boolean;
  flattenDepth: number;
  filterValue: string;
  filterMode: FilterMode;
}

// ============================================================================
// Component
// ============================================================================

export const DocumentDataGrid = memo(function DocumentDataGrid({
  gridId,
  connectionId,
  database,
  collection,
  pageSize = 50,
  className,
  focused,
  sortGridId,
}: DocumentDataGridProps) {
  const preferenceGridId = sortGridId ?? gridId;
  const quickFilterRef = useRef<QuickFilterRef>(null);
  const lastDrilledCellRef = useRef<string | null>(null);

  // Filter state
  const [documentFilter, setDocumentFilter] = useState<
    DocumentFilter | undefined
  >(undefined);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [flattenMode, setFlattenMode] = useState(false);
  const [flattenDepth, setFlattenDepth] = useState(3);
  const persistedInspector = useGridPreferencesStore(
    (s) => s.preferences[gridId]?.inspector,
  );
  const [showInspector, setShowInspector] = useState(
    () => persistedInspector?.open ?? false,
  );
  const [objectIdJump, setObjectIdJump] = useState("");
  const [planHint, setPlanHint] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<DocumentGridView[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    try {
      const raw = window.localStorage.getItem(`querypilot.document-grid.views.${gridId}`);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as DocumentGridView[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

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

  const savedViewStorageKey = `querypilot.document-grid.views.${gridId}`;

  useEffect(() => {
    window.localStorage.setItem(savedViewStorageKey, JSON.stringify(savedViews));
  }, [savedViews, savedViewStorageKey]);

  // Inspector tab state with persistence
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(
    () => (persistedInspector?.tab as InspectorTab) ?? "tree",
  );
  const setInspectorPref = useGridPreferencesStore((s) => s.setInspector);
  useEffect(() => {
    setInspectorPref(gridId, { open: showInspector, tab: inspectorTab });
  }, [gridId, showInspector, inspectorTab, setInspectorPref]);

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

  const handleSaveView = useCallback(() => {
    const name = window.prompt("View name");
    if (!name || !name.trim()) return;

    const view: DocumentGridView = {
      id: `${Date.now()}`,
      name: name.trim(),
      flattenMode,
      flattenDepth,
      filterValue: quickFilter.value,
      filterMode: quickFilter.mode,
    };

    setSavedViews((prev) => [view, ...prev.filter((v) => v.name !== view.name)].slice(0, 20));
    toast.success("View saved");
  }, [flattenDepth, flattenMode, quickFilter.mode, quickFilter.value]);

  const handleApplyView = useCallback(
    (viewId: string) => {
      const view = savedViews.find((item) => item.id === viewId);
      if (!view) return;
      setFlattenMode(view.flattenMode);
      setFlattenDepth(view.flattenDepth);
      quickFilter.setMode(view.filterMode);
      quickFilter.setValue(view.filterValue);
      setFilterError(null);
      const result = parseDocumentFilter(view.filterValue);
      if (result.success) {
        setDocumentFilter(result.filter);
      }
    },
    [quickFilter, savedViews],
  );

  const handleJumpToObjectId = useCallback(() => {
    const trimmed = objectIdJump.trim();
    if (!trimmed) return;
    const filterText = `?{ _id: "${trimmed}" }`;
    quickFilter.setMode("where");
    quickFilter.setValue(filterText);
    setDocumentFilter({
      mode: "query",
      mongoQuery: { _id: trimmed },
      description: `_id = ${trimmed}`,
    });
    setFilterError(null);
    toast.success("Navigated to ObjectId filter");
  }, [objectIdJump, quickFilter]);

  const handleAnalyzeQuery = useCallback(async () => {
    try {
      const adapter = new MongoDBAdapter(connectionId);
      const filter = documentFilter?.mode === "query" ? documentFilter.mongoQuery ?? {} : {};
      const explain = await adapter.runCommand({
        explain: {
          find: collection,
          filter,
          sort: undefined,
        },
      });

      const explainText = JSON.stringify(explain);
      if (explainText.includes("COLLSCAN")) {
        setPlanHint("Collection scan detected. Add index for current filter/sort fields.");
      } else if (explainText.includes("IXSCAN")) {
        setPlanHint("Index scan detected. Query path is index-backed.");
      } else {
        setPlanHint("Query analyzed. Inspect explain details for scan stage.");
      }
    } catch (error) {
      setPlanHint("Explain analysis failed.");
      logger.error("document-grid", "Explain analysis failed", error);
    }
  }, [collection, connectionId, documentFilter]);

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
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => {
            openCollectionDesigner({
              connectionId,
              database,
            });
          }}
        >
          <IconPlus className="h-3.5 w-3.5 mr-1" />
          New Collection
        </Button>
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
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">Depth</span>
          <Input
            type="number"
            min={1}
            max={6}
            value={flattenDepth}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (!Number.isNaN(value)) {
                setFlattenDepth(Math.min(6, Math.max(1, value)));
              }
            }}
            className="h-7 w-16 text-[11px]"
          />
        </div>

        <div className="flex items-center gap-1">
          <select
            className="h-7 rounded border bg-background px-2 text-[11px]"
            value=""
            onChange={(event) => {
              handleApplyView(event.target.value);
            }}
          >
            <option value="">Open view…</option>
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={handleSaveView}
          >
            Save View
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Input
            value={objectIdJump}
            onChange={(event) => {
              setObjectIdJump(event.target.value);
            }}
            placeholder="ObjectId"
            className="h-7 w-44 text-[11px]"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={handleJumpToObjectId}
          >
            <IconChevronRight className="h-3.5 w-3.5 mr-1" />
            Jump
          </Button>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => void handleAnalyzeQuery()}
        >
          <IconBrackets className="h-3.5 w-3.5 mr-1" />
          Explain
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => {
            quickFilter.setMode("search");
            toast.message("AI helper", {
              description:
                "Describe your desired filter in the AI panel, then paste the generated Mongo query here.",
            });
          }}
        >
          <IconSparkles className="h-3.5 w-3.5 mr-1" />
          AI Filter
        </Button>
      </div>

      {planHint && (
        <div className="text-[11px] px-2 py-1 rounded border bg-muted/40 text-muted-foreground">
          {planHint}
        </div>
      )}

      {data.schemaSample && data.schemaSample.fields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.schemaSample.fields.slice(0, 8).map((field) => (
            <Badge key={field.path} variant="outline" className="text-[10px] font-mono">
              {field.path} ({field.occurrences})
            </Badge>
          ))}
        </div>
      )}
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
            size="sm"
            variant="outline"
            className="h-7 text-[11px] shrink-0"
            onClick={() => {
              setShowInspector((prev) => !prev);
            }}
          >
            {showInspector ? (
              <IconLayoutSidebarRightCollapse className="h-3.5 w-3.5 mr-1" />
            ) : (
              <IconLayoutSidebarRightExpand className="h-3.5 w-3.5 mr-1" />
            )}
            Inspector
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => {
              setShowInspector((prev) => !prev);
            }}
          >
            {showInspector ? (
              <IconLayoutSidebarRightCollapse className="h-3.5 w-3.5 mr-1" />
            ) : (
              <IconLayoutSidebarRightExpand className="h-3.5 w-3.5 mr-1" />
            )}
            Inspector
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

export default DocumentDataGrid;
