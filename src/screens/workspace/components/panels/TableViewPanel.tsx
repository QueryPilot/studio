import { memo, useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  Database,
  Key,
  Zap,
  Filter,
  Search,
  RefreshCw,
  Download,
} from "lucide-react";
import { useTableData } from "@/hooks/useTableData";

import type { TabState } from "@/types/workspaceScreen";

interface TableTabPayload {
  tableName: string;
  schema: string;
  database: string;
  isView?: boolean;
}

interface TableViewPanelProps {
  tab: TabState;
  connectionId: string;
  isActive: boolean;
  onUpdate: (updates: Partial<TabState>) => void;
  onClose: () => void;
}

export const TableViewPanel = memo(function TableViewPanel({
  tab,
  connectionId,
  isActive: _isActive,
  onUpdate: _onUpdate,
  onClose: _onClose,
}: TableViewPanelProps) {
  const [activeTab, setActiveTab] = useState("data");
  const [searchQuery, setSearchQuery] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Extract payload data directly to avoid store mutation issues
  const payload = tab.payload as TableTabPayload;
  const tableName = payload.tableName || "Unknown Table";
  const schema = payload.schema || "public";
  const database = payload.database || "postgres";

  // Use TableDataService
  const {
    isLoading,
    isStreaming,
    error,
    columns: rawColumns,
    rows,
    hasNextPage,
    totalLoadedRows,
    loadData,
    loadMore,
    refresh,
    clearData,
  } = useTableData();

  // Load data when component mounts or table changes
  useEffect(() => {
    if (connectionId && tableName && tableName !== "Unknown Table") {
      void loadData({
        connectionId,
        database,
        table: tableName,
        schema: schema !== "public" ? schema : undefined,
        limit: 100,
      });
    }

    // Cleanup on unmount or table change
    return () => {
      clearData();
    };
    // Use primitive values as dependencies instead of payload object reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, database, tableName, schema]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      <div className="flex-none border-b bg-background p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">
              {schema}.{tableName}
            </h2>
            <p className="text-sm text-muted-foreground">
              Table • {rows.length.toLocaleString()} of{" "}
              {totalLoadedRows.toLocaleString()} loaded
              {hasNextPage && " (more available)"}
            </p>
            {error && (
              <p className="text-sm text-red-500 mt-1">Error: {error}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("h-3 w-3 mr-1", isLoading && "animate-spin")}
              />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => {}}>
              <Download className="h-3 w-3 mr-1" />
              Export
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="data" className="gap-1">
              <Table className="h-3 w-3" />
              Data
            </TabsTrigger>
            <TabsTrigger value="structure" className="gap-1">
              <Database className="h-3 w-3" />
              Structure
            </TabsTrigger>
            <TabsTrigger value="indexes" className="gap-1">
              <Key className="h-3 w-3" />
              Indexes
            </TabsTrigger>
            <TabsTrigger value="triggers" className="gap-1">
              <Zap className="h-3 w-3" />
              Triggers
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-0">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsContent value="data" className="h-full flex flex-col">
            <div className="flex-none p-3 border-b">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Search data..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                    }}
                    className="pl-7"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowPreview(!showPreview);
                  }}
                >
                  <Filter className="h-3 w-3 mr-1" />
                  Preview
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 h-full overflow-scroll">
              <pre className="text-xs overflow-scroll max-h-screen w-full">
                {JSON.stringify(rows, null, 2)}
              </pre>
            </div>
          </TabsContent>

          <TabsContent value="structure" className="h-full p-4">
            <div className="text-center text-muted-foreground py-8">
              <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Table structure view coming soon</p>
            </div>
          </TabsContent>

          <TabsContent value="indexes" className="h-full p-4">
            <div className="text-center text-muted-foreground py-8">
              <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Indexes & constraints view coming soon</p>
            </div>
          </TabsContent>

          <TabsContent value="triggers" className="h-full p-4">
            <div className="text-center text-muted-foreground py-8">
              <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Triggers view coming soon</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
});
