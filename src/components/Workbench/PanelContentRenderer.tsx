import { logger } from "@/lib/logger";
import React, {
  useState,
  useRef,
  memo,
  useCallback,
  Suspense,
  useMemo,
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
} from "@tabler/icons-react";
import { TableDataGrid } from "@/components/DataGrid";
import { TableStructure } from "@/components/TableStructure";
import { TableIndexes } from "@/components/TableIndexes";
import { TableTriggers } from "@/components/TableTriggers";
import { ObjectDefinition } from "@/components/ObjectDefinition";
import { QueryPanel } from "@/components/QueryPanel";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { Skeleton } from "../ui/skeleton";
import { type TabMetadata } from "@/types/workbench";
import { ERDPanel } from "@/components/Erd";
import { TableDesigner } from "@/components/TableDesigner";
import useWorkbenchStore from "@/stores/workbenchStore";

interface PanelContentRendererProps {
  panelId: string;
  tabId: string;
  metadata?: TabMetadata;
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
    const focusedPanelId = useWorkbenchStore((state) => state.focusedPanelId);
    const isPanelFocused = focusedPanelId === panelId;
    const type = metadata?.type || "table";
    const [activeView, setActiveView] = useState(metadata?.viewType || "data");
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
          await navigator.clipboard.writeText(definitionRef.current);
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

    // Clear viewActions when switching tabs to prevent wrong buttons showing
    useEffect(() => {
      setViewActions(null);
    }, [activeView]);

    // Persist activeView changes back to metadata so other components can react
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
    }, [activeView, metadata, panelId, tabId, updateTabMetadata]);

    // Compute tableGridId unconditionally (before any early returns)
    // Key by connection:schema:table so preferences persist across tabs/sessions
    const tableGridId = useMemo(() => {
      if (!metadata || metadata.type !== "table") return undefined;
      const connection: string =
        typeof metadata.connectionId === "string" && metadata.connectionId
          ? metadata.connectionId
          : activeConnectionId || "unknown";
      const schemaName: string = metadata.schema || "public";
      const tableName: string = metadata.table || "";
      return `table:${connection}:${schemaName}:${tableName}`;
    }, [activeConnectionId, metadata]);

    if (type === "query") {
      return (
        <QueryPanel
          panelId={panelId}
          tabId={tabId}
          initialSql={metadata?.sql}
          connectionId={metadata?.connectionId || activeConnectionId || ""}
          database={metadata?.database || ""}
          schema={metadata?.schema}
          dbType={(() => {
            const m = metadata as unknown as { dbType?: unknown } | undefined;
            return typeof m?.dbType === "string" ? m.dbType : "";
          })()}
          className="h-full"
        />
      );
    }

    if (type === "function" && metadata) {
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
          objectType="function"
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
          connectionId={metadata?.connectionId || activeConnectionId || ""}
          database={metadata?.database || ""}
          schema={metadata?.schema}
          className="h-full"
          onSave={(tableName, columns) => {
            // TODO: Execute CREATE TABLE SQL
            logger.info("Create table:", tableName, columns);
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
          <div className="flex-none pb-1 pt-1.5 bg-background">
            <div className="flex items-center justify-between px-1 h-full">
              <Tabs
                value={activeView}
                onValueChange={setActiveView}
                enableShortcuts={true}
                tabGroupId={`table-views-${tabId}`}
                focused={isPanelFocused}
              >
                <TabsList>
                  <TabsTrigger
                    value="data"
                    tabIndex={0}
                  >
                    <IconTable />
                    <span>Data</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="structure"
                    tabIndex={1}
                  >
                    <IconAssembly />
                    <span>Structure</span>
                  </TabsTrigger>

                  {/* Regular views: only show Definition tab */}
                  {isRegularView && (
                    <TabsTrigger
                      value="definition"
                      tabIndex={2}
                    >
                      <IconCode />
                      <span>Definition</span>
                    </TabsTrigger>
                  )}

                  {/* Tables: show Indexes, Triggers and Definition */}
                  {!isView && (
                    <>
                      <TabsTrigger
                        value="indexes"
                        tabIndex={2}
                      >
                        <IconBookmark />
                        <span>Indexes</span>
                      </TabsTrigger>
                      <TabsTrigger
                        value="triggers"
                        tabIndex={3}
                      >
                        <IconBolt />
                        <span>Triggers</span>
                      </TabsTrigger>
                      <TabsTrigger
                        value="definition"
                        tabIndex={4}
                      >
                        <IconCode />
                        <span>Definition</span>
                      </TabsTrigger>
                    </>
                  )}

                  {/* Materialized Views: show Indexes only (no triggers) */}
                  {isMaterializedView && (
                    <TabsTrigger
                      value="indexes"
                      tabIndex={2}
                    >
                      <IconBookmark />
                      <span>Indexes</span>
                    </TabsTrigger>
                  )}

                  {/* Materialized views also get Definition tab */}
                  {isMaterializedView && (
                    <TabsTrigger
                      value="definition"
                      tabIndex={3}
                    >
                      <IconCode />
                      Definition
                    </TabsTrigger>
                  )}
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-1">
                {/* View-specific actions */}
                {viewActions}
                {/* Definition view copy button */}
                {activeView === "definition" && !viewActions && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs px-2 py-0"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <IconClipboardCheck className="h-3 w-3 mr-1" />
                    ) : (
                      <IconCopy className="h-3 w-3 mr-1" />
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
                  <TableDataGrid
                    mode="table"
                    gridId={tableGridId ?? `table:${tabId}`}
                    connectionId={
                      activeConnectionId || metadata.connectionId || ""
                    }
                    database={metadata.database || ""}
                    schema={metadata.schema}
                    table={metadata.table || ""}
                    isView={isView}
                    kind={metadata.kind}
                    className="h-full"
                    onActionsChange={handleViewActionsChange}
                    initialFilter={metadata.initialFilter as string | undefined}
                    panelId={panelId}
                  />
                )}

                {activeView === "structure" && (
                  <TableStructure
                    connectionId={
                      activeConnectionId || metadata.connectionId || ""
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
                      activeConnectionId || metadata.connectionId || ""
                    }
                    database={metadata.database || ""}
                    schema={metadata.schema}
                    table={metadata.table || ""}
                    onActionsChange={handleViewActionsChange}
                  />
                )}

                {activeView === "triggers" && (
                  <TableTriggers
                    connectionId={
                      activeConnectionId || metadata.connectionId || ""
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
                      activeConnectionId || metadata.connectionId || ""
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
