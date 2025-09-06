import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
  Search,
  Table,
  Eye,
  FunctionSquare,
  RefreshCw,
  AlertCircle,
  Bolt,
  BookMarked,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePanelStore } from "@/stores/panelStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import { CustomScrollbar } from "@/components/CustomScrollbar";
import {
  databaseService,
  type TableMeta,
  type FunctionMeta,
} from "@/services/databaseService";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeListen } from "@/utils/tauri";
import {
  SidebarSection,
  SidebarItem,
  ActionButton,
} from "./DatabaseSidebarItem";

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

  const {
    getPrimaryPanel,
    addTabToPanel,
    setActiveTabInPanel,
    updateTabInPanel,
    panels,
    activePanelId,
  } = usePanelStore();

  const { focusedPanelId, panelContents } = useWorkbenchStore();

  const loadSchemaData = useCallback(async () => {
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

      // Deduplicate functions based on schema and name only (ignore overloads)
      const uniqueFunctions = functions.reduce((acc, func) => {
        const key = `${func.schema}.${func.name}`;
        if (!acc.some(f => `${f.schema}.${f.name}` === key)) {
          acc.push(func);
        }
        return acc;
      }, [] as FunctionMeta[]);

      setSchemaData({
        tables: tableList,
        views: viewList,
        functions: uniqueFunctions,
      });

      // Auto-expand tables if there are items
      if (tableList.length > 0) {
        setExpandedNodes(
          (prev) => new Set([...prev, "tables", "views", "functions"]),
        );
      }
    } catch (err) {
      console.error("Failed to load schema data:", err);
      setError("Failed to load schema objects");
    } finally {
      setIsLoadingData(false);
    }
  }, [connectionId, selectedDatabase, selectedSchema]);

  // Load schema data when schema changes
  useEffect(() => {
    if (selectedSchema && selectedDatabase) {
      void loadSchemaData();
    }
  }, [selectedSchema, selectedDatabase, loadSchemaData]);

  // Listen for database reconnection events
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      cleanup = await safeListen<{ connectionId: string }>(
        "database-reconnected",
        (event) => {
          if (
            event.payload.connectionId === connectionId &&
            selectedSchema &&
            selectedDatabase
          ) {
            void loadSchemaData();
          }
        },
      );
    };

    void setupListener();

    return () => {
      if (cleanup) cleanup();
    };
  }, [connectionId, selectedSchema, selectedDatabase, loadSchemaData]);

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const handleTableClick = (
    table: TableMeta,
    viewType: "data" | "structure" | "indexes" = "data",
  ) => {
    // Use workbench panel system
    const { focusedPanelId, addTab, panelContents, focusPanel } =
      useWorkbenchStore.getState();

    // Determine which panel to use
    let targetPanelId = focusedPanelId;

    if (!targetPanelId && panelContents.size > 0) {
      // No focused panel, pick the first available panel
      const firstPanelId = Array.from(panelContents.keys())[0];
      if (firstPanelId) {
        targetPanelId = firstPanelId;
        // Focus the panel we're going to use
        focusPanel(targetPanelId);
      }
    }

    if (targetPanelId) {
      const tabId = `table-${table.schema}-${table.name}`;
      addTab(targetPanelId, tabId, {
        type: "table",
        title: table.name,
        connectionId,
        database: selectedDatabase,
        schema: table.schema,
        table: table.name,
        isView: table.kind !== "Table",
        kind: table.kind,
        viewType,
      });
      return;
    }

    // Fallback to old panel system
    const primaryPanel = getPrimaryPanel();
    if (!primaryPanel) return;

    // Check if table tab already exists
    const existingTab = Array.from(primaryPanel.tabs.values()).find(
      (tab) =>
        tab.type === "table" &&
        tab.payload.tableName === table.name &&
        tab.payload.schema === table.schema,
    );

    if (existingTab) {
      // If tab exists, just activate it and set the view type
      setActiveTabInPanel(primaryPanel.id, existingTab.id);
      // Update the tab's active view and kind
      updateTabInPanel(primaryPanel.id, existingTab.id, {
        payload: {
          ...existingTab.payload,
          activeView: viewType,
          kind: table.kind,
        },
      });
    } else {
      // Create new table tab with specified view
      addTabToPanel(primaryPanel.id, {
        type: "table",
        connectionId,
        title: table.name,
        payload: {
          database: selectedDatabase,
          schema: table.schema,
          tableName: table.name,
          isView: table.kind !== "Table",
          kind: table.kind,
          activeView: viewType,
        },
      });
    }
  };

  const handleFunctionClick = (func: FunctionMeta) => {
    // Try new workbench system first
    const { focusedPanelId, addTab, panelContents, focusPanel } =
      useWorkbenchStore.getState();

    // Determine target panel
    let targetPanelId = focusedPanelId;
    if (!targetPanelId) {
      // If no focused panel, find the first panel
      const firstPanel = Array.from(panelContents.entries())[0];
      if (firstPanel) {
        targetPanelId = firstPanel[0];
        // Focus the panel we're going to use
        focusPanel(targetPanelId);
      }
    }

    if (targetPanelId) {
      const tabId = `function-${func.schema}-${func.name}`;
      addTab(targetPanelId, tabId, {
        type: "function",
        title: func.name,
        connectionId,
        database: selectedDatabase,
        schema: func.schema,
        functionName: func.name,
      });
      return;
    }

    // Fallback to old panel system
    const primaryPanel = getPrimaryPanel();
    if (!primaryPanel) return;

    // Check if function tab already exists
    const existingTab = Array.from(primaryPanel.tabs.values()).find(
      (tab) =>
        tab.type === "function" &&
        tab.payload.functionName === func.name &&
        tab.payload.schema === func.schema,
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

  // Check if a table/view is currently active in the active panel
  const isTableActive = (tableName: string, schema: string): boolean => {
    // First check workbench store (new system)
    if (focusedPanelId) {
      const focusedPanel = panelContents.get(focusedPanelId);
      if (focusedPanel && focusedPanel.activeTabId) {
        const metadata = focusedPanel.metadata?.[focusedPanel.activeTabId];
        if (
          metadata?.type === "table" &&
          metadata.table === tableName &&
          metadata.schema === schema
        ) {
          return true;
        }
      }
    }

    // Fallback to panel store (old system)
    const activePanel = panels.get(activePanelId);
    if (!activePanel || !activePanel.activeTabId) return false;

    const activeTab = activePanel.tabs.get(activePanel.activeTabId);
    if (!activeTab || activeTab.type !== "table") return false;

    return (
      activeTab.payload.tableName === tableName &&
      activeTab.payload.schema === schema
    );
  };

  // Check if a function is currently active in the active panel
  const isFunctionActive = (functionName: string, schema: string): boolean => {
    // First check workbench store (new system)
    if (focusedPanelId) {
      const focusedPanel = panelContents.get(focusedPanelId);
      if (focusedPanel && focusedPanel.activeTabId) {
        const [type, ...parts] = focusedPanel.activeTabId.split("-");
        if (type === "function") {
          const metadata = focusedPanel.metadata?.[focusedPanel.activeTabId];
          if (metadata?.schema === schema && parts.includes(functionName)) {
            return true;
          }
        }
      }
    }

    // Fallback to panel store (old system)
    const activePanel = panels.get(activePanelId);
    if (!activePanel || !activePanel.activeTabId) return false;

    const activeTab = activePanel.tabs.get(activePanel.activeTabId);
    if (!activeTab || activeTab.type !== "function") return false;

    return (
      activeTab.payload.functionName === functionName &&
      activeTab.payload.schema === schema
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
      <div className="p-1 border-b h-8">
        <div className="flex gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search objects..."
              className="pl-6 h-6 !text-xs"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={handleRefresh}
            disabled={isLoadingData}
            title="Refresh"
          >
            <RefreshCw
              className={cn("h-3 w-3", isLoadingData && "animate-spin")}
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
      <CustomScrollbar className="flex-1 relative min-h-0">
        <div className="pb-2 min-w-0">
          {/* Tables Section */}
          {(schemaData.tables.length > 0 || isLoadingData) && (
            <SidebarSection
              title="Tables"
              count={schemaData.tables.length}
              isExpanded={expandedNodes.has("tables")}
              onToggle={() => { toggleNode("tables"); }}
              stickyClass="sticky top-0 bg-background z-30"
            >
              {filterItems(schemaData.tables).map((table) => (
                <SidebarItem
                  key={`${table.schema}.${table.name}`}
                  icon={
                    <Table className="h-3.5 w-4 min-w-4 text-blue-500 flex-shrink-0" />
                  }
                  name={table.name}
                  isActive={isTableActive(table.name, table.schema)}
                  onClick={() => { handleTableClick(table, "data"); }}
                  rowCount={table.row_estimate}
                  actions={
                    <>
                      <ActionButton
                        icon={
                          <Bolt className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTableClick(table, "structure");
                        }}
                        title="View Structure"
                      />
                      <ActionButton
                        icon={
                          <BookMarked className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTableClick(table, "indexes");
                        }}
                        title="View Indexes"
                      />
                    </>
                  }
                />
              ))}
            </SidebarSection>
          )}

          {/* Views Section */}
          {schemaData.views.length > 0 && (
            <SidebarSection
              title="Views"
              count={schemaData.views.length}
              isExpanded={expandedNodes.has("views")}
              onToggle={() => { toggleNode("views"); }}
            >
              {filterItems(schemaData.views).map((view) => (
                <SidebarItem
                  key={`${view.schema}.${view.name}`}
                  icon={
                    <Eye
                      className={cn(
                        "h-4 min-h-4 w-4 min-w-4 flex-shrink-0",
                        view.kind === "MaterializedView"
                          ? "text-purple-500"
                          : "text-green-500",
                      )}
                    />
                  }
                  name={view.name}
                  isActive={isTableActive(view.name, view.schema)}
                  onClick={() => { handleTableClick(view, "data"); }}
                  className="border-l-2 border-l-transparent"
                  actions={
                    <>
                      <ActionButton
                        icon={
                          <Bolt className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTableClick(view, "structure");
                        }}
                        title="View Structure"
                      />
                      <ActionButton
                        icon={
                          <BookMarked className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTableClick(view, "indexes");
                        }}
                        title="View Indexes"
                      />
                    </>
                  }
                />
              ))}
            </SidebarSection>
          )}

          {/* Functions Section */}
          {schemaData.functions.length > 0 && (
            <SidebarSection
              title="Functions"
              count={schemaData.functions.length}
              isExpanded={expandedNodes.has("functions")}
              onToggle={() => { toggleNode("functions"); }}
              stickyClass="sticky top-0 bg-background z-10"
            >
              {filterItems(schemaData.functions).map((func) => (
                <SidebarItem
                  key={`${func.schema}.${func.name}`}
                  icon={
                    <FunctionSquare className="h-3.5 w-4 min-w-4 text-purple-500 flex-shrink-0" />
                  }
                  name={func.name}
                  isActive={isFunctionActive(func.name, func.schema)}
                  onClick={() => { handleFunctionClick(func); }}
                />
              ))}
            </SidebarSection>
          )}

          {/* Empty state */}
          {!isLoadingData &&
            schemaData.tables.length === 0 &&
            schemaData.views.length === 0 &&
            schemaData.functions.length === 0 && (
              <div className="text-center py-4">
                <p className="text-xs text-muted-foreground">
                  {selectedSchema ? "No objects found" : "Select a schema"}
                </p>
              </div>
            )}
        </div>
      </CustomScrollbar>
    </div>
  );
}