import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { IconSearch, IconTable, IconEye, IconMathFunction, IconRefresh, IconAlertCircle, IconBolt, IconBookmark } from '@tabler/icons-react';
import { Skeleton } from "@/components/ui/skeleton";
import { usePanelStore } from "@/stores/panelStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import { type TableMeta, type FunctionMeta } from "@/services/databaseService";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeListen } from "@/utils/tauri";
import {
  SidebarSection,
  SidebarItem,
  ActionButton,
} from "./DatabaseSidebarItem";
import { DatabaseSidebarContextMenu } from "./DatabaseSidebarContextMenu";
import { useSchemaData } from "@/hooks/useSchemaData";
import {
  openFunctionObject,
  openTableObject,
  openTableDesigner,
  openQueryWithTemplate,
  type CreateObjectType,
} from "@/utils/workbench/openers";
import {
  useStarredItemsStore,
  type StarredItemType,
} from "@/stores/starredItemsStore";
import { useCrudStore } from "@/stores/crudStore";

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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [lastSelectedItem, setLastSelectedItem] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartItem, setDragStartItem] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
  } | null>(null);

  // Use shared schema data hook
  const {
    tables,
    views,
    functions,
    isLoading: isLoadingData,
    error,
    refresh: refreshSchemaData,
  } = useSchemaData();

  const { panels, activePanelId } = usePanelStore();

  const { focusedPanelId, panelContents } = useWorkbenchStore();

  const { toggleStarred, isStarred, getStarredItems } = useStarredItemsStore();
  const { stagedCommands, getTableKey } = useCrudStore();

  // Auto-expand sections when data is loaded
  useEffect(() => {
    if (tables.length > 0) {
      setExpandedNodes(
        (prev) => new Set([...prev, "tables", "views", "functions", "starred"]),
      );
    }
  }, [tables]);

  // Listen for database reconnection events
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    const setupListener = async () => {
      cleanup = await safeListen("database-reconnected", (event) => {
        const payload = event.payload as { connectionId: string };
        if (
          payload.connectionId === connectionId &&
          selectedSchema &&
          selectedDatabase
        ) {
          setIsRefreshing(true);
          void refreshSchemaData().finally(() => {
            setIsRefreshing(false);
          });
        }
      });
    };

    void setupListener();

    return () => {
      if (cleanup) cleanup();
    };
  }, [connectionId, selectedSchema, selectedDatabase, refreshSchemaData]);

  // Track database/schema changes to show loading state
  useEffect(() => {
    if (selectedDatabase && selectedSchema) {
      setIsRefreshing(true);
      // Reset after data loads
      const timer = setTimeout(() => {
        setIsRefreshing(false);
      }, 100);
      return () => { clearTimeout(timer); };
    }
    return undefined;
  }, [selectedDatabase, selectedSchema]);

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  // Generate unique key for an item
  const getItemKey = (type: 'table' | 'view' | 'function', name: string, schema: string) => {
    return `${type}:${schema}.${name}`;
  };

  // Get all items across all sections in display order
  const getAllItemsInOrder = () => {
    const allItems: string[] = [];

    // Add starred items if expanded
    if (expandedNodes.has('starred')) {
      starredItems.forEach(item => {
        allItems.push(getItemKey(item.type, item.name, item.schema));
      });
    }

    // Add tables if expanded
    if (expandedNodes.has('tables')) {
      filterItems(tables).forEach(table => {
        allItems.push(getItemKey('table', table.name, table.schema));
      });
    }

    // Add views if expanded
    if (expandedNodes.has('views')) {
      filterItems(views).forEach(view => {
        allItems.push(getItemKey('view', view.name, view.schema));
      });
    }

    // Add functions if expanded
    if (expandedNodes.has('functions')) {
      filterItems(functions).forEach(func => {
        allItems.push(getItemKey('function', func.name, func.schema));
      });
    }

    return allItems;
  };

  // Handle item selection with modifier keys
  const handleItemSelection = (
    itemKey: string,
    event: React.MouseEvent,
    onClick: () => void
  ) => {
    const isCmdOrCtrl = event.metaKey || event.ctrlKey;
    const isShift = event.shiftKey;

    if (isCmdOrCtrl) {
      // Toggle selection
      const newSelected = new Set(selectedItems);
      if (newSelected.has(itemKey)) {
        newSelected.delete(itemKey);
      } else {
        newSelected.add(itemKey);
      }
      setSelectedItems(newSelected);
      setLastSelectedItem(itemKey);
    } else if (isShift && lastSelectedItem) {
      // Range selection across all visible items
      const allItems = getAllItemsInOrder();
      const lastIndex = allItems.indexOf(lastSelectedItem);
      const currentIndex = allItems.indexOf(itemKey);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeItems = allItems.slice(start, end + 1);

        const newSelected = new Set(selectedItems);
        rangeItems.forEach(item => newSelected.add(item));
        setSelectedItems(newSelected);
      }
    } else {
      // Normal click - clear selection and open item
      if (selectedItems.size > 0) {
        setSelectedItems(new Set());
      }
      setLastSelectedItem(itemKey);
      onClick();
    }
  };

  // Handle mouse down for drag selection
  const handleItemMouseDown = (itemKey: string, event: React.MouseEvent) => {
    if (event.button !== 0) return; // Only left mouse button
    if (event.metaKey || event.ctrlKey || event.shiftKey) return; // Skip if modifier keys

    setIsDragging(true);
    setDragStartItem(itemKey);
    setSelectedItems(new Set([itemKey]));
    setLastSelectedItem(itemKey);
  };

  // Handle mouse enter during drag
  const handleItemMouseEnter = (itemKey: string) => {
    if (!isDragging || !dragStartItem) return;

    const allItems = getAllItemsInOrder();
    const startIndex = allItems.indexOf(dragStartItem);
    const currentIndex = allItems.indexOf(itemKey);

    if (startIndex !== -1 && currentIndex !== -1) {
      const start = Math.min(startIndex, currentIndex);
      const end = Math.max(startIndex, currentIndex);
      const rangeItems = allItems.slice(start, end + 1);

      setSelectedItems(new Set(rangeItems));
    }
  };

  // Handle mouse up to end drag selection
  useEffect(() => {
    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        setDragStartItem(null);
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [isDragging]);

  // Handle right-click to show context menu
  const handleContextMenu = (itemKey: string, event: React.MouseEvent) => {
    event.preventDefault();

    // If the item is not selected, select only this item
    if (!selectedItems.has(itemKey)) {
      setSelectedItems(new Set([itemKey]));
      setLastSelectedItem(itemKey);
    }

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      visible: true,
    });
  };

  // Get selected types breakdown
  const getSelectedTypesBreakdown = () => {
    const breakdown = { tables: 0, views: 0, functions: 0 };
    selectedItems.forEach(itemKey => {
      const [type] = itemKey.split(':');
      if (type === 'table') breakdown.tables++;
      else if (type === 'view') breakdown.views++;
      else if (type === 'function') breakdown.functions++;
    });
    return breakdown;
  };

  // Context menu action handlers
  const handleExport = () => {
    console.log('Export selected items:', Array.from(selectedItems));
    // TODO: Implement export functionality
  };

  const handleCopyName = () => {
    const names = Array.from(selectedItems).map(itemKey => {
      const [, rest] = itemKey.split(':');
      if (!rest) return '';
      const parts = rest.split('.');
      return parts[parts.length - 1] || '';
    }).filter(Boolean);
    navigator.clipboard.writeText(names.join('\n'));
  };

  const handleCopyDefinition = () => {
    console.log('Copy definition for selected items:', Array.from(selectedItems));
    // TODO: Implement copy definition functionality
    // This would generate CREATE TABLE/VIEW/FUNCTION statements and copy to clipboard
  };

  const handlePin = () => {
    // Toggle pin/star for all selected items
    selectedItems.forEach(itemKey => {
      const [type, rest] = itemKey.split(':');
      if (!rest) return;
      const [schema, name] = rest.split('.');
      if (!schema || !name) return;

      toggleStarred({
        connectionId,
        database: selectedDatabase,
        schema,
        type: type as StarredItemType,
        name,
      });
    });
  };

  const handleTruncate = () => {
    console.log('Truncate selected tables:', Array.from(selectedItems));
    // TODO: Show confirmation dialog with warning
    // Options: Restart identity, Cascade
  };

  const handleDeleteSelected = () => {
    console.log('Delete selected items:', Array.from(selectedItems));
    // TODO: Show confirmation dialog with warning
    // Options: Ignore foreign key checks, Cascade
  };

  const handleViewData = () => {
    // Open data view for all selected tables/views
    selectedItems.forEach(itemKey => {
      const [type, rest] = itemKey.split(':');
      if (!rest || (type !== 'table' && type !== 'view')) return;

      const [schema, name] = rest.split('.');
      if (!schema || !name) return;

      const item = tables.find(t => t.name === name && t.schema === schema) ||
                   views.find(v => v.name === name && v.schema === schema);
      if (item) {
        handleTableClick(item, 'data');
      }
    });
  };

  const handleViewStructure = () => {
    // Open structure view for all selected tables/views
    selectedItems.forEach(itemKey => {
      const [type, rest] = itemKey.split(':');
      if (!rest || (type !== 'table' && type !== 'view')) return;

      const [schema, name] = rest.split('.');
      if (!schema || !name) return;

      const item = tables.find(t => t.name === name && t.schema === schema) ||
                   views.find(v => v.name === name && v.schema === schema);
      if (item) {
        handleTableClick(item, 'structure');
      }
    });
  };

  const handleDuplicate = () => {
    console.log('Duplicate item:', Array.from(selectedItems)[0]);
    // TODO: Implement duplicate functionality
  };

  const handleTableClick = (
    table: TableMeta,
    viewType: "data" | "structure" | "indexes" = "data",
  ) => {
    openTableObject({
      table,
      connectionId,
      database: selectedDatabase,
      viewType,
    });
  };

  const handleFunctionClick = (func: FunctionMeta) => {
    openFunctionObject({
      func,
      connectionId,
      database: selectedDatabase,
    });
  };

  const handleRefresh = async () => {
    // Refresh schema data
    if (selectedDatabase && selectedSchema) {
      await refreshSchemaData();
    }
  };

  // Handlers for creating new objects
  const handleCreateTable = () => {
    openTableDesigner({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
    });
  };

  const handleCreateView = () => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: 'view',
    });
  };

  const handleCreateFunction = () => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: 'function',
    });
  };

  // Handle star toggle
  const handleToggleStar = (
    type: StarredItemType,
    name: string,
    schema: string,
  ) => {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleStarred({
        connectionId,
        database: selectedDatabase,
        schema,
        type,
        name,
      });
    };
  };

  // Get starred items for current context
  const starredItems = getStarredItems(
    connectionId,
    selectedDatabase,
    selectedSchema,
  );

  // IconFilter items based on search
  const filterItems = <T extends { name: string }>(items: T[]): T[] => {
    if (!searchQuery) return items;
    return items.filter((item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  };

  // IconCheck if a table/view is currently active in the active panel
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

  // IconCheck if a function is currently active in the active panel
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

  // IconCheck if a table has pending changes
  const hasTablePendingChanges = (
    tableName: string,
    schema: string,
  ): boolean => {
    const tableKey = getTableKey({
      connectionId,
      database: selectedDatabase,
      schema,
      table: tableName,
    });
    const commands = stagedCommands.get(tableKey);
    return commands ? commands.length > 0 : false;
  };

  // Show loading skeleton during initial connection, actively loading, or refreshing
  const showLoadingSkeleton =
    initialLoading ||
    (isLoadingData && selectedSchema) ||
    (isRefreshing && tables.length === 0);

  if (showLoadingSkeleton) {
    return (
      <div className="flex flex-col h-full p-2 space-y-3">
        {/* IconSearch bar skeleton */}
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
      {/* IconSearch Input and Refresh */}
      <div className="p-1">
        <div className="flex gap-1 items-center">
          <div className="relative flex-1">
            <IconSearch className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
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
            disabled={isLoadingData || isRefreshing}
            title="Refresh"
          >
            <IconRefresh
              className={cn(
                "h-3 w-3",
                (isLoadingData || isRefreshing) && "animate-spin",
              )}
            />
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-2 py-1">
          <div className="flex items-center gap-2 text-xs text-red-500">
            <IconAlertCircle className="h-3 w-3" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Object Tree */}
      <div className="flex-1 relative min-h-0 overflow-auto">
        <div
          className={cn(
            "pb-2 min-w-0 transition-opacity duration-150",
            isRefreshing && tables.length > 0 && "opacity-50 pointer-events-none",
            isDragging && "select-none",
          )}
        >
          {/* Starred Section */}
          {starredItems.length > 0 && (
            <SidebarSection
              title="Starred"
              count={starredItems.length}
              isExpanded={expandedNodes.has("starred")}
              onToggle={() => {
                toggleNode("starred");
              }}
              stickyClass="sticky top-0 bg-background z-40"
            >
              {starredItems.map((item) => {
                const itemData =
                  item.type === "function"
                    ? functions.find((f) => f.name === item.name)
                    : item.type === "view"
                    ? views.find((v) => v.name === item.name)
                    : tables.find((t) => t.name === item.name);

                if (!itemData) return null;

                const itemKey = getItemKey(item.type, item.name, item.schema);

                const icon =
                  item.type === "function" ? (
                    <IconMathFunction className="h-3.5 w-4 min-w-4 text-purple-500 flex-shrink-0" />
                  ) : item.type === "view" ? (
                    <IconEye
                      className={cn(
                        "h-4 min-h-4 w-4 min-w-4 flex-shrink-0",
                        (itemData as TableMeta).kind === "MaterializedView"
                          ? "text-blue-500"
                          : "text-green-500",
                      )}
                    />
                  ) : (
                    <IconTable className="h-3.5 w-4 min-w-4 text-primary flex-shrink-0" />
                  );

                const isActive =
                  item.type === "function"
                    ? isFunctionActive(item.name, item.schema)
                    : isTableActive(item.name, item.schema);

                const onClick =
                  item.type === "function"
                    ? () => {
                        handleFunctionClick(itemData as FunctionMeta);
                      }
                    : () => {
                        handleTableClick(itemData as TableMeta, "data");
                      };

                return (
                  <SidebarItem
                    key={item.id}
                    icon={icon}
                    name={item.name}
                    isActive={isActive}
                    onClick={(e) => {
                      handleItemSelection(itemKey, e, onClick);
                    }}
                    onMouseDown={(e) => handleItemMouseDown(itemKey, e)}
                    onMouseEnter={() => handleItemMouseEnter(itemKey)}
                    onContextMenu={(e) => handleContextMenu(itemKey, e)}
                    isSelected={selectedItems.has(itemKey)}
                    rowCount={
                      "row_estimate" in itemData
                        ? itemData.row_estimate
                        : undefined
                    }
                    isStarred={true}
                    onToggleStar={handleToggleStar(
                      item.type,
                      item.name,
                      item.schema,
                    )}
                    hasPendingChanges={
                      item.type !== "function"
                        ? hasTablePendingChanges(item.name, item.schema)
                        : false
                    }
                    actions={
                      item.type !== "function" ? (
                        <>
                          <ActionButton
                            icon={
                              <IconBolt className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTableClick(
                                itemData as TableMeta,
                                "structure",
                              );
                            }}
                            title="View Structure"
                          />
                          <ActionButton
                            icon={
                              <IconBookmark className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTableClick(
                                itemData as TableMeta,
                                "indexes",
                              );
                            }}
                            title="View Indexes"
                          />
                        </>
                      ) : undefined
                    }
                  />
                );
              })}
            </SidebarSection>
          )}

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
              onAdd={handleCreateTable}
              addTooltip="Create new table"
            >
              {filterItems(tables).map((table) => {
                const itemKey = getItemKey('table', table.name, table.schema);
                return (
                  <SidebarItem
                    key={`${table.schema}.${table.name}`}
                    icon={
                      <IconTable className="h-3.5 w-4 min-w-4 text-primary flex-shrink-0" />
                    }
                    name={table.name}
                    isActive={isTableActive(table.name, table.schema)}
                    onClick={(e) => {
                      handleItemSelection(itemKey, e, () => {
                        handleTableClick(table, "data");
                      });
                    }}
                    onMouseDown={(e) => handleItemMouseDown(itemKey, e)}
                    onMouseEnter={() => handleItemMouseEnter(itemKey)}
                    onContextMenu={(e) => handleContextMenu(itemKey, e)}
                    isSelected={selectedItems.has(itemKey)}
                    rowCount={table.row_estimate}
                    isStarred={isStarred(
                      connectionId,
                      selectedDatabase,
                      table.schema,
                      "table",
                      table.name,
                    )}
                    onToggleStar={handleToggleStar(
                      "table",
                      table.name,
                      table.schema,
                    )}
                    hasPendingChanges={hasTablePendingChanges(
                      table.name,
                      table.schema,
                    )}
                    actions={
                      <>
                        <ActionButton
                          icon={
                            <IconBolt className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTableClick(table, "structure");
                          }}
                          title="View Structure"
                        />
                        <ActionButton
                          icon={
                            <IconBookmark className="h-3 w-3 text-muted-foreground hover:text-foreground" />
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
                );
              })}
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
              onAdd={handleCreateView}
              addTooltip="Create new view"
            >
              {filterItems(views).map((view) => {
                const itemKey = getItemKey('view', view.name, view.schema);
                return (
                  <SidebarItem
                    key={`${view.schema}.${view.name}`}
                    icon={
                      <IconEye
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
                    onClick={(e) => {
                      handleItemSelection(itemKey, e, () => {
                        handleTableClick(view, "data");
                      });
                    }}
                    onMouseDown={(e) => handleItemMouseDown(itemKey, e)}
                    onMouseEnter={() => handleItemMouseEnter(itemKey)}
                    onContextMenu={(e) => handleContextMenu(itemKey, e)}
                    isSelected={selectedItems.has(itemKey)}
                    className="border-l-2 border-l-transparent"
                    isStarred={isStarred(
                      connectionId,
                      selectedDatabase,
                      view.schema,
                      "view",
                      view.name,
                    )}
                    onToggleStar={handleToggleStar(
                      "view",
                      view.name,
                      view.schema,
                    )}
                    hasPendingChanges={hasTablePendingChanges(
                      view.name,
                      view.schema,
                    )}
                    actions={
                      <>
                        <ActionButton
                          icon={
                            <IconBolt className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTableClick(view, "structure");
                          }}
                          title="View Structure"
                        />
                        <ActionButton
                          icon={
                            <IconBookmark className="h-3 w-3 text-muted-foreground hover:text-foreground" />
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
                );
              })}
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
              onAdd={handleCreateFunction}
              addTooltip="Create new function"
            >
              {filterItems(functions).map((func) => {
                const itemKey = getItemKey('function', func.name, func.schema);
                return (
                  <SidebarItem
                    key={`${func.schema}.${func.name}`}
                    icon={
                      <IconMathFunction className="h-3.5 w-4 min-w-4 text-purple-500 flex-shrink-0" />
                    }
                    name={func.name}
                    isActive={isFunctionActive(func.name, func.schema)}
                    onClick={(e) => {
                      handleItemSelection(itemKey, e, () => {
                        handleFunctionClick(func);
                      });
                    }}
                    onMouseDown={(e) => handleItemMouseDown(itemKey, e)}
                    onMouseEnter={() => handleItemMouseEnter(itemKey)}
                    onContextMenu={(e) => handleContextMenu(itemKey, e)}
                    isSelected={selectedItems.has(itemKey)}
                    isStarred={isStarred(
                      connectionId,
                      selectedDatabase,
                      func.schema,
                      "function",
                      func.name,
                    )}
                    onToggleStar={handleToggleStar(
                      "function",
                      func.name,
                      func.schema,
                    )}
                  />
                );
              })}
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

      {/* Context Menu */}
      {contextMenu?.visible && selectedItems.size > 0 && (
        <DatabaseSidebarContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedCount={selectedItems.size}
          selectedTypes={getSelectedTypesBreakdown()}
          onClose={() => setContextMenu(null)}
          onExport={handleExport}
          onCopyName={handleCopyName}
          onCopyDefinition={handleCopyDefinition}
          onPin={handlePin}
          onTruncate={handleTruncate}
          onDelete={handleDeleteSelected}
          onViewData={handleViewData}
          onViewStructure={handleViewStructure}
          onDuplicate={handleDuplicate}
        />
      )}
    </div>
  );
}
