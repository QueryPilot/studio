import React, { useState, useRef, memo, useCallback, Suspense } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Table, Bolt, BookMarked, Zap, Code, Copy } from "lucide-react";
import { GlideTableDataGrid } from "@/components/DataGrid/glide/GlideTableDataGrid";
import { TableStructure } from "@/components/DataGrid/TableStructure";
import { TableIndexes } from "@/components/DataGrid/TableIndexes";
import { TableTriggers } from "@/components/DataGrid/TableTriggers";
import { ObjectDefinition } from "@/components/DataGrid/ObjectDefinition";
import { QueryPanel } from "@/components/QueryPanel";
import { useConnectionStore } from "@/stores/connectionStore";
import { Skeleton } from "../ui/skeleton";
import { type TabMetadata } from "@/types/workbench";
import { ERDPanel } from "@/components/Erd";

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

    const handleDefinitionLoad = useCallback((def: string) => {
      definitionRef.current = def;
    }, []);

    const handleCopy = async () => {
      if (activeView === "definition" && definitionRef.current) {
        try {
          await navigator.clipboard.writeText(definitionRef.current);
        } catch (err) {
          console.error("Failed to copy to clipboard:", err);
        }
      }
    };

    // Handle view actions for each tab
    const handleViewActionsChange = useCallback((actions: React.ReactNode) => {
      setViewActions(actions);
    }, []);

    if (type === "query") {
      return (
        <QueryPanel
          panelId={panelId}
          tabId={tabId}
          initialSql={metadata?.sql}
          connectionId={metadata?.connectionId || ""}
          database={metadata?.database || ""}
          schema={metadata?.schema}
          dbType={metadata?.dbType}
          className="h-full"
        />
      );
    }

    if (type === "function" && metadata) {
      return (
        <ObjectDefinition
          connectionId={metadata.connectionId}
          database={metadata.database}
          schema={metadata.schema}
          objectName={metadata.functionName}
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
      console.log(">>>", "metadata", metadata);
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
                    <Copy className="h-3 w-3 mr-1" />
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
                className={`absolute inset-0 ${
                  activeView === "data" ? "block" : "hidden"
                }`}
              >
                <GlideTableDataGrid
                  connectionId={activeConnectionId || metadata.connectionId}
                  database={metadata.database}
                  schema={metadata.schema}
                  table={metadata.table}
                  className="h-full"
                />
              </div>

              <div
                className={`absolute inset-0 ${
                  activeView === "structure" ? "block" : "hidden"
                }`}
              >
                <TableStructure
                  connectionId={activeConnectionId || metadata.connectionId}
                  database={metadata.database}
                  schema={metadata.schema}
                  table={metadata.table}
                  onActionsChange={activeView === "structure" ? handleViewActionsChange : undefined}
                />
              </div>

              <div
                className={`absolute inset-0 ${
                  activeView === "indexes" ? "block" : "hidden"
                }`}
              >
                <TableIndexes
                  connectionId={activeConnectionId || metadata.connectionId}
                  database={metadata.database}
                  schema={metadata.schema}
                  table={metadata.table}
                  onActionsChange={activeView === "indexes" ? handleViewActionsChange : undefined}
                />
              </div>

              <div
                className={`absolute inset-0 ${
                  activeView === "triggers" ? "block" : "hidden"
                }`}
              >
                <TableTriggers
                  connectionId={activeConnectionId || metadata.connectionId}
                  database={metadata.database}
                  schema={metadata.schema}
                  table={metadata.table}
                  onActionsChange={activeView === "triggers" ? handleViewActionsChange : undefined}
                />
              </div>
              <div
                className={`absolute inset-0 ${
                  activeView === "definition" ? "block" : "hidden"
                }`}
              >
                <ObjectDefinition
                  connectionId={activeConnectionId || metadata.connectionId}
                  database={metadata.database}
                  schema={metadata.schema || "public"}
                  objectName={metadata.table}
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
