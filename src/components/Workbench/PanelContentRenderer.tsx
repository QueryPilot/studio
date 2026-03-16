import { logger } from "@/lib/logger";
import React, {
  useState,
  useRef,
  memo,
  useCallback,
  Suspense,
  useEffect,
} from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  IconTable,
  IconBolt,
  IconBookmark,
  IconCode,
  IconCopy,
  IconClipboardCheck,
  IconAssembly,
  IconLayoutGrid,
} from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import { SqlDataGrid, KeyValueDataGrid } from "@/components/DataGrid";
import { TableStructure } from "@/components/TableStructure";
import { TableIndexes } from "@/components/TableIndexes";
import { TableTriggers } from "@/components/TableTriggers";
import { TablePartitions } from "@/components/TablePartitions";
import { ObjectDefinition } from "@/components/ObjectDefinition";
import { QueryPanel } from "@/components/QueryPanel";
import { MongoQueryPanel } from "@/components/MongoQueryPanel";
import { RedisCliPanel } from "@/components/RedisCliPanel";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { isMySQLCompatible, DbType, getDefaultSchema } from "@/types/connection";
import { Skeleton } from "../ui/skeleton";
import { type TabMetadata } from "@/types/workbench";
import { ERDPanel } from "@/components/Erd";
import { TableDesigner } from "@/components/TableDesigner";
import { CollectionDesigner } from "@/components/CollectionDesigner";
import { MongoCollectionWorkbench } from "@/components/MongoCollectionWorkbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { useTabStateStore } from "@/stores/tabStateStore";
import { FeatureErrorBoundary } from "@/components/FeatureErrorBoundary";
import { writeClipboardText } from "@/lib/clipboard";

interface PanelContentRendererProps {
  panelId: string;
  tabId: string;
  metadata?: TabMetadata;
}

/** Per-tab grid preferences key. Returns undefined when sync is ON (default). */
function perTabSortGridId(baseGridId: string, tabId: string, syncSort: boolean | undefined): string | undefined {
  return syncSort === false ? `${baseGridId}:::tab:::${tabId}` : undefined;
}

// Loading skeleton for tab content
const TabLoadingSkeleton = () => (
  <div className="h-full w-full p-4 space-y-3">
    <div className="flex gap-4">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-8 w-28" />
    </div>
    {Array.from({ length: 10 }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
);

export const PanelContentRenderer: React.FC<PanelContentRendererProps> = memo(
  ({ panelId, tabId, metadata }) => {
    const activeConnectionId = useWorkspaceSelectionStore(
      (state) => state.connectionId,
    );
    const getConnection = useConnectionStore((state) => state.getConnection);
    const isPanelFocused = usePanelFocusStore(
      useCallback(
        (state: { focusedPanelId: string | null }) => state.focusedPanelId === panelId,
        [panelId],
      ),
    );

    // Visibility guard: defer heavy content rendering to allow instant tab switching
    const [contentReady, setContentReady] = useState(false);

    useEffect(() => {
      setContentReady(false);
      let cancelled = false;
      // Use double-rAF to ensure we're past the first paint
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) {
            setContentReady(true);
          }
        });
      });
      return () => {
        cancelled = true;
      };
    }, [tabId]);

    // Get dbType from connection profile
    const connectionId = metadata?.connectionId || activeConnectionId || "";
    const connection = getConnection(connectionId);
    const dbType = connection?.profile.db_type;
    const type = metadata?.type || "table";

    // For table tabs, load/persist viewType to tabStateStore
    const loadTabStateAsync = useTabStateStore((state) => state.loadTabStateAsync);
    const setQueryState = useTabStateStore((state) => state.setQueryState);
    const persistedTableViewType = useTabStateStore(
      (state) => state.queryStates.get(tabId)?.tableViewType,
    );

    // Load persisted state on mount (for table tabs)
    useEffect(() => {
      if (type === "table") {
        void loadTabStateAsync(tabId);
      }
    }, [tabId, type, loadTabStateAsync]);

    const [activeView, setActiveView] = useState(() => {
      // First check for persisted table view type
      if (type === "table" && persistedTableViewType) {
        return persistedTableViewType;
      }
      return metadata?.viewType || "data";
    });
    const definitionRef = useRef<string>("");
    const [viewActions, setViewActions] = useState<React.ReactNode>(null);
    const [copied, setCopied] = useState(false);
    const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup copy timeout on unmount
    useEffect(() => {
      return () => {
        if (copyTimeoutRef.current) {
          clearTimeout(copyTimeoutRef.current);
        }
      };
    }, []);

    const handleDefinitionLoad = useCallback((def: string) => {
      definitionRef.current = def;
    }, []);

    const handleCopy = async () => {
      if (activeView === "definition" && definitionRef.current) {
        try {
          await writeClipboardText(definitionRef.current);
          setCopied(true);
          if (copyTimeoutRef.current) {
            clearTimeout(copyTimeoutRef.current);
          }
          copyTimeoutRef.current = setTimeout(() => {
            setCopied(false);
          }, 3000);
        } catch (err) {
          logger.error("Failed to copy to clipboard:", err);
        }
      }
    };

    // Handle view actions for each tab
    const handleViewActionsChange = useCallback((actions: React.ReactNode) => {
      setViewActions(actions);
    }, []);

    // Track if we're updating from external source to prevent loops
    const isExternalUpdate = useRef(false);
    const updateTabMetadata = useWorkbenchStore((s) => s.updateTabMetadata);

    // Keep local activeView in sync with metadata.viewType updates from outside (e.g., sidebar quick actions)
    useEffect(() => {
      if (metadata?.viewType && metadata.viewType !== activeView) {
        isExternalUpdate.current = true;
        setActiveView(metadata.viewType);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [metadata?.viewType]);

    // Sync from persisted state when it loads (for table tabs)
    // Note: activeView is intentionally excluded from deps - we only want to sync
    // when persistedTableViewType first loads, not when user changes activeView
    useEffect(() => {
      if (type === "table" && persistedTableViewType && persistedTableViewType !== activeView) {
        isExternalUpdate.current = true;
        setActiveView(persistedTableViewType);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persistedTableViewType, type]);

    // Clear viewActions when switching tabs to prevent wrong buttons showing
    useEffect(() => {
      setViewActions(null);
    }, [activeView]);

    // Persist activeView changes back to metadata and tabStateStore
    useEffect(() => {
      if (!metadata) return;
      // Skip if this was an external update (from metadata -> activeView sync)
      if (isExternalUpdate.current) {
        isExternalUpdate.current = false;
        return;
      }
      if (metadata.viewType !== activeView) {
        updateTabMetadata(panelId, tabId, { viewType: activeView });
      }
      // Persist to tabStateStore for table tabs
      if (type === "table") {
        setQueryState(tabId, { tableViewType: activeView });
      }
    }, [activeView, metadata, panelId, tabId, updateTabMetadata, type, setQueryState]);

    // Show loading spinner until content is ready (enables instant tab switching)
    if (!contentReady) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (type === "query") {
      return (
        <FeatureErrorBoundary featureName="Query Panel">
          <QueryPanel
            panelId={panelId}
            tabId={tabId}
            initialSql={metadata?.sql}
            connectionId={metadata?.connectionId || activeConnectionId || ""}
            database={metadata?.database || ""}
            schema={metadata?.schema}
            dbType={dbType}
            className="h-full"
          />
        </FeatureErrorBoundary>
      );
    }

    if (type === "mongo-query") {
      return (
        <FeatureErrorBoundary featureName="MongoDB Shell">
          <MongoQueryPanel
            panelId={panelId}
            tabId={tabId}
            connectionId={metadata?.connectionId || activeConnectionId || ""}
            database={metadata?.database || ""}
            initialQuery={
              typeof metadata?.initialQuery === "string"
                ? metadata.initialQuery
                : undefined
            }
            className="h-full"
          />
        </FeatureErrorBoundary>
      );
    }

    if (type === "redis-cli") {
      return (
        <FeatureErrorBoundary featureName="Redis CLI">
          <RedisCliPanel
            panelId={panelId}
            tabId={tabId}
            connectionId={metadata?.connectionId || activeConnectionId || ""}
            database={parseInt(metadata?.database || "0", 10)}
            className="h-full"
          />
        </FeatureErrorBoundary>
      );
    }

    if (type === "mongo-collection" && metadata) {
      return (
        <FeatureErrorBoundary featureName="MongoDB Collection">
          <MongoCollectionWorkbench
            panelId={panelId}
            tabId={tabId}
            metadata={metadata}
            focused={isPanelFocused}
          />
        </FeatureErrorBoundary>
      );
    }

    // Redis Key Browser (using unified DataGrid)
    if (type === "redis-key" && metadata) {
      const redisGridId = `keyvalue:${metadata.connectionId || activeConnectionId}:${metadata.database}:${metadata.table || 'browser'}`;
      return (
        <FeatureErrorBoundary featureName="Redis Key">
          <KeyValueDataGrid
            gridId={redisGridId}
            connectionId={metadata.connectionId || activeConnectionId || ""}
            database={parseInt(metadata.database || "0", 10)}
            initialKey={metadata.table}
            className="h-full"
            focused={isPanelFocused}
            sortGridId={perTabSortGridId(redisGridId, tabId, metadata.syncSort)}
          />
        </FeatureErrorBoundary>
      );
    }

    if (type === "function" && metadata) {
      const objectType = (() => {
        const m = metadata as
          | { objectType?: unknown; returnType?: unknown }
          | undefined;
        if (m?.objectType === "procedure") return "procedure";
        if (m?.objectType === "function") return "function";
        if (m?.returnType === "void" && dbType && isMySQLCompatible(dbType)) {
          return "procedure";
        }
        return "function";
      })();
      return (
        <ObjectDefinition
          connectionId={metadata.connectionId || ""}
          database={metadata.database || ""}
          schema={metadata.schema || "public"}
          objectName={(() => {
            const m = metadata as unknown as
              | { functionName?: unknown }
              | undefined;
            return typeof m?.functionName === "string" ? m.functionName : "";
          })()}
          objectType={objectType}
          className="h-full"
          onDefinitionLoad={(def) => {
            definitionRef.current = def;
          }}
        />
      );
    }

    if (type === "erd") {
      return (
        <ERDPanel
          connectionId={metadata?.connectionId || activeConnectionId || ""}
          tabId={tabId}
          database={metadata?.database}
          schema={metadata?.schema}
        />
      );
    }

    if (type === "design") {
      return (
        <TableDesigner
          panelId={panelId}
          tabId={tabId}
          connectionId={metadata?.connectionId || activeConnectionId || ""}
          database={metadata?.database || ""}
          schema={metadata?.schema}
          dbType={dbType}
          className="h-full"
          onSave={(tableName, sql) => {
            const tableSchema = metadata?.schema || getDefaultSchema(dbType ?? DbType.PostgreSQL, metadata?.database) || "";
            const tableConnectionId =
              metadata?.connectionId || activeConnectionId || "";

            updateTabMetadata(panelId, tabId, {
              type: "table",
              title: tableName,
              table: tableName,
              schema: tableSchema,
              connectionId: tableConnectionId,
              database: metadata?.database || "",
              kind: "Table",
              isView: false,
              viewType: "data",
              objectKey: `table-${tableConnectionId}-${tableSchema}-${tableName}`,
              sql,
            });
          }}
        />
      );
    }

    if (type === "collection-design") {
      return (
        <CollectionDesigner
          panelId={panelId}
          tabId={tabId}
          connectionId={metadata?.connectionId || activeConnectionId || ""}
          database={metadata?.database || ""}
          className="h-full"
          onSave={(collectionName) => {
            const collectionConnectionId =
              metadata?.connectionId || activeConnectionId || "";
            const collectionDatabase = metadata?.database || "";
            updateTabMetadata(panelId, tabId, {
              type: "mongo-collection",
              title: collectionName,
              table: collectionName,
              connectionId: collectionConnectionId,
              database: collectionDatabase,
              schema: "",
              objectKey: `mongo-${collectionConnectionId}-${collectionDatabase}-${collectionName}`,
            });
          }}
        />
      );
    }

    if (type === "table" && metadata) {
      const isView = metadata.isView || false;
      const isMaterializedView = metadata.kind === "MaterializedView";
      const isRegularView = isView && !isMaterializedView;
      return (
        <div className="flex flex-col h-full">
          {/* IconTable Toolbar */}
          <div className="@container flex-none pb-1 pt-1.5 bg-background">
            <div className="flex items-center justify-between px-1 h-full">
              <Tabs
                value={activeView}
                onValueChange={setActiveView}
                enableShortcuts={true}
                tabGroupId={`table-views-${tabId}`}
                focused={isPanelFocused}
              >
                <TabsList>
                  <TabsTrigger value="data" tabIndex={0}>
                    <IconTable />
                    <span className="hidden @sm:inline">Data</span>
                  </TabsTrigger>
                  <TabsTrigger value="structure" tabIndex={1}>
                    <IconAssembly />
                    <span className="hidden @sm:inline">Structure</span>
                  </TabsTrigger>

                  {/* Regular views: only show Definition tab */}
                  {isRegularView && (
                    <TabsTrigger value="definition" tabIndex={2}>
                      <IconCode />
                      <span className="hidden @sm:inline">Definition</span>
                    </TabsTrigger>
                  )}

                  {/* Tables: show Indexes, Triggers, Partitions (MySQL only) and Definition */}
                  {!isView && (
                    <>
                      <TabsTrigger value="indexes" tabIndex={2}>
                        <IconBookmark />
                        <span className="hidden @sm:inline">Indexes</span>
                      </TabsTrigger>
                      <TabsTrigger value="triggers" tabIndex={3}>
                        <IconBolt />
                        <span className="hidden @sm:inline">Triggers</span>
                      </TabsTrigger>
                      {dbType && isMySQLCompatible(dbType) && (
                        <TabsTrigger value="partitions" tabIndex={4}>
                          <IconLayoutGrid />
                          <span className="hidden @sm:inline">Partitions</span>
                        </TabsTrigger>
                      )}
                      <TabsTrigger value="definition" tabIndex={dbType && isMySQLCompatible(dbType) ? 5 : 4}>
                        <IconCode />
                        <span className="hidden @sm:inline">Definition</span>
                      </TabsTrigger>
                    </>
                  )}

                  {/* Materialized Views: show Indexes only (no triggers) */}
                  {isMaterializedView && (
                    <TabsTrigger value="indexes" tabIndex={2}>
                      <IconBookmark />
                      <span className="hidden @sm:inline">Indexes</span>
                    </TabsTrigger>
                  )}

                  {/* Materialized views also get Definition tab */}
                  {isMaterializedView && (
                    <TabsTrigger value="definition" tabIndex={3}>
                      <IconCode />
                      <span className="hidden @sm:inline">Definition</span>
                    </TabsTrigger>
                  )}
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-1">
                {/* View-specific actions */}
                {viewActions}
                {/* Definition view copy button */}
                {activeView === "definition" && !viewActions && (
                  <Button variant="outline" onClick={handleCopy}>
                    {copied ? (
                      <IconClipboardCheck className="size-3.5!" />
                    ) : (
                      <IconCopy className="size-3.5!" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Content Area - Render only active tab for better performance */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            <Suspense fallback={<TabLoadingSkeleton />}>
              <div className="absolute inset-0 px-1">
                {activeView === "data" && (
                  <FeatureErrorBoundary featureName="Data Grid">
                    <SqlDataGrid
                      connectionId={
                        metadata.connectionId || activeConnectionId || ""
                      }
                      database={metadata.database || ""}
                      schema={metadata.schema}
                      table={metadata.table || ""}
                      dbType={dbType ?? DbType.PostgreSQL}
                      kind={metadata.kind}
                      className="h-full"
                      onActionsChange={handleViewActionsChange}
                      initialFilter={metadata.initialFilter as string | undefined}
                      panelId={panelId}
                      focused={isPanelFocused}
                      sortGridId={perTabSortGridId(
                        `${metadata.connectionId || activeConnectionId || ""}:${metadata.database || ""}:${metadata.schema}:${metadata.table || ""}`,
                        tabId,
                        metadata.syncSort,
                      )}
                    />
                  </FeatureErrorBoundary>
                )}

                {activeView === "structure" && (
                  <TableStructure
                    panelId={panelId}
                    tabId={tabId}
                    connectionId={
                      metadata.connectionId || activeConnectionId || ""
                    }
                    database={metadata.database || ""}
                    schema={metadata.schema}
                    table={metadata.table || ""}
                    isView={isView}
                    kind={metadata.kind}
                    onActionsChange={handleViewActionsChange}
                  />
                )}

                {activeView === "indexes" && (
                  <TableIndexes
                    connectionId={
                      metadata.connectionId || activeConnectionId || ""
                    }
                    database={metadata.database || ""}
                    schema={metadata.schema}
                    table={metadata.table || ""}
                    dbType={dbType}
                    onActionsChange={handleViewActionsChange}
                  />
                )}

                {activeView === "triggers" && (
                  <TableTriggers
                    connectionId={
                      metadata.connectionId || activeConnectionId || ""
                    }
                    database={metadata.database || ""}
                    schema={metadata.schema}
                    table={metadata.table || ""}
                    onActionsChange={handleViewActionsChange}
                  />
                )}

                {activeView === "partitions" && dbType && isMySQLCompatible(dbType) && (
                  <TablePartitions
                    connectionId={
                      metadata.connectionId || activeConnectionId || ""
                    }
                    database={metadata.database || ""}
                    schema={metadata.schema}
                    table={metadata.table || ""}
                    onActionsChange={handleViewActionsChange}
                  />
                )}

                {activeView === "definition" && (
                  <ObjectDefinition
                    connectionId={
                      metadata.connectionId || activeConnectionId || ""
                    }
                    database={metadata.database || ""}
                    schema={metadata.schema || "public"}
                    objectName={metadata.table || ""}
                    objectType={
                      isMaterializedView
                        ? "materialized_view"
                        : isView
                        ? "view"
                        : "table"
                    }
                    className="h-full"
                    onDefinitionLoad={handleDefinitionLoad}
                  />
                )}
              </div>
            </Suspense>
          </div>
        </div>
      );
    }

    return (
      <div className="p-4 h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>Select a table from the sidebar</p>
          <p className="text-xs mt-2">or create a new query</p>
        </div>
      </div>
    );
  },
);

PanelContentRenderer.displayName = "PanelContentRenderer";
