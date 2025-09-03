import React, { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Table, Bolt, BookMarked, Zap, Download } from "lucide-react";
import { GlideTableDataGrid } from "@/components/DataGrid/glide/GlideTableDataGrid";
import { TableStructure } from "@/components/DataGrid/TableStructure";
import { TableIndexes } from "@/components/DataGrid/TableIndexes";

interface PanelContentRendererProps {
  tabId: string;
  metadata?: any;
}

export const PanelContentRenderer: React.FC<PanelContentRendererProps> = ({
  tabId,
  metadata,
}) => {
  const [type] = tabId.split("-");
  const [activeView, setActiveView] = useState(metadata?.viewType || "data");

  if (type === "query") {
    return (
      <div className="p-4 h-full">
        <h3 className="text-lg font-semibold mb-2">Query Editor</h3>
        <p className="text-muted-foreground">Query panel placeholder</p>
        {metadata?.query && (
          <pre className="mt-4 p-2 bg-muted rounded text-sm">
            {metadata.query}
          </pre>
        )}
      </div>
    );
  }

  if (type === "table" && metadata) {
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
              </TabsList>
            </Tabs>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2 py-0"
              onClick={() => {}}
            >
              <Download className="h-3 w-3 mr-1" />
              Export
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeView === "data" && (
            <GlideTableDataGrid
              connectionId={metadata.connectionId}
              database={metadata.database}
              schema={metadata.schema}
              table={metadata.table}
              className="h-full"
            />
          )}

          {activeView === "structure" && (
            <TableStructure
              connectionId={metadata.connectionId}
              database={metadata.database}
              schema={metadata.schema}
              table={metadata.table}
            />
          )}

          {activeView === "indexes" && (
            <TableIndexes
              connectionId={metadata.connectionId}
              database={metadata.database}
              schema={metadata.schema}
              table={metadata.table}
            />
          )}

          {activeView === "triggers" && (
            <div className="p-4">
              <p className="text-muted-foreground">
                Triggers view coming soon...
              </p>
            </div>
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
};
