/**
 * ConnectionSection.tsx
 *
 * A VS Code-style collapsible section for a single database connection.
 * Shows connection header with icon, name, status indicator, and when expanded:
 * - Schema dropdown (SQL databases only)
 * - Tables/Views/Functions sections
 */

import { useState, useEffect, useMemo, useCallback, forwardRef } from "react";
import { cn } from "@/lib/utils";
import {
  IconChevronDown,
  IconChevronRight,
  IconTable,
  IconEye,
  IconMathFunction,
  IconRefresh,
  IconAlertCircle,
  IconBolt,
  IconBookmark,
  IconAssembly,
  IconPlugConnected,
  IconX,
  IconExternalLink,
  IconLayout2,
  IconKey,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { useSchemaData } from "@/hooks/useSchemaData";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { isMySQLCompatible, getParadigm } from "@/types/connection";
import type { CollectionInfo } from "@/adapters/types/mongodb";
import type { OpenConnection } from "@/types/workspace";
import {
  SidebarSection,
  SidebarItem,
  ActionButton,
} from "./DatabaseSidebarItem";
import { PartitionSubTree } from "./PartitionSubTree";
import { type TableMeta, type FunctionMeta } from "@/services/databaseService";
import {
  openFunctionObject,
  openTableObject,
  openTableDesigner,
  openQueryWithTemplate,
} from "@/utils/workbench/openers";
import {
  useStarredItemsStore,
  type StarredItemType,
} from "@/stores/starredItemsStore";
import { useCrudStore } from "@/stores/crudStore";
import { usePanelStore } from "@/stores/panelStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SchemaDropdown } from "./SchemaDropdown";
import { DatabaseSidebarContextMenu } from "./DatabaseSidebarContextMenu";
import { toast } from "sonner";
import { writeClipboardText } from "@/lib/clipboard";

interface ConnectionSectionProps {
  connection: OpenConnection;
  isExpanded: boolean;
  onToggle: () => void;
  searchQuery: string;
  onTableClick?: (
    connectionId: string,
    table: TableMeta,
    viewType?:
      | "data"
      | "structure"
      | "indexes"
      | "triggers"
      | "definition"
      | "partitions",
  ) => void;
  onFunctionClick?: (connectionId: string, func: FunctionMeta) => void;
}

export const ConnectionSection = forwardRef<
  HTMLDivElement,
  ConnectionSectionProps
>(function ConnectionSection(
  {
    connection,
    isExpanded,
    onToggle,
    searchQuery,
    onTableClick,
    onFunctionClick,
  },
  ref,
) {
  const {
    id: connectionId,
    profile,
    status,
    database,
    schema,
    error,
  } = connection;
  const dbType = profile.db_type;
  const paradigm = getParadigm(dbType);
  const isSqlDb = paradigm === "sql";
  const isDocumentDb = paradigm === "document";
  const isKeyValueDb = paradigm === "keyvalue";
  const isMySQLDb = isMySQLCompatible(dbType);

  // Local state for expanded sections within this connection
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(["tables", "views", "starred", "collections", "keys"]),
  );
  const [expandedPartitionedTables, setExpandedPartitionedTables] = useState<
    Set<string>
  >(new Set());

  // Context menu state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
  } | null>(null);

  // Get schema data for SQL databases
  const {
    tables,
    views,
    functions,
    isLoading: isLoadingData,
    error: schemaError,
  } = useSchemaData(isSqlDb ? connectionId : undefined);

  // Get collections for MongoDB
  const {
    data: mongoCollections = [],
    isLoading: isLoadingCollections,
    error: collectionsError,
  } = useQuery({
    queryKey: ["mongo-collections", connectionId, database],
    queryFn: async () => {
      const result = await invoke<CollectionInfo[]>("mongo_list_collections", {
        connId: connectionId,
      });
      return result;
    },
    enabled: isDocumentDb && status === "connected" && !!database,
    staleTime: 60_000,
  });

  // Get keys summary for Redis
  const { data: redisKeyCount = 0, isLoading: isLoadingKeys } = useQuery({
    queryKey: ["redis-dbsize", connectionId],
    queryFn: async () => {
      const result = await invoke<number>("redis_dbsize", {
        connId: connectionId,
      });
      return result;
    },
    enabled: isKeyValueDb && status === "connected",
    staleTime: 30_000,
  });

  // Store actions
  const {
    reconnectConnection,
    removeConnectionFromWorkspace,
    setFocusedConnection,
    updateConnectionState,
  } = useWorkspaceBundleStore();
  const { toggleStarred, getStarredItems } = useStarredItemsStore();
  const { stagedCommands } = useCrudStore();
  const { panels, activePanelId } = usePanelStore();
  const { focusedPanelId, panelContents } = useWorkbenchStore();

  // Pre-compute lookup maps for O(1) access
  const tablesByKey = useMemo(() => {
    const map = new Map<string, TableMeta>();
    tables.forEach((t) => map.set(`${t.schema}.${t.name}`, t));
    return map;
  }, [tables]);

  const viewsByKey = useMemo(() => {
    const map = new Map<string, TableMeta>();
    views.forEach((v) => map.set(`${v.schema}.${v.name}`, v));
    return map;
  }, [views]);

  const functionsByKey = useMemo(() => {
    const map = new Map<string, FunctionMeta>();
    functions.forEach((f) => map.set(`${f.schema}.${f.name}`, f));
    return map;
  }, [functions]);

  // Pre-compute starred items set
  const starredItemsRaw = getStarredItems(connectionId, database, schema);
  const starredSet = useMemo(() => {
    const set = new Set<string>();
    starredItemsRaw.forEach((item) =>
      set.add(`${item.type}:${item.schema}.${item.name}`),
    );
    return set;
  }, [starredItemsRaw]);

  // Pre-compute pending changes set
  const pendingChangesSet = useMemo(() => {
    const set = new Set<string>();
    stagedCommands.forEach((commands, tableKey) => {
      if (commands.length > 0 && tableKey.startsWith(`${connectionId}:`)) {
        const parts = tableKey.split(":");
        if (parts.length >= 4) {
          const [, , schemaName, table] = parts;
          set.add(`${schemaName}.${table}`);
        }
      }
    });
    return set;
  }, [stagedCommands, connectionId]);

  // Compute non-starred counts
  const nonStarredCounts = useMemo(
    () => ({
      tables: tables.filter(
        (t) => !starredSet.has(`table:${t.schema}.${t.name}`),
      ).length,
      views: views.filter((v) => !starredSet.has(`view:${v.schema}.${v.name}`))
        .length,
      functions: functions.filter(
        (f) => !starredSet.has(`function:${f.schema}.${f.name}`),
      ).length,
    }),
    [tables, views, functions, starredSet],
  );

  // Auto-expand sections when data is loaded
  useEffect(() => {
    if (tables.length > 0 || views.length > 0 || functions.length > 0) {
      queueMicrotask(() => {
        setExpandedNodes(
          (prev) => new Set([...prev, "tables", "views", "starred"]),
        );
      });
    }
  }, [tables.length, views.length, functions.length]);

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const togglePartitionedTable = (tableKey: string) => {
    setExpandedPartitionedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableKey)) {
        next.delete(tableKey);
      } else {
        next.add(tableKey);
      }
      return next;
    });
  };

  // Filter items based on search and exclude starred
  const filterItems = <T extends { name: string; schema: string }>(
    items: T[],
    type: "table" | "view" | "function",
  ): T[] => {
    return items.filter((item) => {
      if (starredSet.has(`${type}:${item.schema}.${item.name}`)) {
        return false;
      }
      if (
        searchQuery &&
        !item.name.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  };

  // Check if table/view is active
  const isTableActive = (tableName: string, tableSchema: string): boolean => {
    if (focusedPanelId) {
      const focusedPanel = panelContents.get(focusedPanelId);
      if (focusedPanel && focusedPanel.activeTabId) {
        const metadata = focusedPanel.metadata?.[focusedPanel.activeTabId];
        if (
          metadata?.type === "table" &&
          metadata.table === tableName &&
          metadata.schema === tableSchema &&
          metadata.connectionId === connectionId
        ) {
          return true;
        }
      }
    }

    const activePanel = panels.get(activePanelId);
    if (!activePanel || !activePanel.activeTabId) return false;

    const activeTab = activePanel.tabs.get(activePanel.activeTabId);
    if (!activeTab || activeTab.type !== "table") return false;

    return (
      activeTab.payload.tableName === tableName &&
      activeTab.payload.schema === tableSchema
    );
  };

  const isFunctionActive = (
    functionName: string,
    functionSchema: string,
  ): boolean => {
    if (focusedPanelId) {
      const focusedPanel = panelContents.get(focusedPanelId);
      if (focusedPanel && focusedPanel.activeTabId) {
        const [type, ...parts] = focusedPanel.activeTabId.split("-");
        if (type === "function") {
          const metadata = focusedPanel.metadata?.[focusedPanel.activeTabId];
          if (
            metadata?.schema === functionSchema &&
            parts.includes(functionName) &&
            metadata.connectionId === connectionId
          ) {
            return true;
          }
        }
      }
    }

    const activePanel = panels.get(activePanelId);
    if (!activePanel || !activePanel.activeTabId) return false;

    const activeTab = activePanel.tabs.get(activePanel.activeTabId);
    if (!activeTab || activeTab.type !== "function") return false;

    return (
      activeTab.payload.functionName === functionName &&
      activeTab.payload.schema === functionSchema
    );
  };

  const isProcedure = (func: FunctionMeta): boolean =>
    func.routine_type === "PROCEDURE" ||
    (!func.routine_type && isMySQLDb && func.return_type === "void");

  // Handle table click
  const handleTableClick = useCallback(
    (
      table: TableMeta,
      viewType:
        | "data"
        | "structure"
        | "indexes"
        | "triggers"
        | "definition"
        | "partitions" = "data",
    ) => {
      // Focus this connection first
      setFocusedConnection(connectionId);

      if (onTableClick) {
        onTableClick(connectionId, table, viewType);
      } else {
        openTableObject({
          table,
          connectionId,
          database,
          viewType,
        });
      }
    },
    [connectionId, database, setFocusedConnection, onTableClick],
  );

  // Handle function click
  const handleFunctionClick = useCallback(
    (func: FunctionMeta) => {
      // Focus this connection first
      setFocusedConnection(connectionId);

      if (onFunctionClick) {
        onFunctionClick(connectionId, func);
      } else {
        openFunctionObject({
          func,
          connectionId,
          database,
        });
      }
    },
    [connectionId, database, setFocusedConnection, onFunctionClick],
  );

  // Handle star toggle
  const handleToggleStar = (
    type: StarredItemType,
    name: string,
    itemSchema: string,
  ) => {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleStarred({
        connectionId,
        database,
        schema: itemSchema,
        type,
        name,
      });
    };
  };

  // Handlers for creating new objects
  const handleCreateTable = () => {
    setFocusedConnection(connectionId);
    openTableDesigner({
      connectionId,
      database,
      schema,
    });
  };

  const handleCreateView = () => {
    setFocusedConnection(connectionId);
    openQueryWithTemplate({
      connectionId,
      database,
      schema,
      objectType: "view",
    });
  };

  const handleCreateFunction = () => {
    setFocusedConnection(connectionId);
    openQueryWithTemplate({
      connectionId,
      database,
      schema,
      objectType: "function",
    });
  };

  // Handle schema change
  const handleSchemaChange = (newSchema: string) => {
    updateConnectionState(connectionId, database, newSchema);
  };

  // Context menu handlers
  const handleContextMenu = (itemKey: string, event: React.MouseEvent) => {
    event.preventDefault();
    if (!selectedItems.has(itemKey)) {
      setSelectedItems(new Set([itemKey]));
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      visible: true,
    });
  };

  const getSelectedTypesBreakdown = () => {
    const breakdown = { tables: 0, views: 0, materializedViews: 0, functions: 0 };
    selectedItems.forEach((key) => {
      const [type] = key.split(":");
      if (type === "table") breakdown.tables++;
      else if (type === "view") {
        const viewItem = views.find((v) => `view:${v.schema}.${v.name}` === key);
        if (viewItem?.kind === "MaterializedView") breakdown.materializedViews++;
        else breakdown.views++;
      } else if (type === "function") breakdown.functions++;
    });
    return breakdown;
  };

  const getSelectedItems = () => {
    const items: Array<{ type: string; schema: string; name: string; kind?: string }> = [];
    selectedItems.forEach((key) => {
      const colonIndex = key.indexOf(":");
      if (colonIndex === -1) return;
      const type = key.slice(0, colonIndex);
      const rest = key.slice(colonIndex + 1);
      const dotIndex = rest.indexOf(".");
      if (dotIndex === -1) return;
      const itemSchema = rest.slice(0, dotIndex);
      const name = rest.slice(dotIndex + 1);
      if (type === "view") {
        const viewItem = views.find((v) => v.schema === itemSchema && v.name === name);
        items.push({ type, schema: itemSchema, name, kind: viewItem?.kind });
      } else {
        items.push({ type, schema: itemSchema, name });
      }
    });
    return items;
  };

  const handleCopyName = async () => {
    const items = getSelectedItems();
    const names = items.map((i) => i.name).join("\n");
    try {
      await writeClipboardText(names);
      toast.success(`Copied ${items.length} name(s)`);
    } catch {
      toast.error("Failed to copy names");
    }
  };

  const handleCopyDefinition = async () => {
    toast.info("Copy definition - coming soon");
  };

  const handleExport = () => {
    toast.info("Export - coming soon");
  };

  const handlePin = () => {
    const items = getSelectedItems();
    items.forEach((item) => {
      toggleStarred({
        connectionId,
        database,
        schema: item.schema,
        type: item.type as StarredItemType,
        name: item.name,
      });
    });
    setSelectedItems(new Set());
  };

  const handleTruncate = () => {
    toast.info("Truncate - coming soon");
  };

  const handleDelete = () => {
    toast.info("Delete - coming soon");
  };

  const handleViewData = () => {
    const items = getSelectedItems();
    items.forEach((item) => {
      if (item.type === "table" || item.type === "view") {
        const meta = item.type === "table"
          ? tables.find((t) => t.schema === item.schema && t.name === item.name)
          : views.find((v) => v.schema === item.schema && v.name === item.name);
        if (meta) handleTableClick(meta, "data");
      }
    });
    setSelectedItems(new Set());
  };

  const handleViewStructure = () => {
    const items = getSelectedItems();
    items.forEach((item) => {
      if (item.type === "table" || item.type === "view") {
        const meta = item.type === "table"
          ? tables.find((t) => t.schema === item.schema && t.name === item.name)
          : views.find((v) => v.schema === item.schema && v.name === item.name);
        if (meta) handleTableClick(meta, "structure");
      }
    });
    setSelectedItems(new Set());
  };

  const handleViewIndexes = () => {
    const items = getSelectedItems();
    items.forEach((item) => {
      if (item.type === "table" || item.type === "view") {
        const meta = item.type === "table"
          ? tables.find((t) => t.schema === item.schema && t.name === item.name)
          : views.find((v) => v.schema === item.schema && v.name === item.name);
        if (meta) handleTableClick(meta, "indexes");
      }
    });
    setSelectedItems(new Set());
  };

  const handleViewTriggers = () => {
    const items = getSelectedItems();
    items.forEach((item) => {
      if (item.type === "table") {
        const meta = tables.find((t) => t.schema === item.schema && t.name === item.name);
        if (meta) handleTableClick(meta, "triggers");
      }
    });
    setSelectedItems(new Set());
  };

  const handleViewDefinition = () => {
    const items = getSelectedItems();
    items.forEach((item) => {
      if (item.type === "table" || item.type === "view") {
        const meta = item.type === "table"
          ? tables.find((t) => t.schema === item.schema && t.name === item.name)
          : views.find((v) => v.schema === item.schema && v.name === item.name);
        if (meta) handleTableClick(meta, "definition");
      } else if (item.type === "function") {
        const meta = functions.find((f) => f.schema === item.schema && f.name === item.name);
        if (meta) handleFunctionClick(meta);
      }
    });
    setSelectedItems(new Set());
  };

  // Status indicator color
  const statusColor =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500 animate-pulse"
        : status === "error"
          ? "bg-red-500"
          : "bg-gray-400";

  // Show loading state when expanding and no data yet
  const showLoadingSkeleton =
    isExpanded &&
    status === "connecting" &&
    (isSqlDb
      ? tables.length === 0
      : isDocumentDb
        ? mongoCollections.length === 0
        : true);

  return (
    <div ref={ref} className="border-b border-border last:border-b-0">
      {/* Connection Header */}
      <ContextMenu>
        <ContextMenuTrigger
          className={cn(
            "w-full flex items-center gap-2 p-2 hover:bg-muted/50 transition-colors text-left cursor-pointer",
            isExpanded && "bg-muted/30",
          )}
          onClick={onToggle}
        >
          {/* Expand/Collapse chevron */}
          {isExpanded ? (
            <IconChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}

          {/* Database icon */}
          <img
            src={getDatabaseLogo(dbType)}
            alt={dbType}
            className="h-4 w-4 shrink-0"
          />

          {/* Connection name */}
          <span className="text-xs font-medium truncate flex-1">
            {profile.name}
          </span>

          {/* Schema dropdown inline (SQL databases only) - stop propagation to prevent toggle */}
          {isSqlDb && (
            <div
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="shrink-0"
            >
              <SchemaDropdown
                connectionId={connectionId}
                selectedSchema={schema}
                onSchemaChange={handleSchemaChange}
              />
            </div>
          )}

          {/* Status indicator */}
          <span
            className={cn("h-2 w-2 rounded-full shrink-0", statusColor)}
            title={status}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={() => {
              void reconnectConnection(connectionId);
            }}
            disabled={status === "connecting"}
          >
            <IconPlugConnected className="h-4 w-4 mr-2" />
            Reconnect
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              // TODO: Open in new window
              toast.info("Open in new window - coming soon");
            }}
          >
            <IconExternalLink className="h-4 w-4 mr-2" />
            Open in New Window
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => {
              void removeConnectionFromWorkspace(connectionId);
            }}
            className="text-red-600 focus:text-red-600"
          >
            <IconX className="h-4 w-4 mr-2" />
            Remove from Workspace
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Error state */}
      {status === "error" && error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
          <IconAlertCircle className="h-4 w-4 shrink-0" />
          <span className="truncate">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-2 text-xs ml-auto"
            onClick={() => void reconnectConnection(connectionId)}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Expanded content */}
      {isExpanded && status !== "error" && (
        <div className="px-2">
          {/* Loading skeleton */}
          {showLoadingSkeleton && (
            <div className="pl-2 pr-1 py-2 space-y-2">
              <Skeleton className="h-5 w-20" />
              <div className="ml-2 space-y-1">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          )}

          {/* Schema error */}
          {schemaError && (
            <div className="pl-2 pr-1 py-1">
              <div className="flex items-center gap-2 text-xs text-red-500">
                <IconAlertCircle className="h-3 w-3" />
                <span>{schemaError}</span>
              </div>
            </div>
          )}

          {/* Object tree - SQL databases */}
          {isSqlDb && !showLoadingSkeleton && !schemaError && (
            <div className="pb-2">
              {/* Starred Section */}
              {starredItemsRaw.length > 0 && (
                <SidebarSection
                  title="Starred"
                  count={starredItemsRaw.length}
                  isExpanded={expandedNodes.has("starred")}
                  onToggle={() => {
                    toggleNode("starred");
                  }}
                  stickyClass=""
                >
                  {starredItemsRaw.map((item) => {
                    const key = `${item.schema}.${item.name}`;
                    const itemData =
                      item.type === "function"
                        ? functionsByKey.get(key)
                        : item.type === "view"
                          ? viewsByKey.get(key)
                          : tablesByKey.get(key);

                    if (!itemData) return null;

                    const icon =
                      item.type === "function" ? (
                        <IconMathFunction
                          className={cn(
                            "h-3.5 w-4 min-w-4 shrink-0",
                            isProcedure(itemData as FunctionMeta)
                              ? "text-orange-500"
                              : "text-purple-500",
                          )}
                        />
                      ) : item.type === "view" ? (
                        <IconEye
                          className={cn(
                            "h-4 min-h-4 w-4 min-w-4 shrink-0",
                            (itemData as TableMeta).kind === "MaterializedView"
                              ? "text-blue-500"
                              : "text-green-500",
                          )}
                        />
                      ) : (
                        <IconTable className="h-3.5 w-4 min-w-4 text-primary shrink-0" />
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
                        onClick={onClick}
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
                          item.type !== "function" &&
                          pendingChangesSet.has(`${item.schema}.${item.name}`)
                        }
                      />
                    );
                  })}
                </SidebarSection>
              )}

              {/* Tables Section */}
              {(nonStarredCounts.tables > 0 || isLoadingData) && (
                <SidebarSection
                  title="Tables"
                  count={nonStarredCounts.tables}
                  isExpanded={expandedNodes.has("tables")}
                  onToggle={() => {
                    toggleNode("tables");
                  }}
                  stickyClass=""
                  onAdd={handleCreateTable}
                  addTooltip="Create new table"
                >
                  {filterItems(tables, "table").map((table) => {
                    const tableKey = `${table.schema}.${table.name}`;
                    const isPartitioned = table.isPartitioned === true;
                    const isPartitionExpanded =
                      expandedPartitionedTables.has(tableKey);
                    return (
                      <div key={tableKey}>
                        <SidebarItem
                          icon={
                            <IconTable className="h-3.5 w-4 min-w-4 text-primary shrink-0" />
                          }
                          name={table.name}
                          isActive={isTableActive(table.name, table.schema)}
                          onClick={() => {
                            handleTableClick(table, "data");
                          }}
                          rowCount={table.row_estimate}
                          isStarred={starredSet.has(
                            `table:${table.schema}.${table.name}`,
                          )}
                          onToggleStar={handleToggleStar(
                            "table",
                            table.name,
                            table.schema,
                          )}
                          hasPendingChanges={pendingChangesSet.has(
                            `${table.schema}.${table.name}`,
                          )}
                          isExpandable={isPartitioned}
                          isExpanded={isPartitionExpanded}
                          onToggleExpand={() => {
                            togglePartitionedTable(tableKey);
                          }}
                          isSelected={selectedItems.has(`table:${table.schema}.${table.name}`)}
                          onContextMenu={(e) => handleContextMenu(`table:${table.schema}.${table.name}`, e)}
                          actions={
                            <>
                              <ActionButton
                                icon={
                                  <IconAssembly className="h-3 w-3 text-muted-foreground hover:text-foreground" />
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
                        {isPartitioned && isPartitionExpanded && (
                          <PartitionSubTree
                            connectionId={connectionId}
                            schema={table.schema}
                            tableName={table.name}
                            dbType={dbType}
                            onPartitionClick={(
                              partitionName,
                              partitionSchema,
                            ) => {
                              const partitionTable: TableMeta = {
                                schema: partitionSchema,
                                name: partitionName,
                                kind: "Table",
                              };
                              handleTableClick(partitionTable, "data");
                            }}
                            isPartitionActive={(
                              partitionName,
                              partitionSchema,
                            ) => isTableActive(partitionName, partitionSchema)}
                          />
                        )}
                      </div>
                    );
                  })}
                </SidebarSection>
              )}

              {/* Views Section */}
              {nonStarredCounts.views > 0 && (
                <SidebarSection
                  title="Views"
                  count={nonStarredCounts.views}
                  isExpanded={expandedNodes.has("views")}
                  onToggle={() => {
                    toggleNode("views");
                  }}
                  onAdd={handleCreateView}
                  addTooltip="Create new view"
                  stickyClass=""
                >
                  {filterItems(views, "view").map((view) => (
                    <SidebarItem
                      key={`${view.schema}.${view.name}`}
                      icon={
                        <IconEye
                          className={cn(
                            "h-4 min-h-4 w-4 min-w-4 shrink-0",
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
                      isStarred={starredSet.has(
                        `view:${view.schema}.${view.name}`,
                      )}
                      onToggleStar={handleToggleStar(
                        "view",
                        view.name,
                        view.schema,
                      )}
                      hasPendingChanges={pendingChangesSet.has(
                        `${view.schema}.${view.name}`,
                      )}
                      isSelected={selectedItems.has(`view:${view.schema}.${view.name}`)}
                      onContextMenu={(e) => handleContextMenu(`view:${view.schema}.${view.name}`, e)}
                      actions={
                        <>
                          {view.kind === "MaterializedView" && (
                            <ActionButton
                              icon={
                                <IconRefresh className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                // TODO: handleRefreshMaterializedView(view, e);
                              }}
                              title="Refresh Materialized View"
                            />
                          )}
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
                  ))}
                </SidebarSection>
              )}

              {/* Functions Section */}
              {nonStarredCounts.functions > 0 && (
                <SidebarSection
                  title="Functions"
                  count={nonStarredCounts.functions}
                  isExpanded={expandedNodes.has("functions")}
                  onToggle={() => {
                    toggleNode("functions");
                  }}
                  stickyClass=""
                  onAdd={handleCreateFunction}
                  addTooltip="Create new function"
                >
                  {filterItems(functions, "function").map((func) => (
                    <SidebarItem
                      key={`${func.schema}.${func.name}`}
                      icon={
                        <IconMathFunction
                          className={cn(
                            "h-3.5 w-4 min-w-4 shrink-0",
                            isProcedure(func)
                              ? "text-orange-500"
                              : "text-purple-500",
                          )}
                        />
                      }
                      name={func.name}
                      isActive={isFunctionActive(func.name, func.schema)}
                      onClick={() => {
                        handleFunctionClick(func);
                      }}
                      isStarred={starredSet.has(
                        `function:${func.schema}.${func.name}`,
                      )}
                      onToggleStar={handleToggleStar(
                        "function",
                        func.name,
                        func.schema,
                      )}
                      isSelected={selectedItems.has(`function:${func.schema}.${func.name}`)}
                      onContextMenu={(e) => handleContextMenu(`function:${func.schema}.${func.name}`, e)}
                    />
                  ))}
                </SidebarSection>
              )}

              {/* Empty state - SQL */}
              {!isLoadingData &&
                tables.length === 0 &&
                views.length === 0 &&
                functions.length === 0 && (
                  <div className="text-center py-4 pl-2 pr-1">
                    <p className="text-xs text-muted-foreground mb-3">
                      {schema ? "No objects found" : "Select a schema"}
                    </p>
                    {schema && (
                      <div className="flex flex-col gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-xs h-6"
                          onClick={handleCreateTable}
                        >
                          <IconTable className="h-3 w-3 mr-1" />
                          Create Table
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-xs h-6"
                          onClick={handleCreateView}
                        >
                          <IconEye className="h-3 w-3 mr-1" />
                          Create View
                        </Button>
                      </div>
                    )}
                  </div>
                )}
            </div>
          )}

          {/* Object tree - MongoDB */}
          {isDocumentDb && !showLoadingSkeleton && (
            <div className="pb-2">
              {/* Collections Section */}
              <SidebarSection
                title="Collections"
                count={mongoCollections.length}
                isExpanded={expandedNodes.has("collections")}
                onToggle={() => {
                  toggleNode("collections");
                }}
                stickyClass=""
              >
                {isLoadingCollections ? (
                  <div className="pl-2 pr-1 py-2">
                    <Skeleton className="h-4 w-full mb-1" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : collectionsError ? (
                  <div className="pl-2 pr-1 py-1 text-xs text-red-500">
                    Failed to load collections
                  </div>
                ) : mongoCollections.length === 0 ? (
                  <div className="text-center py-3 text-xs text-muted-foreground">
                    No collections found
                  </div>
                ) : (
                  mongoCollections
                    .filter((c) =>
                      searchQuery
                        ? c.name
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase())
                        : true,
                    )
                    .map((collection) => (
                      <SidebarItem
                        key={collection.name}
                        icon={
                          <IconLayout2 className="h-3.5 w-4 min-w-4 text-emerald-600 shrink-0" />
                        }
                        name={collection.name}
                        isActive={false}
                        onClick={() => {
                          setFocusedConnection(connectionId);
                          const {
                            focusedPanelId,
                            addTab,
                            panelContents,
                            focusPanel,
                          } = useWorkbenchStore.getState();
                          let targetPanelId = focusedPanelId;
                          if (!targetPanelId && panelContents.size > 0) {
                            const firstPanelId = Array.from(
                              panelContents.keys(),
                            )[0];
                            if (firstPanelId) {
                              targetPanelId = firstPanelId;
                              focusPanel(firstPanelId);
                            }
                          }
                          if (targetPanelId) {
                            const tabId = `mongo-${database}-${collection.name}`;
                            addTab(targetPanelId, tabId, {
                              type: "mongo-collection",
                              title: collection.name,
                              connectionId,
                              database,
                              table: collection.name,
                            });
                          }
                        }}
                        rowCount={collection.docCount}
                      />
                    ))
                )}
              </SidebarSection>
            </div>
          )}

          {/* Object tree - Redis */}
          {isKeyValueDb && !showLoadingSkeleton && (
            <div className="pb-2">
              {/* Keys Section */}
              <SidebarSection
                title="Keys"
                count={redisKeyCount}
                isExpanded={expandedNodes.has("keys")}
                onToggle={() => {
                  toggleNode("keys");
                }}
                stickyClass=""
              >
                {isLoadingKeys ? (
                  <div className="pl-2 pr-1 py-2">
                    <Skeleton className="h-4 w-full" />
                  </div>
                ) : (
                  <div className="pl-2 pr-1 py-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <IconKey className="h-4 w-4" />
                      <span>{redisKeyCount.toLocaleString()} total keys</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs h-6"
                      onClick={() => {
                        setFocusedConnection(connectionId);
                        const {
                          focusedPanelId,
                          addTab,
                          panelContents,
                          focusPanel,
                        } = useWorkbenchStore.getState();
                        let targetPanelId = focusedPanelId;
                        if (!targetPanelId && panelContents.size > 0) {
                          const firstPanelId = Array.from(
                            panelContents.keys(),
                          )[0];
                          if (firstPanelId) {
                            targetPanelId = firstPanelId;
                            focusPanel(firstPanelId);
                          }
                        }
                        if (targetPanelId) {
                          const tabId = `redis-keys-${connectionId}`;
                          addTab(targetPanelId, tabId, {
                            type: "redis-keys",
                            title: "Key Browser",
                            connectionId,
                            database,
                          });
                        }
                      }}
                    >
                      <IconKey className="h-3 w-3 mr-1" />
                      Open Key Browser
                    </Button>
                  </div>
                )}
              </SidebarSection>
            </div>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu?.visible && selectedItems.size > 0 && (
        <DatabaseSidebarContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedCount={selectedItems.size}
          selectedTypes={getSelectedTypesBreakdown()}
          onClose={() => {
            setContextMenu(null);
            setSelectedItems(new Set());
          }}
          onExport={handleExport}
          onCopyName={handleCopyName}
          onCopyDefinition={handleCopyDefinition}
          onPin={handlePin}
          onTruncate={handleTruncate}
          onDelete={handleDelete}
          onViewData={handleViewData}
          onViewStructure={handleViewStructure}
          onViewIndexes={handleViewIndexes}
          onViewTriggers={handleViewTriggers}
          onViewDefinition={handleViewDefinition}
        />
      )}
    </div>
  );
});
