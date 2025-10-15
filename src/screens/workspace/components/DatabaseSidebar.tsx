import { useState, useEffect } from "react";
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
import { type TableMeta, type FunctionMeta } from "@/services/databaseService";
import { Backend } from "@/services/backend";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeListen } from "@/utils/tauri";
import {
  SidebarSection,
  SidebarItem,
  ActionButton,
} from "./DatabaseSidebarItem";
import { useSchemaData } from "@/hooks/useSchemaData";

interface DatabaseSidebarProps {
  connectionId: string;
  isLoading?: boolean;
  selectedDatabase: string;
  selectedSchema: string;
}

export function DatabaseSidebar({
  connectionId,
  isLoading: initialLoading,
  selectedDatabase,
  selectedSchema,
}: DatabaseSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Use shared schema data hook
  const {
    tables,
    views,
    functions,
    isLoading: isLoadingData,
    error,
    refresh: refreshSchemaData,
  } = useSchemaData(connectionId, selectedDatabase, selectedSchema);

  const {
    getPrimaryPanel,
    addTabToPanel,
    setActiveTabInPanel,
    updateTabInPanel,
    panels,
    activePanelId,
  } = usePanelStore();

  const { focusedPanelId, panelContents } = useWorkbenchStore();

  // Auto-expand sections when data is loaded
  useEffect(() => {
    if (tables.length > 0) {
      setExpandedNodes(
        (prev) => new Set([...prev, "tables", "views", "functions"]),
      );
    }
  }, [tables]);

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
            void refreshSchemaData();
          }
        },
      );
    };

    void setupListener();

    return () => {
      if (cleanup) cleanup();
    };
  }, [connectionId, selectedSchema, selectedDatabase, refreshSchemaData]);

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
    const {
      focusedPanelId,
      addTab,
      panelContents,
      focusPanel,
      setActiveTab,
      updateTabMetadata,
    } = useWorkbenchStore.getState();

    const tabId = `table-${table.schema}-${table.name}`;

    // If this table tab already exists in ANY panel, focus that panel/tab and update view
    for (const [panelId, content] of panelContents.entries()) {
      if (content.tabIds.includes(tabId)) {
        setActiveTab(panelId, tabId);
        updateTabMetadata(panelId, tabId, {
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
        focusPanel(panelId);
        return;
      }
    }

    // Determine which panel to use if none already has the tab
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
      await refreshSchemaData();
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

  // Show loading skeleton during initial connection or when actively loading schema data
  const showLoadingSkeleton =
    initialLoading || (isLoadingData && selectedSchema);

  if (showLoadingSkeleton) {
    return (
      <div className="flex flex-col h-full p-2 space-y-3">
        {/* Search bar skeleton */}
        <Skeleton className="h-7 w-full" />

        {/* Tables section skeleton */}
        <div className="space-y-1">
          <Skeleton className="h-6 w-24" />
          <div className="ml-2 space-y-1">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        </div>

        {/* Views section skeleton */}
        <div className="space-y-1">
          <Skeleton className="h-6 w-20" />
          <div className="ml-2 space-y-1">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        </div>

        {/* Functions section skeleton */}
        <div className="space-y-1">
          <Skeleton className="h-6 w-28" />
          <div className="ml-2 space-y-1">
            <Skeleton className="h-5 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search Input and Refresh */}
      <div className="p-1">
        <div className="flex gap-1 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search objects..."
              className="pl-6 h-7 py-1 !text-xs"
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
      <div className="flex-1 relative min-h-0 overflow-auto">
        <div className="pb-2 min-w-0">
          {/* Tables Section */}
          {(tables.length > 0 || isLoadingData) && (
            <SidebarSection
              title="Tables"
              count={tables.length}
              isExpanded={expandedNodes.has("tables")}
              onToggle={() => {
                toggleNode("tables");
              }}
              stickyClass="sticky top-0 bg-background z-30"
            >
              {filterItems(tables).map((table) => (
                <SidebarItem
                  key={`${table.schema}.${table.name}`}
                  icon={
                    <Table className="h-3.5 w-4 min-w-4 text-primary flex-shrink-0" />
                  }
                  name={table.name}
                  isActive={isTableActive(table.name, table.schema)}
                  onClick={() => {
                    handleTableClick(table, "data");
                  }}
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
          {views.length > 0 && (
            <SidebarSection
              title="Views"
              count={views.length}
              isExpanded={expandedNodes.has("views")}
              onToggle={() => {
                toggleNode("views");
              }}
            >
              {filterItems(views).map((view) => (
                <SidebarItem
                  key={`${view.schema}.${view.name}`}
                  icon={
                    <Eye
                      className={cn(
                        "h-4 min-h-4 w-4 min-w-4 flex-shrink-0",
                        view.kind === "MaterializedView"
                          ? "text-blue-500"
                          : "text-green-500",
                      )}
                    />
                  }
                  name={view.name}
                  isActive={isTableActive(view.name, view.schema)}
                  onClick={() => {
                    handleTableClick(view, "data");
                  }}
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
          {functions.length > 0 && (
            <SidebarSection
              title="Functions"
              count={functions.length}
              isExpanded={expandedNodes.has("functions")}
              onToggle={() => {
                toggleNode("functions");
              }}
              stickyClass="sticky top-0 bg-background z-10"
            >
              {filterItems(functions).map((func) => (
                <SidebarItem
                  key={`${func.schema}.${func.name}`}
                  icon={
                    <FunctionSquare className="h-3.5 w-4 min-w-4 text-purple-500 flex-shrink-0" />
                  }
                  name={func.name}
                  isActive={isFunctionActive(func.name, func.schema)}
                  onClick={() => {
                    handleFunctionClick(func);
                  }}
                />
              ))}
            </SidebarSection>
          )}

          {/* Empty state */}
          {!isLoadingData &&
            tables.length === 0 &&
            views.length === 0 &&
            functions.length === 0 && (
              <div className="text-center py-4">
                <p className="text-xs text-muted-foreground">
                  {selectedSchema ? "No objects found" : "Select a schema"}
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
