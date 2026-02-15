/**
 * ConnectionSection.tsx
 *
 * A VS Code-style collapsible section for a single database connection.
 * Shows connection header with icon, name, status indicator, and when expanded:
 * - Schema dropdown (SQL databases only)
 * - Tables/Views/Functions sections
 */

import { useState, useEffect, useMemo, useCallback, forwardRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import {
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
  IconSitemap,
  IconDatabaseExport,
  IconCopy,
  IconDatabase,
  IconLock,
  IconLockOpen,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { buildConnectionUri } from "@/utils/connectionParser";
import { useSchemaData } from "@/hooks/useSchemaData";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { isMySQLCompatible, getParadigm, DbType, type SafeMode } from "@/types/connection";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import type { CollectionInfo } from "@/adapters/types/mongodb";
import type { OpenConnection } from "@/types/workspace";
import {
  SidebarSection,
  SidebarItem,
  ActionButton,
  DraggableSidebarItem,
  type SidebarItemDragData,
} from "./DatabaseSidebarItem";
import { PartitionSubTree } from "./PartitionSubTree";
import { type TableMeta, type FunctionMeta } from "@/services/databaseService";
import {
  openFunctionObject,
  openTableObject,
  openTableDesigner,
  openCollectionDesigner,
  openQueryWithTemplate,
  openQueryWithSql,
  openErdView,
} from "@/utils/workbench/openers";
import {
  useStarredItemsStore,
  type StarredItemType,
} from "@/stores/starredItemsStore";
import { useCrudStore } from "@/stores/crudStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import type { TableCreatePayload } from "@/types/crud";
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
import { windowManager } from "@/services/windowManager";
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

interface DraftTableItem {
  key: string;
  schema: string;
  name: string;
  displayName: string;
  panelId?: string;
  tabId?: string;
  timestamp: number;
}

const parseDesignerTag = (
  tags: string[] | undefined,
): { panelId: string; tabId: string } | null => {
  const tag = tags?.find((item) => item.startsWith("table-designer:"));
  if (!tag) return null;
  const parts = tag.split(":");
  if (parts.length < 3) return null;
  const panelId = parts[1];
  const tabId = parts[2];
  if (!panelId || !tabId) return null;
  return { panelId, tabId };
};

export const ConnectionSection = forwardRef<
  HTMLDivElement,
  ConnectionSectionProps
>(function ConnectionSection(
  {
    connection,
    isExpanded: _isExpanded,
    onToggle: _onToggle,
    searchQuery,
    onTableClick,
    onFunctionClick,
  },
  ref,
) {
  // Note: isExpanded and onToggle are intentionally unused - connections are always expanded
  void _isExpanded;
  void _onToggle;
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
    new Set(["tables", "views", "starred", "collections"]),
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

  // Get Redis databases info from keyspace
  type RedisDatabaseInfo = { db: number; keys: number; expires: number };
  const { data: redisDatabases = [], isLoading: isLoadingKeys } = useQuery({
    queryKey: ["redis-databases", connectionId],
    queryFn: async () => {
      const infoStr = await invoke<string>("redis_info", {
        connId: connectionId,
      });
      // Parse keyspace section: db0:keys=237,expires=0,avg_ttl=0
      const databases: RedisDatabaseInfo[] = [];
      const lines = infoStr.split('\n');
      for (const line of lines) {
        const match = line.match(/^db(\d+):keys=(\d+),expires=(\d+)/);
        if (match) {
          databases.push({
            db: parseInt(match[1], 10),
            keys: parseInt(match[2], 10),
            expires: parseInt(match[3], 10),
          });
        }
      }
      // Sort by database number
      databases.sort((a, b) => a.db - b.db);
      // If no databases have keys, show db0 with 0 keys
      if (databases.length === 0) {
        databases.push({ db: 0, keys: 0, expires: 0 });
      }
      return databases;
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
  } = useWorkspaceBundleStore(
    useShallow((s) => ({
      reconnectConnection: s.reconnectConnection,
      removeConnectionFromWorkspace: s.removeConnectionFromWorkspace,
      setFocusedConnection: s.setFocusedConnection,
      updateConnectionState: s.updateConnectionState,
    })),
  );
  const { toggleStarred, getStarredItems } = useStarredItemsStore();
  const stagedCommands = useCrudStore((s) => s.stagedCommands);
  const panelContents = useWorkbenchStore((s) => s.panelContents);
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const focusWorkbenchPanel = useWorkbenchStore((s) => s.focusPanel);
  const focusedPanelId = usePanelFocusStore((s) => s.focusedPanelId);

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

  const draftTables = useMemo(() => {
    const drafts = new Map<string, DraftTableItem>();

    stagedCommands.forEach((commands) => {
      commands.forEach((command) => {
        if (command.type !== "table.create") return;
        const target = command.target;
        if (target.connectionId !== connectionId) return;
        if (target.database !== database) return;

        const payload = command.payload as TableCreatePayload;
        const payloadName = payload.tableName.trim();
        const targetName = (target.table || "").trim();
        const schemaName =
          (target.schema || schema || "public").trim();
        const resolvedName = payloadName || targetName;
        if (!resolvedName) return;

        const existsAsTable = tables.some(
          (table) => table.schema === schemaName && table.name === resolvedName,
        );
        const existsAsView = views.some(
          (view) => view.schema === schemaName && view.name === resolvedName,
        );
        if (existsAsTable || existsAsView) return;

        const location = parseDesignerTag(command.metadata.tags);
        const displayName =
          payloadName ||
          (targetName.startsWith("__new_table_") ? "New Table" : targetName);
        const key = `${schemaName}.${resolvedName}`;
        const timestampMs = Date.parse(command.metadata.timestamp);
        const timestamp = Number.isNaN(timestampMs) ? 0 : timestampMs;
        const existing = drafts.get(key);

        if (!existing || timestamp >= existing.timestamp) {
          drafts.set(key, {
            key,
            schema: schemaName,
            name: resolvedName,
            displayName,
            panelId: location?.panelId,
            tabId: location?.tabId,
            timestamp,
          });
        }
      });
    });

    return Array.from(drafts.values()).sort((a, b) => {
      if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
      return a.key.localeCompare(b.key);
    });
  }, [stagedCommands, connectionId, database, schema, tables, views]);

  const sidebarDraftTables = useMemo(() => {
    const merged = new Map<string, DraftTableItem>();
    draftTables.forEach((draft) => {
      merged.set(draft.key, draft);
    });

    pendingChangesSet.forEach((pendingKey) => {
      if (merged.has(pendingKey)) return;
      const dotIndex = pendingKey.indexOf(".");
      if (dotIndex <= 0 || dotIndex === pendingKey.length - 1) return;

      const schemaName = pendingKey.slice(0, dotIndex);
      const tableName = pendingKey.slice(dotIndex + 1);
      const existsAsTable = tables.some(
        (table) => table.schema === schemaName && table.name === tableName,
      );
      const existsAsView = views.some(
        (view) => view.schema === schemaName && view.name === tableName,
      );
      if (existsAsTable || existsAsView) return;

      merged.set(pendingKey, {
        key: pendingKey,
        schema: schemaName,
        name: tableName,
        displayName: tableName.startsWith("__new_table_")
          ? "New Table"
          : tableName,
        timestamp: 0,
      });
    });

    return Array.from(merged.values()).sort((a, b) => {
      if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
      return a.key.localeCompare(b.key);
    });
  }, [draftTables, pendingChangesSet, tables, views]);

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
  const tableSectionCount = nonStarredCounts.tables + sidebarDraftTables.length;

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

  // Toggle all sections - collapse all if any expanded, expand all if all collapsed
  const toggleAllSections = useCallback(() => {
    const allSections = isSqlDb
      ? ["starred", "tables", "views", "functions"]
      : isDocumentDb
        ? ["collections"]
        : []; // Redis has no collapsible sections

    if (allSections.length === 0) return;

    // Check if any section is currently expanded
    const anyExpanded = allSections.some((s) => expandedNodes.has(s));

    if (anyExpanded) {
      // Collapse all
      setExpandedNodes(new Set());
      setExpandedPartitionedTables(new Set());
    } else {
      // Expand all
      setExpandedNodes(new Set(allSections));
    }
  }, [expandedNodes, isSqlDb, isDocumentDb]);

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
    if (!focusedPanelId) return false;
    const focusedPanel = panelContents.get(focusedPanelId);
    if (!focusedPanel || !focusedPanel.activeTabId) return false;
    const metadata = focusedPanel.metadata?.[focusedPanel.activeTabId];
    return (
      metadata?.type === "table" &&
      metadata.table === tableName &&
      metadata.schema === tableSchema &&
      metadata.connectionId === connectionId
    );
  };

  const isFunctionActive = (
    functionName: string,
    functionSchema: string,
  ): boolean => {
    if (!focusedPanelId) return false;
    const focusedPanel = panelContents.get(focusedPanelId);
    if (!focusedPanel || !focusedPanel.activeTabId) return false;
    const metadata = focusedPanel.metadata?.[focusedPanel.activeTabId];
    return (
      metadata?.type === "function" &&
      metadata.schema === functionSchema &&
      metadata.functionName === functionName &&
      metadata.connectionId === connectionId
    );
  };

  const isMongoCollectionActive = (collectionName: string): boolean => {
    if (!database || !focusedPanelId) return false;
    const focusedPanel = panelContents.get(focusedPanelId);
    const focusedTabId = focusedPanel?.activeTabId;
    if (!focusedPanel || !focusedTabId) return false;
    const metadata = focusedPanel.metadata?.[focusedTabId];
    return (
      metadata?.type === "mongo-collection" &&
      metadata.connectionId === connectionId &&
      metadata.database === database &&
      metadata.table === collectionName
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

  const handleCreateCollection = () => {
    setFocusedConnection(connectionId);
    openCollectionDesigner({
      connectionId,
      database,
    });
  };

  // Handle schema change
  const handleSchemaChange = (newSchema: string) => {
    updateConnectionState(connectionId, database, newSchema);
  };

  // Handle backup/restore
  const handleBackupRestore = async () => {
    try {
      // Use profile.id (stored profile UUID), not connectionId (runtime ID)
      await windowManager.openBackupRestore(profile.id);
    } catch (error) {
      toast.error("Failed to open backup/restore", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  // Handle open ERD
  const handleOpenErd = () => {
    setFocusedConnection(connectionId);
    openErdView({
      connectionId,
      connectionName: profile.name,
      database,
      schema: schema || "public",
    });
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
    const breakdown = {
      tables: 0,
      views: 0,
      materializedViews: 0,
      functions: 0,
    };
    selectedItems.forEach((key) => {
      const [type] = key.split(":");
      if (type === "table") breakdown.tables++;
      else if (type === "view") {
        const viewItem = views.find(
          (v) => `view:${v.schema}.${v.name}` === key,
        );
        if (viewItem?.kind === "MaterializedView")
          breakdown.materializedViews++;
        else breakdown.views++;
      } else if (type === "function") breakdown.functions++;
    });
    return breakdown;
  };

  const getSelectedItems = () => {
    const items: Array<{
      type: string;
      schema: string;
      name: string;
      kind?: string;
    }> = [];
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
        const viewItem = views.find(
          (v) => v.schema === itemSchema && v.name === name,
        );
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

  const handleCopyDefinition = () => {
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
        const meta =
          item.type === "table"
            ? tables.find(
                (t) => t.schema === item.schema && t.name === item.name,
              )
            : views.find(
                (v) => v.schema === item.schema && v.name === item.name,
              );
        if (meta) handleTableClick(meta, "data");
      }
    });
    setSelectedItems(new Set());
  };

  const handleViewStructure = () => {
    const items = getSelectedItems();
    items.forEach((item) => {
      if (item.type === "table" || item.type === "view") {
        const meta =
          item.type === "table"
            ? tables.find(
                (t) => t.schema === item.schema && t.name === item.name,
              )
            : views.find(
                (v) => v.schema === item.schema && v.name === item.name,
              );
        if (meta) handleTableClick(meta, "structure");
      }
    });
    setSelectedItems(new Set());
  };

  const handleViewIndexes = () => {
    const items = getSelectedItems();
    items.forEach((item) => {
      if (item.type === "table" || item.type === "view") {
        const meta =
          item.type === "table"
            ? tables.find(
                (t) => t.schema === item.schema && t.name === item.name,
              )
            : views.find(
                (v) => v.schema === item.schema && v.name === item.name,
              );
        if (meta) handleTableClick(meta, "indexes");
      }
    });
    setSelectedItems(new Set());
  };

  const handleViewTriggers = () => {
    const items = getSelectedItems();
    items.forEach((item) => {
      if (item.type === "table") {
        const meta = tables.find(
          (t) => t.schema === item.schema && t.name === item.name,
        );
        if (meta) handleTableClick(meta, "triggers");
      }
    });
    setSelectedItems(new Set());
  };

  const handleViewDefinition = () => {
    const items = getSelectedItems();
    items.forEach((item) => {
      if (item.type === "table" || item.type === "view") {
        const meta =
          item.type === "table"
            ? tables.find(
                (t) => t.schema === item.schema && t.name === item.name,
              )
            : views.find(
                (v) => v.schema === item.schema && v.name === item.name,
              );
        if (meta) handleTableClick(meta, "definition");
      } else if (item.type === "function") {
        const meta = functions.find(
          (f) => f.schema === item.schema && f.name === item.name,
        );
        if (meta) handleFunctionClick(meta);
      }
    });
    setSelectedItems(new Set());
  };

  // Section context menu handlers
  const handleSelectAllTables = () => {
    const tableKeys = tables.map((t) => `table:${t.schema}.${t.name}`);
    setSelectedItems(new Set(tableKeys));
  };

  const handleSelectAllViews = () => {
    const viewKeys = views.map((v) => `view:${v.schema}.${v.name}`);
    setSelectedItems(new Set(viewKeys));
  };

  const handleSelectAllFunctions = () => {
    const funcKeys = functions.map((f) => `function:${f.schema}.${f.name}`);
    setSelectedItems(new Set(funcKeys));
  };

  const handleCopyAllTableNames = useCallback(async () => {
    const names = tables.map((t) => t.name).join("\n");
    await writeClipboardText(names);
    toast.success("Copied to clipboard", {
      description: `${tables.length} table names`,
    });
  }, [tables]);

  const handleCopyAllViewNames = useCallback(async () => {
    const names = views.map((v) => v.name).join("\n");
    await writeClipboardText(names);
    toast.success("Copied to clipboard", {
      description: `${views.length} view names`,
    });
  }, [views]);

  const handleCopyAllFunctionNames = useCallback(async () => {
    const names = functions.map((f) => f.name).join("\n");
    await writeClipboardText(names);
    toast.success("Copied to clipboard", {
      description: `${functions.length} function names`,
    });
  }, [functions]);

  // Status indicator color
  const statusColor =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
      ? "bg-yellow-500 animate-pulse"
      : status === "error"
      ? "bg-red-500"
      : "bg-gray-400";

  // Show loading state when connecting and no data yet
  const showLoadingSkeleton =
    status === "connecting" &&
    (isSqlDb
      ? tables.length === 0
      : isDocumentDb
      ? mongoCollections.length === 0
      : true);

  return (
    <div ref={ref}>
      {/* Connection Header */}
      <ContextMenu>
        <ContextMenuTrigger
          className={cn(
            "w-full flex items-center gap-2 p-2 hover:bg-muted/50 transition-colors text-left cursor-pointer",
            "sticky top-0 z-10 bg-background",
          )}
          onClick={toggleAllSections}
        >
          {/* Database icon */}
          <img
            src={getDatabaseLogo(dbType)}
            alt={dbType}
            className="h-3.5 w-3.5 shrink-0"
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
              className="shrink-0 -mt-1"
            >
              <SchemaDropdown
                connectionId={connectionId}
                selectedSchema={schema}
                onSchemaChange={handleSchemaChange}
              />
            </div>
          )}

          {/* Safe mode indicator */}
          {(() => {
            const safeMode: SafeMode = profile.safe_mode ?? "full_access";
            const safeModeLabel = {
              read_only: "Read Only",
              read_write: "Read + Write",
              read_write_update: "Read + Write + Update",
              full_access: "Full Access",
            }[safeMode];
            return (
              <button
                className="shrink-0 p-0.5 rounded hover:bg-muted/80 transition-colors"
                title={`Safe Mode: ${safeModeLabel}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const { openPalette, setNestedMode } =
                    useCommandPaletteStore.getState();
                  openPalette();
                  setTimeout(
                    () => {
                      setNestedMode({ type: "set-safe-mode" });
                    },
                    0,
                  );
                }}
              >
                {safeMode === "full_access" ? (
                  <IconLockOpen className="h-3 w-3 text-green-500" />
                ) : safeMode === "read_only" ? (
                  <IconLock className="h-3 w-3 text-red-500" />
                ) : safeMode === "read_write" ? (
                  <IconLock className="h-3 w-3 text-orange-500" />
                ) : (
                  <IconLock className="h-3 w-3 text-yellow-500" />
                )}
              </button>
            );
          })()}

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
          <ContextMenuItem
            onClick={() => {
              const uri = buildConnectionUri(profile, false);
              void writeClipboardText(uri);
              toast.success("Connection URI copied to clipboard");
            }}
          >
            <IconCopy className="h-4 w-4 mr-2" />
            Copy Connection URI
          </ContextMenuItem>
          {isSqlDb && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleOpenErd}>
                <IconSitemap className="h-4 w-4 mr-2" />
                View ERD
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void handleBackupRestore()}>
            <IconDatabaseExport className="h-4 w-4 mr-2" />
            Backup/Restore...
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

      {/* Content - always visible */}
      {status !== "error" && (
        <div className="pr-2">
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

                    const starredDragData: SidebarItemDragData = item.type === "function"
                      ? {
                          type: "sidebar-item",
                          objectType: isProcedure(itemData as FunctionMeta) ? "procedure" : "function",
                          name: item.name,
                          func: itemData as FunctionMeta,
                          connectionId,
                          database,
                          schema: item.schema,
                        }
                      : {
                          type: "sidebar-item",
                          objectType: item.type,
                          name: item.name,
                          table: itemData as TableMeta,
                          connectionId,
                          database,
                          schema: item.schema,
                          kind: (itemData as TableMeta).kind,
                        };

                    return (
                      <DraggableSidebarItem
                        key={item.id}
                        dragId={`sidebar-starred-${connectionId}-${item.type}-${item.schema}.${item.name}`}
                        dragData={starredDragData}
                      >
                      <SidebarItem
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
                      </DraggableSidebarItem>
                    );
                  })}
                </SidebarSection>
              )}

              {/* Tables Section */}
              {(tableSectionCount > 0 || isLoadingData) && (
                <SidebarSection
                  title="Tables"
                  count={tableSectionCount}
                  isExpanded={expandedNodes.has("tables")}
                  onToggle={() => {
                    toggleNode("tables");
                  }}
                  stickyClass=""
                  onAdd={handleCreateTable}
                  addTooltip="Create new table"
                  onSelectAll={handleSelectAllTables}
                  onCopyAllNames={handleCopyAllTableNames}
                >
                  {sidebarDraftTables.map((draft) => {
                    const isDraftActive = Boolean(
                      draft.panelId &&
                        draft.tabId &&
                        focusedPanelId === draft.panelId &&
                        panelContents.get(draft.panelId)?.activeTabId ===
                          draft.tabId,
                    );
                    return (
                      <SidebarItem
                        key={`draft:${draft.key}`}
                        icon={
                          <IconTable className="h-3.5 w-4 min-w-4 text-emerald-600 shrink-0" />
                        }
                        name={draft.displayName}
                        badge="draft"
                        isActive={isDraftActive}
                        onClick={() => {
                          if (!draft.panelId || !draft.tabId) return;
                          focusWorkbenchPanel(draft.panelId);
                          setActiveTab(draft.panelId, draft.tabId);
                        }}
                        className="bg-emerald-500/10 border-l-emerald-500"
                      />
                    );
                  })}
                  {filterItems(tables, "table").map((table) => {
                    const tableKey = `${table.schema}.${table.name}`;
                    // MySQL/MariaDB don't support browsing partition tables yet
                    const isPartitioned =
                      table.isPartitioned === true && !isMySQLDb;
                    const isPartitionExpanded =
                      expandedPartitionedTables.has(tableKey);
                    const tableDragData: SidebarItemDragData = {
                      type: "sidebar-item",
                      objectType: "table",
                      name: table.name,
                      table,
                      connectionId,
                      database,
                      schema: table.schema,
                      kind: table.kind,
                    };
                    return (
                      <DraggableSidebarItem
                        key={tableKey}
                        dragId={`sidebar-table-${connectionId}-${tableKey}`}
                        dragData={tableDragData}
                      >
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
                          isSelected={selectedItems.has(
                            `table:${table.schema}.${table.name}`,
                          )}
                          onContextMenu={(e) => {
                            handleContextMenu(
                              `table:${table.schema}.${table.name}`,
                              e,
                            );
                          }}
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
                            onPartitionClick={(partition) => {
                              if (
                                dbType === DbType.SQLServer &&
                                partition.partition_function_name &&
                                partition.partition_expression
                              ) {
                                // MSSQL partitions are not separate tables - query parent table filtered by partition number
                                const qi = (n: string) =>
                                  `[${n.replace(/]/g, "]]")}]`;
                                const tableRef = `${qi(partition.schema)}.${qi(partition.table_name)}`;
                                const sql = `SELECT TOP 1000 * FROM ${tableRef}\nWHERE $PARTITION.${qi(partition.partition_function_name)}(${qi(partition.partition_expression)}) = ${partition.partition_ordinal_position}`;
                                openQueryWithSql({
                                  connectionId,
                                  database,
                                  schema: partition.schema,
                                  sql,
                                  title: `${partition.table_name} - ${partition.partition_name}`,
                                });
                              } else {
                                // PostgreSQL partitions are actual child tables
                                const partitionTable: TableMeta = {
                                  schema: partition.schema,
                                  name: partition.partition_name,
                                  kind: "Table",
                                };
                                handleTableClick(partitionTable, "data");
                              }
                            }}
                            isPartitionActive={(
                              partitionName,
                              partitionSchema,
                            ) => isTableActive(partitionName, partitionSchema)}
                          />
                        )}
                      </DraggableSidebarItem>
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
                  onSelectAll={handleSelectAllViews}
                  onCopyAllNames={handleCopyAllViewNames}
                >
                  {filterItems(views, "view").map((view) => {
                    const viewDragData: SidebarItemDragData = {
                      type: "sidebar-item",
                      objectType: "view",
                      name: view.name,
                      table: view,
                      connectionId,
                      database,
                      schema: view.schema,
                      kind: view.kind,
                    };
                    return (
                    <DraggableSidebarItem
                      key={`${view.schema}.${view.name}`}
                      dragId={`sidebar-view-${connectionId}-${view.schema}.${view.name}`}
                      dragData={viewDragData}
                    >
                    <SidebarItem
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
                      isSelected={selectedItems.has(
                        `view:${view.schema}.${view.name}`,
                      )}
                      onContextMenu={(e) => {
                        handleContextMenu(
                          `view:${view.schema}.${view.name}`,
                          e,
                        );
                      }}
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
                    </DraggableSidebarItem>
                    );
                  })}
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
                  onSelectAll={handleSelectAllFunctions}
                  onCopyAllNames={handleCopyAllFunctionNames}
                >
                  {filterItems(functions, "function").map((func) => {
                    const funcDragData: SidebarItemDragData = {
                      type: "sidebar-item",
                      objectType: isProcedure(func) ? "procedure" : "function",
                      name: func.name,
                      func,
                      connectionId,
                      database,
                      schema: func.schema,
                    };
                    return (
                    <DraggableSidebarItem
                      key={`${func.schema}.${func.name}`}
                      dragId={`sidebar-func-${connectionId}-${func.schema}.${func.name}`}
                      dragData={funcDragData}
                    >
                    <SidebarItem
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
                      isSelected={selectedItems.has(
                        `function:${func.schema}.${func.name}`,
                      )}
                      onContextMenu={(e) => {
                        handleContextMenu(
                          `function:${func.schema}.${func.name}`,
                          e,
                        );
                      }}
                    />
                    </DraggableSidebarItem>
                    );
                  })}
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
                onAdd={handleCreateCollection}
                addTooltip="Create new collection"
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
                  <div className="text-center py-3 text-xs text-muted-foreground space-y-2">
                    <div>No collections found</div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={handleCreateCollection}
                    >
                      Create Collection
                    </Button>
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
                      <DraggableSidebarItem
                        key={collection.name}
                        dragId={`sidebar-mongo-${connectionId}-${database}-${collection.name}`}
                        dragData={{
                          type: "sidebar-item",
                          objectType: "mongo-collection",
                          name: collection.name,
                          connectionId,
                          database,
                          schema: "",
                        }}
                      >
                        <SidebarItem
                          icon={
                            <IconLayout2 className="h-3.5 w-4 min-w-4 text-emerald-600 shrink-0" />
                          }
                          name={collection.name}
                          isActive={isMongoCollectionActive(collection.name)}
                          onClick={() => {
                            setFocusedConnection(connectionId);
                            const {
                              addTab,
                              panelContents,
                              focusPanel,
                            } = useWorkbenchStore.getState();
                            let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
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
                      </DraggableSidebarItem>
                    ))
                )}
              </SidebarSection>
            </div>
          )}

          {/* Object tree - Redis databases */}
          {isKeyValueDb && !showLoadingSkeleton && (
            <div className="pb-2">
              {isLoadingKeys ? (
                <div className="pl-2 pr-1 py-2 space-y-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : (
                redisDatabases.map((dbInfo) => {
                  const dbTabId = `redis-key-${connectionId}-db${dbInfo.db}`;
                  const isActive =
                    !!focusedPanelId &&
                    panelContents.get(focusedPanelId)?.activeTabId === dbTabId;

                  return (
                    <DraggableSidebarItem
                      key={dbInfo.db}
                      dragId={`sidebar-redis-${connectionId}-db${dbInfo.db}`}
                      dragData={{
                        type: "sidebar-item",
                        objectType: "redis-key",
                        name: `db${dbInfo.db}`,
                        connectionId,
                        database: String(dbInfo.db),
                        schema: "",
                        redisDb: dbInfo.db,
                      }}
                    >
                      <SidebarItem
                        icon={
                          <IconDatabase className="h-3.5 w-4 min-w-4 text-orange-500 shrink-0" />
                        }
                        name={`db${dbInfo.db}`}
                        rowCount={dbInfo.keys}
                        isActive={isActive}
                        onClick={() => {
                          setFocusedConnection(connectionId);
                          const {
                            addTab,
                            panelContents,
                            focusPanel,
                          } = useWorkbenchStore.getState();
                          let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
                          if (!targetPanelId && panelContents.size > 0) {
                            const firstPanelId = Array.from(
                              panelContents.keys()
                            )[0];
                            if (firstPanelId) {
                              targetPanelId = firstPanelId;
                              focusPanel(firstPanelId);
                            }
                          }
                          if (targetPanelId) {
                            addTab(targetPanelId, dbTabId, {
                              type: "redis-key",
                              title: `db${dbInfo.db}`,
                              connectionId,
                              database: dbInfo.db,
                            });
                          }
                        }}
                      />
                    </DraggableSidebarItem>
                  );
                })
              )}
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
