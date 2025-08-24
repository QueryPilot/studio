import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import {
  Search,
  Table,
  Eye,
  FunctionSquare,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePanelStore } from "@/stores/panelStore";
import {
  databaseService,
  type TableMeta,
  type FunctionMeta,
} from "@/services/databaseService";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DatabaseSidebarProps {
  connectionId: string;
  isLoading?: boolean;
  selectedDatabase: string;
  selectedSchema: string;
}

interface SchemaData {
  tables: TableMeta[];
  views: TableMeta[];
  functions: FunctionMeta[];
}

export function DatabaseSidebar({
  connectionId,
  isLoading: initialLoading,
  selectedDatabase,
  selectedSchema,
}: DatabaseSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemaData, setSchemaData] = useState<SchemaData>({
    tables: [],
    views: [],
    functions: [],
  });

  const { getPrimaryPanel, addTabToPanel, setActiveTabInPanel } =
    usePanelStore();

  // Load schema data when schema changes
  useEffect(() => {
    if (selectedSchema && selectedDatabase) {
      void loadSchemaData();
    }
  }, [selectedSchema, selectedDatabase]);


  const loadSchemaData = async () => {
    try {
      setIsLoadingData(true);
      setError(null);

      // Load tables and functions in parallel
      const [tables, functions] = await Promise.all([
        databaseService.listTables(
          connectionId,
          selectedDatabase,
          selectedSchema,
        ),
        databaseService
          .listFunctions(connectionId, selectedDatabase, selectedSchema)
          .catch(() => []),
      ]);

      // Separate tables and views
      const tableList = tables.filter((t) => t.kind === "Table");
      const viewList = tables.filter(
        (t) => t.kind === "View" || t.kind === "MaterializedView",
      );

      setSchemaData({
        tables: tableList,
        views: viewList,
        functions,
      });

      // Auto-expand tables if there are items
      if (tableList.length > 0) {
        setExpandedNodes((prev) => new Set([...prev, "tables"]));
      }
    } catch (err) {
      console.error("Failed to load schema data:", err);
      setError("Failed to load schema objects");
    } finally {
      setIsLoadingData(false);
    }
  };

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const handleTableClick = (table: TableMeta) => {
    const primaryPanel = getPrimaryPanel();
    if (!primaryPanel) return;

    // Check if table tab already exists
    const existingTab = Array.from(primaryPanel.tabs.values()).find(
      (tab) =>
        tab.type === "table" &&
        tab.payload?.tableName === table.name &&
        tab.payload?.schema === table.schema,
    );

    if (existingTab) {
      // If tab exists, just activate it
      setActiveTabInPanel(primaryPanel.id, existingTab.id);
    } else {
      // Create new table tab
      addTabToPanel(primaryPanel.id, {
        type: "table",
        connectionId,
        title: table.name,
        payload: {
          database: selectedDatabase,
          schema: table.schema,
          tableName: table.name,
          isView: table.kind !== "Table",
        },
      });
    }
  };

  const handleFunctionClick = (func: FunctionMeta) => {
    const primaryPanel = getPrimaryPanel();
    if (!primaryPanel) return;

    // Check if function tab already exists
    const existingTab = Array.from(primaryPanel.tabs.values()).find(
      (tab) =>
        tab.type === "function" &&
        tab.payload?.functionName === func.name &&
        tab.payload?.schema === func.schema,
    );

    if (existingTab) {
      setActiveTabInPanel(primaryPanel.id, existingTab.id);
    } else {
      // Create new function tab
      addTabToPanel(primaryPanel.id, {
        type: "function",
        connectionId,
        title: func.name,
        payload: {
          database: selectedDatabase,
          schema: func.schema,
          functionName: func.name,
        },
      });
    }
  };

  const handleRefresh = async () => {
    // Refresh schema data
    if (selectedDatabase && selectedSchema) {
      await loadSchemaData();
    }
  };

  // Filter items based on search
  const filterItems = <T extends { name: string }>(items: T[]): T[] => {
    if (!searchQuery) return items;
    return items.filter((item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  };

  if (initialLoading) {
    return (
      <div className="flex flex-col h-full p-2 space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search Input and Refresh */}
      <div className="p-2 border-b">
        <div className="flex gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search objects..."
              className="pl-7 h-8 text-sm"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={handleRefresh}
            disabled={isLoadingData}
            title="Refresh"
          >
            <RefreshCw
              className={cn("h-4 w-4", isLoadingData && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-2 py-1">
          <div className="flex items-center gap-2 text-xs text-red-500">
            <AlertCircle className="h-3 w-3" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Object Tree */}
      <div className="flex-1 overflow-y-auto relative">
        <div>
          {/* Tables Section */}
          {(schemaData.tables.length > 0 || isLoadingData) && (
            <div>
              <div className="sticky top-0 bg-background z-30">
                <button
                  className="flex items-center gap-1.5 w-full text-left bg-muted/50 p-1.5 rounded text-sm backdrop-blur-md"
                  onClick={() => {
                    toggleNode("tables");
                  }}
                >
                  {expandedNodes.has("tables") ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="font-medium">Tables</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {schemaData.tables.length}
                  </span>
                </button>
              </div>
              {expandedNodes.has("tables") && (
                <div className="ml-5 mt-0.5 space-y-0.5 px-2">
                  {filterItems(schemaData.tables).map((table) => (
                    <div
                      key={`${table.schema}.${table.name}`}
                      className="flex items-center gap-1.5 p-1 hover:bg-muted/50 rounded cursor-pointer"
                      onClick={() => {
                        handleTableClick(table);
                      }}
                    >
                      <Table className="h-3.5 w-4 min-w-4 text-blue-500" />
                      <span className="text-sm">{table.name}</span>
                      {!!table.row_estimate && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          ~{table.row_estimate.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Views Section */}
          {schemaData.views.length > 0 && (
            <div>
              <div className="sticky top-0 bg-background z-20">
                <button
                  className="flex items-center gap-1.5 w-full text-left bg-muted/50 p-1.5 rounded text-sm backdrop-blur-md"
                  onClick={() => {
                    toggleNode("views");
                  }}
                >
                  {expandedNodes.has("views") ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="font-medium">Views</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {schemaData.views.length}
                  </span>
                </button>
              </div>
              {expandedNodes.has("views") && (
                <div className="ml-5 mt-0.5 space-y-0.5 px-2">
                  {filterItems(schemaData.views).map((view) => (
                    <div
                      key={`${view.schema}.${view.name}`}
                      className="flex items-center gap-1.5 p-1 hover:bg-muted/50 rounded cursor-pointer"
                      onClick={() => {
                        handleTableClick(view);
                      }}
                    >
                      <Eye className="h-4 min-h-4 w-4 min-w-4 text-green-500" />
                      <span className="text-sm">{view.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Functions Section */}
          {schemaData.functions.length > 0 && (
            <div>
              <div className="sticky top-0 bg-background z-10">
                <button
                  className="flex items-center gap-1.5 w-full text-left bg-muted/50 p-1.5 rounded text-sm backdrop-blur-md"
                  onClick={() => {
                    toggleNode("functions");
                  }}
                >
                  {expandedNodes.has("functions") ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="font-medium">Functions</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {schemaData.functions.length}
                  </span>
                </button>
              </div>
              {expandedNodes.has("functions") && (
                <div className="ml-5 mt-0.5 space-y-0.5 px-2">
                  {filterItems(schemaData.functions).map((func) => (
                    <div
                      key={`${func.schema}.${func.name}`}
                      className="flex items-center gap-1.5 p-1 hover:bg-muted/50 rounded cursor-pointer"
                      onClick={() => {
                        handleFunctionClick(func);
                      }}
                    >
                      <FunctionSquare className="h-3.5 w-4 min-w-4 text-purple-500" />
                      <span className="text-sm">{func.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!isLoadingData &&
            schemaData.tables.length === 0 &&
            schemaData.views.length === 0 &&
            schemaData.functions.length === 0 && (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">
                  {selectedSchema ? "No objects found" : "Select a schema"}
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
