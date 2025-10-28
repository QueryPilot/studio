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
  Table,
  Bolt,
  BookMarked,
  Zap,
  Code,
  Copy,
  ClipboardCheck,
} from "lucide-react";
import { TableDataGridV2 } from "@/components/DataGridV2";
import { TableStructure } from "@/components/TableStructure";
import { TableIndexes } from "@/components/TableIndexes";
import { TableTriggers } from "@/components/TableTriggers";
import { ObjectDefinition } from "@/components/ObjectDefinition";
import { QueryPanel } from "@/components/QueryPanel";
import { useConnectionStore } from "@/stores/connectionStore";
import { Skeleton } from "../ui/skeleton";
import { type TabMetadata } from "@/types/workbench";
import { ERDPanel } from "@/components/Erd";
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
    const activeConnectionId = useConnectionStore(
      (state) => state.activeConnectionId,
    );
    const type = metadata?.type || "table";
    const [activeView, setActiveView] = useState(metadata?.viewType || "data");
    const definitionRef = useRef<string>("");
    const [viewActions, setViewActions] = useState<React.ReactNode>(null);
    const [copied, setCopied] = useState(false);

    const handleDefinitionLoad = useCallback((def: string) => {
      definitionRef.current = def;
    }, []);

    const handleCopy = async () => {
      if (activeView === "definition" && definitionRef.current) {
        try {
          await navigator.clipboard.writeText(definitionRef.current);
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 3000);
        } catch (err) {
          console.error("Failed to copy to clipboard:", err);
        }
      }
    };

    // Handle view actions for each tab
    const handleViewActionsChange = useCallback((actions: React.ReactNode) => {
      setViewActions(actions);
    }, []);

    // Keep local activeView in sync with metadata.viewType updates from outside (e.g., sidebar quick actions)
    useEffect(() => {
      if (metadata?.viewType && metadata.viewType !== activeView) {
        setActiveView(metadata.viewType);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [metadata?.viewType]);

    // Clear viewActions when switching tabs to prevent wrong buttons showing
    useEffect(() => {
      setViewActions(null);
    }, [activeView]);

    // Persist activeView changes back to metadata so other components can react
    const updateTabMetadata = useWorkbenchStore((s) => s.updateTabMetadata);
    useEffect(() => {
      if (!metadata) return;
      if (metadata.viewType !== activeView) {
        updateTabMetadata(panelId, tabId, { viewType: activeView });
      }
    }, [activeView, metadata, panelId, tabId, updateTabMetadata]);

    // Compute tableGridId unconditionally (before any early returns)
    // CRITICAL: Include panelId and tabId for proper tab isolation
    const tableGridId = useMemo(() => {
      if (!metadata || metadata.type !== "table") return undefined;
      const connection: string =
        typeof metadata.connectionId === "string" && metadata.connectionId
          ? metadata.connectionId
          : activeConnectionId || "unknown";
      const db: string = metadata.database || "";
      const schemaName: string = metadata.schema || "public";
      const tableName: string = metadata.table || "";
      // Include panelId and tabId to ensure each tab instance has isolated state
      return `table:${connection}:${db}:${schemaName}:${tableName}:${panelId}:${tabId}`;
    }, [activeConnectionId, metadata, panelId, tabId]);

    if (type === "query") {
      return (
        <QueryPanel
          panelId={panelId}
          tabId={tabId}
          initialSql={metadata?.sql}
          connectionId={metadata?.connectionId || ""}
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

    if (type === "table" && metadata) {
      const isView = metadata.isView || false;
      const isMaterializedView = metadata.kind === "MaterializedView";
      const isRegularView = isView && !isMaterializedView;
      return (
        <div className="flex flex-col h-full">
          {/* Table Toolbar */}
          <div className="flex-none py-1 bg-background">
            <div className="flex items-center justify-between px-1 h-full">
              <Tabs value={activeView} onValueChange={setActiveView}>
                <TabsList className="p-0.5">
                  <TabsTrigger
                    value="data"
                    className="flex items-center gap-1 text-xs px-2"
                  >
                    <Table className="h-3 w-3" />
                    <span>Data</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="structure"
                    className="flex items-center gap-1 text-xs px-2"
                  >
                    <Bolt className="h-3 w-3" />
                    <span>Structure</span>
                  </TabsTrigger>

                  {/* Regular views: only show Definition tab */}
                  {isRegularView && (
                    <TabsTrigger
                      value="definition"
                      className="flex items-center gap-1 text-xs px-2"
                    >
                      <Code className="h-3 w-3" />
                      <span>Definition</span>
                    </TabsTrigger>
                  )}

                  {/* Tables: show Indexes, Triggers and Definition */}
                  {!isView && (
                    <>
                      <TabsTrigger
                        value="indexes"
                        className="flex items-center gap-1 text-xs px-2"
                      >
                        <BookMarked className="h-3 w-3" />
                        <span>Indexes</span>
                      </TabsTrigger>
                      <TabsTrigger
                        value="triggers"
                        className="flex items-center gap-1 text-xs px-2"
                      >
                        <Zap className="h-3 w-3" />
                        <span>Triggers</span>
                      </TabsTrigger>
                      <TabsTrigger
                        value="definition"
                        className="flex items-center gap-1 text-xs px-2"
                      >
                        <Code className="h-3 w-3" />
                        <span>Definition</span>
                      </TabsTrigger>
                    </>
                  )}

                  {/* Materialized Views: show Indexes only (no triggers) */}
                  {isMaterializedView && (
                    <TabsTrigger
                      value="indexes"
                      className="flex items-center gap-1 text-xs px-2"
                    >
                      <BookMarked className="h-3 w-3" />
                      <span>Indexes</span>
                    </TabsTrigger>
                  )}

                  {/* Materialized views also get Definition tab */}
                  {isMaterializedView && (
                    <TabsTrigger
                      value="definition"
                      className="flex items-center gap-1 text-xs px-2"
                    >
                      <Code className="h-3 w-3" />
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
                      <ClipboardCheck className="h-3 w-3 mr-1" />
                    ) : (
                      <Copy className="h-3 w-3 mr-1" />
                    )}
                    Copy
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            <Suspense fallback={<TabLoadingSkeleton />}>
              {/* Render all tab contents but only show the active one */}
              <div
                className={`absolute inset-0 px-1 ${
                  activeView === "data" ? "block" : "hidden"
                }`}
              >
                <TableDataGridV2
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
                  onActionsChange={
                    activeView === "data" ? handleViewActionsChange : undefined
                  }
                />
              </div>

              <div
                className={`absolute inset-0 px-1 ${
                  activeView === "structure" ? "block" : "hidden"
                }`}
              >
                <TableStructure
                  connectionId={
                    activeConnectionId || metadata.connectionId || ""
                  }
                  database={metadata.database || ""}
                  schema={metadata.schema}
                  table={metadata.table || ""}
                  isView={isView}
                  kind={metadata.kind}
                  onActionsChange={
                    activeView === "structure"
                      ? handleViewActionsChange
                      : undefined
                  }
                />
              </div>

              <div
                className={`absolute inset-0 px-1 ${
                  activeView === "indexes" ? "block" : "hidden"
                }`}
              >
                <TableIndexes
                  connectionId={
                    activeConnectionId || metadata.connectionId || ""
                  }
                  database={metadata.database || ""}
                  schema={metadata.schema}
                  table={metadata.table || ""}
                  onActionsChange={
                    activeView === "indexes"
                      ? handleViewActionsChange
                      : undefined
                  }
                />
              </div>

              <div
                className={`absolute inset-0 px-1 ${
                  activeView === "triggers" ? "block" : "hidden"
                }`}
              >
                <TableTriggers
                  connectionId={
                    activeConnectionId || metadata.connectionId || ""
                  }
                  database={metadata.database || ""}
                  schema={metadata.schema}
                  table={metadata.table || ""}
                  onActionsChange={
                    activeView === "triggers"
                      ? handleViewActionsChange
                      : undefined
                  }
                />
              </div>
              <div
                className={`absolute inset-0 px-1 ${
                  activeView === "definition" ? "block" : "hidden"
                }`}
              >
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
