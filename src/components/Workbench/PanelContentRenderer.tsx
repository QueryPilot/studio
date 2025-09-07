import React, { useState, useRef, memo, useCallback } from "react";
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

interface PanelContentRendererProps {
  tabId: string;
  metadata?: any;
}

export const PanelContentRenderer: React.FC<PanelContentRendererProps> = memo(({
  tabId,
  metadata,
}) => {
  const activeConnectionId = useConnectionStore(state => state.activeConnectionId);
  const [type] = tabId.split("-");
  const [activeView, setActiveView] = useState(metadata?.viewType || "data");
  const definitionRef = useRef<string>("");

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

  if (type === "query") {
    return (
      <QueryPanel
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

  if (type === "table" && metadata) {
    const isView = metadata.isView || false;
    const isMaterializedView = metadata.kind === "MaterializedView";
    const isRegularView = isView && !isMaterializedView;

    return (
      <div className="flex flex-col h-full">
        {/* Table Toolbar */}
        <div className="flex-none border-b bg-background h-8">
          <div className="flex items-center justify-between px-1 h-full">
            <Tabs value={activeView} onValueChange={setActiveView}>
              <TabsList className="h-6 p-0.5">
                <TabsTrigger
                  value="data"
                  className="gap-1 text-xs h-5 px-2 py-0"
                >
                  <Table className="h-3 w-3" />
                  Data
                </TabsTrigger>
                <TabsTrigger
                  value="structure"
                  className="gap-1 text-xs h-5 px-2 py-0"
                >
                  <Bolt className="h-3 w-3" />
                  Structure
                </TabsTrigger>

                {/* Regular views: only show Definition tab */}
                {isRegularView && (
                  <TabsTrigger
                    value="definition"
                    className="gap-1 text-xs h-5 px-2 py-0"
                  >
                    <Code className="h-3 w-3" />
                    Definition
                  </TabsTrigger>
                )}

                {/* Tables: show Indexes, Triggers and Definition */}
                {!isView && (
                  <>
                    <TabsTrigger
                      value="indexes"
                      className="gap-1 text-xs h-5 px-2 py-0"
                    >
                      <BookMarked className="h-3 w-3" />
                      Indexes
                    </TabsTrigger>
                    <TabsTrigger
                      value="triggers"
                      className="gap-1 text-xs h-5 px-2 py-0"
                    >
                      <Zap className="h-3 w-3" />
                      Triggers
                    </TabsTrigger>
                    <TabsTrigger
                      value="definition"
                      className="gap-1 text-xs h-5 px-2 py-0"
                    >
                      <Code className="h-3 w-3" />
                      Definition
                    </TabsTrigger>
                  </>
                )}

                {/* Materialized Views: show Indexes only (no triggers) */}
                {isMaterializedView && (
                  <TabsTrigger
                    value="indexes"
                    className="gap-1 text-xs h-5 px-2 py-0"
                  >
                    <BookMarked className="h-3 w-3" />
                    Indexes
                  </TabsTrigger>
                )}

                {/* Materialized views also get Definition tab */}
                {isMaterializedView && (
                  <TabsTrigger
                    value="definition"
                    className="gap-1 text-xs h-5 px-2 py-0"
                  >
                    <Code className="h-3 w-3" />
                    Definition
                  </TabsTrigger>
                )}
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-1">
              {activeView === "definition" && (
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
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeView === "data" && (
            <GlideTableDataGrid
              connectionId={activeConnectionId || metadata.connectionId}
              database={metadata.database}
              schema={metadata.schema}
              table={metadata.table}
              className="h-full"
            />
          )}

          {activeView === "structure" && (
            <TableStructure
              connectionId={activeConnectionId || metadata.connectionId}
              database={metadata.database}
              schema={metadata.schema}
              table={metadata.table}
            />
          )}

          {activeView === "indexes" && (
            <TableIndexes
              connectionId={activeConnectionId || metadata.connectionId}
              database={metadata.database}
              schema={metadata.schema}
              table={metadata.table}
            />
          )}

          {activeView === "triggers" && (
            <TableTriggers
              connectionId={activeConnectionId || metadata.connectionId}
              database={metadata.database}
              schema={metadata.schema}
              table={metadata.table}
            />
          )}

          {activeView === "definition" && (
            <ObjectDefinition
              connectionId={activeConnectionId || metadata.connectionId}
              database={metadata.database}
              schema={metadata.schema}
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
          )}
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
});

PanelContentRenderer.displayName = "PanelContentRenderer";
