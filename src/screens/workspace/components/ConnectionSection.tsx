/**
 * ConnectionSection.tsx
 *
 * A VS Code-style collapsible section for a single database connection.
 * Shows connection header with icon, name, status indicator, and when expanded:
 * - Schema dropdown (SQL databases only)
 * - Tables/Views/Functions sections
 */

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  forwardRef,
  useId,
} from "react";
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
  IconCopy,
  IconDatabase,
  IconFileImport,
  IconFolderOpen,
  IconLink,
  IconLock,
  IconLockOpen,
  IconHash,
  IconPackage,
  IconPlus,
  IconFileExport,
  IconKey,
  IconPuzzle,
  IconBuildingWarehouse,
  IconPlugConnectedX,
  IconFileCode,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { buildConnectionUri } from "@/utils/connectionParser";
import { useSchemaData } from "@/hooks/useSchemaData";
import {
  useDuckDbSidebarDrop,
  type DroppedFile,
} from "@/hooks/useDuckDbSidebarDrop";
import { refreshConnectionData } from "@/lib/refreshConnectionData";
import { FunctionFilterDropdown } from "./FunctionFilterDropdown";
import {
  RedisDbFilterDropdown,
  type RedisDatabaseInfo,
} from "./RedisDbFilterDropdown";
import { useRedisDbFilterStore } from "@/stores/useRedisDbFilterStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import {
  isMySQLCompatible,
  getParadigm,
  DbType,
  type Attachment,
  type AttachmentKind,
  type SafeMode,
} from "@/types/connection";
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
import {
  databaseService,
  type TableMeta,
  type FunctionMeta,
  type SequenceMeta,
  type PackageMeta,
  type SynonymMeta,
} from "@/services/databaseService";
import {
  openFunctionObject,
  openSqlObjectDefinition,
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
import { CrudCommandFactory } from "@/services/crudCommandFactory";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import type { TableCreatePayload } from "@/types/crud";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SchemaDropdown } from "./SchemaDropdown";
import { PrimaryBadge } from "@/components/badges/PrimaryBadge";
import { CatalogSection } from "./CatalogSection";
import { CatalogSchemaFilter } from "./CatalogSchemaFilter";
import { DatabaseSidebarContextMenu } from "./DatabaseSidebarContextMenu";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import {
  exportSidebarObjectDataToFile,
  exportSidebarObjectsToFile,
  exportSidebarObjectsAsDBML,
  exportSidebarObjectsAsMermaid,
  type SidebarDataExportFormat,
  type SidebarDataExportItem,
  type SidebarExportItem,
} from "./databaseSidebarExport";
import {
  buildMongoCollectionDefinition,
  buildMongoCollectionMetadataCommand,
  buildMongoCollectionMetadataQuery,
  buildRedisDatabaseDefinition,
  buildRedisSelectCommand,
  canSnapshotToDuckDb,
  canCopyDefinition,
  canDelete,
  canTruncate,
  getSqlTruncateOptionSupport,
  isImmediateExecution,
  type SidebarSelectedTypes,
} from "./sidebarContextMenuHelpers";
import {
  defaultDuckDbTargetNameFromFile,
  defaultDuckDbTargetNameFromSnapshotSource,
  describeDuckDbSnapshotSource,
  fetchRedisSnapshotRawValue,
  sanitizeDuckDbObjectName,
  type DuckDbSnapshotSource,
} from "./duckDbScratchpadHelpers";
import { toast } from "sonner";
import { writeClipboardText } from "@/lib/clipboard";
import { getAdapterForConnection } from "@/adapters";
import type { DatabaseAdapter } from "@/adapters/types";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import { RedisAdapter } from "@/adapters/redis/RedisAdapter";
import { queryStreamClient } from "@/services/queryStreamClient";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import {
  DuckDbScratchpadService,
  type DuckDbManagedObjectLineage,
  type DuckDbRedisSnapshotEntry,
} from "@/services/duckDbScratchpadService";
import type {
  DocumentResult,
  KeyValueOperation,
  KeyValueResult,
} from "@/adapters/types/ipc";
import type { QueryColumnMeta, RawCellValue } from "@/services/backend";
import { BackendAPI } from "@/services/backend";
import {
  DuckDbAddFileDialog,
  type DuckDbAddFileDialogItem,
  type DuckDbImportFileFormat,
} from "./DuckDbAddFileDialog";
import { DuckDbImportUrlDialog } from "./DuckDbImportUrlDialog";
import { DuckDbGlobHelperDialog } from "./DuckDbGlobHelperDialog";
import { DuckDbAttachDatabaseDialog } from "./DuckDbAttachDatabaseDialog";
import {
  DuckDbAttachCatalogDialog,
  type DuckDbAttachCatalogSubmitOptions,
} from "./DuckDbAttachCatalogDialog";
import { DuckDbAttachedDatabaseSection } from "./DuckDbAttachedDatabaseSection";
import { DuckDbSecretsPanel } from "./DuckDbSecretsPanel";
import { DuckDbExtensionsPanel } from "./DuckDbExtensionsPanel";
import { useRuntimeDatabasesStore } from "@/stores/runtimeDatabasesStore";
import { vaultStorage } from "@/services/vaultStorage";
import {
  addDatabaseAttachment,
  removeAttachment,
} from "@/services/duckdbAttachmentOrchestrator";
import {
  DuckDbTablesDropdown,
  type DuckDbConnectedSource,
} from "./DuckDbTablesDropdown";
import { DuckDbExportDialog, type DuckDbExportSourceProp } from "./DuckDbExportDialog";
import {
  SnapshotToDuckDbDialog,
  type DuckDbScratchpadOption,
} from "./SnapshotToDuckDbDialog";

const { open } = await import("@tauri-apps/plugin-dialog");
const { revealItemInDir } = await import("@tauri-apps/plugin-opener");

function detectDuckDbImportFormat(filePath: string): DuckDbImportFileFormat | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".parquet")) return "parquet";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".tsv")) return "tsv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".ndjson")) return "ndjson";
  if (lower.endsWith(".xlsx")) return "xlsx";
  return null;
}

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

interface SidebarSelectionItem {
  type: "table" | "view" | "function" | "collection";
  schema: string;
  name: string;
  kind?: TableMeta["kind"];
  routineType?: FunctionMeta["routine_type"];
  returnType?: FunctionMeta["return_type"];
}

interface PendingConfirmAction {
  kind?:
    | "sql-truncate"
    | "sql-delete"
    | "nosql-truncate"
    | "nosql-delete"
    | "redis-truncate";
  title: string;
  description: string;
  entityName?: string;
  confirmLabel?: string;
  confirmVariant?: "destructive" | "default";
  onConfirm: () => Promise<void>;
}

const DEFAULT_DUCKDB_SCHEMA = "main";
const DEFAULT_DUCKDB_TABLE_NAME = "scratchpad_data";
const REDIS_SCAN_BATCH_SIZE = 200;
// Shared empty array — avoids creating a new reference on every render when
// no schemas are visible, which would churn downstream useMemo/useEffect deps.
const EMPTY_VISIBLE_SCHEMAS: string[] = [];
const MONGO_SNAPSHOT_BATCH_SIZE = 500;

function defaultVisibleSchemasFor(kind: AttachmentKind): string[] {
  switch (kind) {
    case "duckdb":
    case "sqlite":
      return ["main"];
    case "postgres":
      return ["public"];
    case "mysql":
    case "iceberg":
    case "delta":
    case "ducklake":
      return [];
  }
}

function expectSourceSpecRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseRedisDbIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
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
  const queryClient = useQueryClient();
  const dbType = profile.db_type;
  const paradigm = getParadigm(dbType);
  const isSqlDb = paradigm === "sql";
  const isDocumentDb = paradigm === "document";
  const isKeyValueDb = paradigm === "keyvalue";
  const isMySQLDb = isMySQLCompatible(dbType);
  const isTrinoDb = dbType === DbType.Trino;

  // Phase 4: Trino catalog list from databases[] (first-class); fall back to
  // legacy trino_catalogs during the migration window, then database name.
  const trinoDatabases = isTrinoDb
    ? profile.databases.length > 0
      ? profile.databases
      : (profile.database ? [{ name: profile.database, visible_schemas: [] as string[] }] : [])
    : undefined;
  // For backward-compat with remaining trinoCatalogs usages in this file:
  const trinoCatalogs = trinoDatabases?.map((d) => d.name) ?? [];
  const trinoCatalogFilter = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.connections.get(connectionId)?.trinoCatalogFilter,
  );

  // Fetch ALL Trino catalogs live (for the filter UI and fallback visibility)
  const { data: allTrinoCatalogs = [], isLoading: isLoadingCatalogs } = useQuery({
    queryKey: ["catalogs", connectionId],
    queryFn: () => databaseService.listDatabases(connectionId),
    enabled: isTrinoDb && !!connectionId,
    staleTime: 60_000,
  });

  // While catalogs load, fall back to previously known catalogs from profile
  const resolvedAllCatalogs = allTrinoCatalogs.length > 0 ? allTrinoCatalogs : trinoCatalogs;
  const visibleTrinoCatalogs =
    trinoCatalogFilter?.visibleCatalogs ?? resolvedAllCatalogs;

  // Local state for expanded sections within this connection
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set([
      "tables",
      "views",
      "starred",
      "collections",
      "sequences",
      "packages",
      "synonyms",
    ]),
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
  const [globalChangesDialogOpen, setGlobalChangesDialogOpen] = useState(false);
  const [pendingConfirmAction, setPendingConfirmAction] =
    useState<PendingConfirmAction | null>(null);
  const [duckDbImportFiles, setDuckDbImportFiles] = useState<
    DuckDbAddFileDialogItem[]
  >([]);
  const [duckDbAddFileDialogOpen, setDuckDbAddFileDialogOpen] = useState(false);
  const [isAddingDuckDbFile, setIsAddingDuckDbFile] = useState(false);
  const [duckDbImportUrlDialogOpen, setDuckDbImportUrlDialogOpen] =
    useState(false);
  const [duckDbImportUrlInitial, setDuckDbImportUrlInitial] = useState<
    string | undefined
  >(undefined);
  const [duckDbGlobHelperDialogOpen, setDuckDbGlobHelperDialogOpen] =
    useState(false);
  const [duckDbAttachDialogOpen, setDuckDbAttachDialogOpen] = useState(false);
  const [duckDbAttachCatalogDialogOpen, setDuckDbAttachCatalogDialogOpen] = useState(false);
  const [duckDbSecretsPanelOpen, setDuckDbSecretsPanelOpen] = useState(false);
  const [duckDbExtensionsPanelOpen, setDuckDbExtensionsPanelOpen] = useState(false);
  const [duckDbExportDialogOpen, setDuckDbExportDialogOpen] = useState(false);
  const [duckDbExportSource, setDuckDbExportSource] = useState<DuckDbExportSourceProp | null>(null);
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const [snapshotSource, setSnapshotSource] =
    useState<DuckDbSnapshotSource | null>(null);
  const [isCreatingDuckDbSnapshot, setIsCreatingDuckDbSnapshot] =
    useState(false);
  const [isRefreshingDuckDbSnapshots, setIsRefreshingDuckDbSnapshots] =
    useState(false);
  const [sqlTruncateOptions, setSqlTruncateOptions] = useState({
    restartIdentity: false,
    cascade: false,
  });
  const restartIdentityOptionId = useId();
  const cascadeOptionId = useId();

  // Function filter mode: "user" (default) shows only user-created, "all" shows everything
  const [functionFilterMode, setFunctionFilterMode] = useState<"user" | "all">(
    "user",
  );
  const [schemaDropdownOpen, setSchemaDropdownOpen] = useState(false);

  // Visible schemas for the current database (used for sidebar schema list).
  // Subscribe to a stable string key (joined with \0) to avoid re-render loops
  // from new array references — `getVisibleSchemas` returns a new `[]` on every
  // call when no entry exists, which otherwise breaks Zustand's `===` selector
  // memoization and re-renders this big component on every unrelated store
  // mutation.
  const visibleSchemasKey = useConnectionStore((s) => {
    const arr = s.getVisibleSchemas(connectionId, database);
    return arr.length > 0 ? arr.join("\0") : "";
  });
  const visibleSchemas = useMemo(
    () => (visibleSchemasKey ? visibleSchemasKey.split("\0") : EMPTY_VISIBLE_SCHEMAS),
    [visibleSchemasKey],
  );

  // For DuckDB: split visible schemas into local (e.g. "main") vs attached (e.g. "pg.public")
  // Attached database schemas are rendered by DuckDbAttachedDatabaseSection, not the schema tree.
  const duckDbLocalSchemas = dbType === DbType.DuckDB
    ? visibleSchemas.filter(s => !s.includes("."))
    : visibleSchemas;
  // Derive attached database names from dotted schemas (e.g. "pg.public" → "pg")
  const duckDbAttachedFromSchemas = dbType === DbType.DuckDB
    ? [...new Set(
        visibleSchemas
          .filter((s) => s.includes("."))
          .map((s) => s.slice(0, s.indexOf(".")))
          .filter(Boolean),
      )]
    : [];

  // Get schema data for SQL databases
  const {
    tables,
    views,
    functions: userFunctions,
    allFunctions,
    sequences,
    packages,
    synonyms,
    isLoading: isLoadingData,
    error: schemaError,
  } = useSchemaData(isSqlDb ? connectionId : undefined);

  const functions = functionFilterMode === "all" ? allFunctions : userFunctions;

  // Get collections for MongoDB
  const {
    data: mongoCollections = [],
    isLoading: isLoadingCollections,
    error: collectionsError,
    refetch: collectionsRefetch,
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
  const {
    data: redisDatabases = [],
    isLoading: isLoadingKeys,
    refetch: refetchRedisDatabases,
  } = useQuery({
    queryKey: ["redis-databases", connectionId],
    queryFn: async () => {
      const infoStr = await invoke<string>("redis_info", {
        connId: connectionId,
      });
      // Parse keyspace section: db0:keys=237,expires=0,avg_ttl=0
      const databases: RedisDatabaseInfo[] = [];
      const lines = infoStr.split("\n");
      for (const line of lines) {
        const match = line.match(/^db(\d+):keys=(\d+),expires=(\d+)/);
        if (match) {
          const [, dbRaw, keysRaw, expiresRaw] = match;
          if (!dbRaw || !keysRaw || !expiresRaw) continue;
          databases.push({
            db: parseInt(dbRaw, 10),
            keys: parseInt(keysRaw, 10),
            expires: parseInt(expiresRaw, 10),
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

  // Get max configured databases from Redis CONFIG
  const { data: redisMaxDbs = 16 } = useQuery({
    queryKey: ["redis-max-databases", connectionId],
    queryFn: async () => {
      return await invoke<number>("redis_max_databases", {
        connId: connectionId,
      });
    },
    enabled: isKeyValueDb && status === "connected",
    staleTime: 300_000, // 5 min — rarely changes
  });

  // Build full database list (db0 through dbN) with key counts
  const allRedisDatabases: RedisDatabaseInfo[] = useMemo(() => {
    const keyMap = new Map(redisDatabases.map((d) => [d.db, d]));
    return Array.from({ length: redisMaxDbs }, (_, i) => ({
      db: i,
      keys: keyMap.get(i)?.keys ?? 0,
      expires: keyMap.get(i)?.expires ?? 0,
    }));
  }, [redisDatabases, redisMaxDbs]);

  // Filter preferences
  const savedVisibleDbs = useRedisDbFilterStore(
    (s) => s.filters[connectionId] ?? null,
  );
  const setVisibleDbs = useRedisDbFilterStore((s) => s.setVisibleDbs);

  const visibleDbSet = useMemo(() => {
    if (savedVisibleDbs !== null) {
      return new Set(savedVisibleDbs);
    }
    // Default: show databases with keys > 0, or db0 if none have keys
    const withKeys = redisDatabases.filter((d) => d.keys > 0).map((d) => d.db);
    return new Set(withKeys.length > 0 ? withKeys : [0]);
  }, [savedVisibleDbs, redisDatabases]);

  const handleVisibleDbsChange = useCallback(
    (dbs: Set<number>) => {
      setVisibleDbs(connectionId, Array.from(dbs));
    },
    [connectionId, setVisibleDbs],
  );

  const filteredRedisDatabases = useMemo(() => {
    return allRedisDatabases.filter((d) => visibleDbSet.has(d.db));
  }, [allRedisDatabases, visibleDbSet]);

  // Detect cluster mode — hide filter for cluster (only db0 supported)
  const isClusterMode = profile.options.mode === "cluster";
  const duckDbFilePath =
    dbType === DbType.DuckDB && typeof profile.database === "string"
      ? profile.database
      : "";

  // Store actions
  const {
    getConnectionById,
    reconnectConnection,
    reconnectDisconnectedConnections,
    removeConnectionFromWorkspace,
    setFocusedConnection,
  } = useWorkspaceBundleStore(
    useShallow((s) => ({
      getConnectionById: s.getConnectionById,
      reconnectConnection: s.reconnectConnection,
      reconnectDisconnectedConnections: s.reconnectDisconnectedConnections,
      removeConnectionFromWorkspace: s.removeConnectionFromWorkspace,
      setFocusedConnection: s.setFocusedConnection,
    })),
  );
  const storedConnections = useConnectionStore((s) => s.connections);
  const duckDbScratchpads = useMemo<DuckDbScratchpadOption[]>(
    () =>
      storedConnections
        .filter((storedConnection) => storedConnection.profile.db_type === DbType.DuckDB)
        .map((storedConnection) => ({
          id: storedConnection.profile.id,
          name: storedConnection.profile.name,
          path: storedConnection.profile.database,
        })),
    [storedConnections],
  );
  const { data: attachedDatabases = [] } = useQuery({
    queryKey: ["attached-databases", connectionId],
    queryFn: () => BackendAPI.duckdbListAttachedDatabases(connectionId),
    enabled: dbType === DbType.DuckDB && status === "connected",
    staleTime: 30_000,
  });

  // Phase 3: runtime databases from replay (non-persisted)
  const runtimeDbs = useRuntimeDatabasesStore((s) => s.get(connectionId));
  const runtimeAttachErrors = runtimeDbs.errors;

  // Connected non-DuckDB connections for snapshot dropdown.
  // Selector returns a stable string key (primitives compare by value),
  // then useMemo builds objects only when the key changes.
  // Using useShallow with object-creating selectors causes infinite re-renders
  // because useShallow shallow-compares array elements by reference.
  const connectedNonDuckDbKey = useWorkspaceBundleStore((s) => {
    const workspace = s.activeWorkspace;
    if (!workspace) return "";
    const parts: string[] = [];
    workspace.connections.forEach((conn) => {
      if (
        conn.id !== connectionId &&
        conn.profile.db_type !== DbType.DuckDB &&
        conn.status === "connected"
      ) {
        parts.push(`${conn.id}\0${conn.profile.name}`);
      }
    });
    return parts.join("\n");
  });
  const connectedNonDuckDbSources = useMemo<DuckDbConnectedSource[]>(() => {
    if (!connectedNonDuckDbKey) return [];
    return connectedNonDuckDbKey.split("\n").map((entry) => {
      const sep = entry.indexOf("\0");
      return { id: entry.slice(0, sep), name: entry.slice(sep + 1) };
    });
  }, [connectedNonDuckDbKey]);
  const toggleStarred = useStarredItemsStore((s) => s.toggleStarred);
  const starredStoreItems = useStarredItemsStore((s) => s.items);
  // Scoped version: only re-render when THIS connection's commands change (#10 fix)
  const connectionCommandsVersion = useCrudStore((s) => {
    let hash = "";
    s.stagedCommands.forEach((cmds, tableKey) => {
      if (tableKey.startsWith(`${connectionId}:`)) {
        hash += `${tableKey}:${cmds.length}:${cmds.map((c) => c.id).join(",")};`;
      }
    });
    return hash;
  });
  // Read stagedCommands imperatively only when the scoped version changes

  const stagedCommands = useMemo(() => {
    void connectionCommandsVersion;
    return useCrudStore.getState().stagedCommands;
  }, [connectionCommandsVersion]);
  const stageBatchWithSingleHistoryEntry = useCrudStore(
    (s) => s.stageBatchWithSingleHistoryEntry,
  );
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const focusWorkbenchPanel = useWorkbenchStore((s) => s.focusPanel);
  const focusedPanelId = usePanelFocusStore((s) => s.focusedPanelId);
  const focusedActiveTabSnapshot = useWorkbenchStore(
    useShallow(
      useCallback(
        (state) => {
          if (!focusedPanelId) {
            return null;
          }

          const focusedPanel = state.panelContents.get(focusedPanelId);
          const activeTabId = focusedPanel?.activeTabId;
          const metadata = activeTabId
            ? focusedPanel.metadata?.[activeTabId]
            : undefined;

          return {
            activeTabId: activeTabId ?? null,
            type: metadata?.type ?? null,
            connectionId: metadata?.connectionId ?? null,
            database: metadata?.database ?? null,
            schema: metadata?.schema ?? null,
            table: metadata?.table ?? null,
            functionName:
              typeof metadata?.functionName === "string"
                ? metadata.functionName
                : null,
            objectType:
              typeof metadata?.objectType === "string"
                ? metadata.objectType
                : null,
          };
        },
        [focusedPanelId],
      ),
    ),
  );

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

  // Pre-compute starred items for this connection (stable — only changes when store items change)
  const starredItemsRaw = useMemo(
    () =>
      starredStoreItems
        .filter(
          (item) =>
            item.connectionId === connectionId &&
            item.database === database &&
            item.schema === schema,
        )
        .sort((a, b) => b.starredAt - a.starredAt),
    [starredStoreItems, connectionId, database, schema],
  );
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

  const destructivePendingChangesSet = useMemo(() => {
    const set = new Set<string>();
    stagedCommands.forEach((commands, tableKey) => {
      if (commands.length === 0 || !tableKey.startsWith(`${connectionId}:`)) {
        return;
      }

      const hasDestructiveObjectCommand = commands.some(
        (command) =>
          command.type === "table.drop" ||
          command.type === "table.truncate" ||
          command.type === "view.drop",
      );

      if (!hasDestructiveObjectCommand) return;

      const parts = tableKey.split(":");
      if (parts.length >= 4) {
        const [, , schemaName, table] = parts;
        set.add(`${schemaName}.${table}`);
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
        const schemaName = (target.schema || schema || "public").trim();
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

  // Auto-expand the section containing the focused panel's active object.
  useEffect(() => {
    if (
      !focusedActiveTabSnapshot?.activeTabId ||
      focusedActiveTabSnapshot.connectionId !== connectionId
    ) {
      return;
    }

    let sectionKey: string | null = null;
    let starredKey: string | null = null;

    if (focusedActiveTabSnapshot.type === "table") {
      const tableName =
        typeof focusedActiveTabSnapshot.table === "string"
          ? focusedActiveTabSnapshot.table
          : "";
      const schemaName =
        typeof focusedActiveTabSnapshot.schema === "string"
          ? focusedActiveTabSnapshot.schema
          : "";
      const isView =
        !!tableName &&
        !!schemaName &&
        views.some((v) => v.name === tableName && v.schema === schemaName);

      sectionKey = isView ? "views" : "tables";
      if (tableName && schemaName) {
        starredKey = `${isView ? "view" : "table"}:${schemaName}.${tableName}`;
      }
    } else if (focusedActiveTabSnapshot.type === "function") {
      const functionName =
        typeof focusedActiveTabSnapshot.functionName === "string"
          ? focusedActiveTabSnapshot.functionName
          : "";
      const schemaName =
        typeof focusedActiveTabSnapshot.schema === "string"
          ? focusedActiveTabSnapshot.schema
          : "";
      const metadataObjectType =
        typeof focusedActiveTabSnapshot.objectType === "string"
          ? focusedActiveTabSnapshot.objectType
          : "";
      sectionKey =
        metadataObjectType === "sequence"
          ? "sequences"
          : metadataObjectType === "package" ||
              metadataObjectType === "package_body"
            ? "packages"
            : metadataObjectType === "synonym"
              ? "synonyms"
              : "functions";
      if (
        functionName &&
        schemaName &&
        (metadataObjectType === "function" ||
          metadataObjectType === "procedure" ||
          metadataObjectType === "")
      ) {
        starredKey = `function:${schemaName}.${functionName}`;
      }
    } else if (focusedActiveTabSnapshot.type === "mongo-collection") {
      sectionKey = "collections";
    }

    const shouldExpandStarred = !!starredKey && starredSet.has(starredKey);
    if (!sectionKey && !shouldExpandStarred) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        let changed = false;
        if (sectionKey && !next.has(sectionKey)) {
          next.add(sectionKey);
          changed = true;
        }
        if (shouldExpandStarred && !next.has("starred")) {
          next.add("starred");
          changed = true;
        }
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [focusedActiveTabSnapshot, connectionId, views, starredSet]);

  // Auto-expand sections when data is loaded
  useEffect(() => {
    if (
      tables.length > 0 ||
      views.length > 0 ||
      functions.length > 0 ||
      sequences.length > 0 ||
      packages.length > 0 ||
      synonyms.length > 0
    ) {
      queueMicrotask(() => {
        setExpandedNodes((prev) => {
          const toAdd = ["tables", "views", "starred", "sequences", "packages", "synonyms"];
          const missing = toAdd.filter((k) => !prev.has(k));
          if (missing.length === 0) return prev;
          const next = new Set(prev);
          for (const k of missing) next.add(k);
          return next;
        });
      });
    }
  }, [
    tables.length,
    views.length,
    functions.length,
    sequences.length,
    packages.length,
    synonyms.length,
  ]);

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
      ? ["starred", "tables", "views", "functions", "sequences", "packages", "synonyms"]
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
    type?: "table" | "view" | "function",
  ): T[] => {
    return items.filter((item) => {
      if (type && starredSet.has(`${type}:${item.schema}.${item.name}`)) {
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
    return (
      focusedActiveTabSnapshot?.type === "table" &&
      focusedActiveTabSnapshot.table === tableName &&
      focusedActiveTabSnapshot.schema === tableSchema &&
      focusedActiveTabSnapshot.connectionId === connectionId
    );
  };

  const isFunctionActive = (
    functionName: string,
    functionSchema: string,
  ): boolean => {
    return (
      focusedActiveTabSnapshot?.type === "function" &&
      focusedActiveTabSnapshot.schema === functionSchema &&
      focusedActiveTabSnapshot.functionName === functionName &&
      focusedActiveTabSnapshot.connectionId === connectionId
    );
  };

  const isObjectDefinitionActive = (
    objectName: string,
    objectSchema: string,
    objectType: string,
  ): boolean => {
    if (!focusedPanelId) return false;
    const focusedPanel = useWorkbenchStore.getState().panelContents.get(focusedPanelId);
    if (!focusedPanel || !focusedPanel.activeTabId) return false;
    const metadata = focusedPanel.metadata?.[focusedPanel.activeTabId] as
      | {
          type?: string;
          schema?: string;
          functionName?: string;
          objectType?: string;
          connectionId?: string;
        }
      | undefined;

    return (
      metadata?.type === "function" &&
      metadata.schema === objectSchema &&
      metadata.functionName === objectName &&
      metadata.objectType === objectType &&
      metadata.connectionId === connectionId
    );
  };

  const isMongoCollectionActive = (collectionName: string): boolean => {
    if (!database) return false;
    return (
      focusedActiveTabSnapshot?.type === "mongo-collection" &&
      focusedActiveTabSnapshot.connectionId === connectionId &&
      focusedActiveTabSnapshot.database === database &&
      focusedActiveTabSnapshot.table === collectionName
    );
  };

  const openMongoCollection = (collectionName: string) => {
    if (!database) return;

    setFocusedConnection(connectionId);
    const { addTab, panelContents, focusPanel } = useWorkbenchStore.getState();
    let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
    if (!targetPanelId && panelContents.size > 0) {
      const firstPanelId = Array.from(panelContents.keys())[0];
      if (firstPanelId) {
        targetPanelId = firstPanelId;
        focusPanel(firstPanelId);
      }
    }

    if (!targetPanelId) return;

    const objectKey = `mongo-${connectionId}-${database}-${collectionName}`;
    const tabId = `${objectKey}:::${nanoid(6)}`;
    addTab(targetPanelId, tabId, {
      type: "mongo-collection",
      title: collectionName,
      connectionId,
      database,
      table: collectionName,
      objectKey,
    });
    focusPanel(targetPanelId);
  };

  const openMongoCollectionMetadata = (collectionName: string) => {
    if (!database) return;

    setFocusedConnection(connectionId);
    const { addTab, panelContents, focusPanel } = useWorkbenchStore.getState();
    let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
    if (!targetPanelId && panelContents.size > 0) {
      const firstPanelId = Array.from(panelContents.keys())[0];
      if (firstPanelId) {
        targetPanelId = firstPanelId;
        focusPanel(firstPanelId);
      }
    }

    if (!targetPanelId) return;

    const objectKey = `mongo-meta-${connectionId}-${database}-${collectionName}`;
    const tabId = `${objectKey}:::${nanoid(6)}`;
    addTab(targetPanelId, tabId, {
      type: "mongo-query",
      title: `${collectionName} metadata`,
      connectionId,
      database,
      objectKey,
      initialQuery: buildMongoCollectionMetadataQuery(collectionName),
    });
    focusPanel(targetPanelId);
  };

  const openRedisDatabaseTab = (dbIndex: number) => {
    setFocusedConnection(connectionId);
    const { addTab, panelContents, focusPanel } = useWorkbenchStore.getState();
    let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
    if (!targetPanelId && panelContents.size > 0) {
      const firstPanelId = Array.from(panelContents.keys())[0];
      if (firstPanelId) {
        targetPanelId = firstPanelId;
        focusPanel(firstPanelId);
      }
    }

    if (!targetPanelId) return;

    const objectKey = `redis-${connectionId}-db${dbIndex}`;
    const tabId = `${objectKey}:::${nanoid(6)}`;
    addTab(targetPanelId, tabId, {
      type: "redis-key",
      title: `db${dbIndex}`,
      connectionId,
      database: String(dbIndex),
      objectKey,
    });
    focusPanel(targetPanelId);
  };

  const isRedisDatabaseActive = (dbIndex: number): boolean => {
    return (
      focusedActiveTabSnapshot?.type === "redis-key" &&
      focusedActiveTabSnapshot.connectionId === connectionId &&
      focusedActiveTabSnapshot.database === String(dbIndex)
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

  const handleSqlObjectDefinitionClick = useCallback(
    (
      item: SequenceMeta | PackageMeta | SynonymMeta,
      objectType: "sequence" | "package" | "synonym",
    ) => {
      setFocusedConnection(connectionId);
      openSqlObjectDefinition({
        name: item.name,
        schema: item.schema,
        objectType,
        connectionId,
        database,
      });
    },
    [connectionId, database, setFocusedConnection],
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

  const getSelectedTypesBreakdown = (): SidebarSelectedTypes => {
    const breakdown: SidebarSelectedTypes = {
      tables: 0,
      views: 0,
      materializedViews: 0,
      functions: 0,
      collections: 0,
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
      else if (type === "collection") breakdown.collections++;
    });
    return breakdown;
  };

  const getSelectedItems = (): SidebarSelectionItem[] => {
    const items: SidebarSelectionItem[] = [];
    selectedItems.forEach((key) => {
      const colonIndex = key.indexOf(":");
      if (colonIndex === -1) return;
      const type = key.slice(0, colonIndex);
      const rest = key.slice(colonIndex + 1);
      if (type === "collection") {
        items.push({ type: "collection", schema: "", name: rest });
        return;
      }
      const dotIndex = rest.indexOf(".");
      if (dotIndex === -1) return;
      const itemSchema = rest.slice(0, dotIndex);
      const name = rest.slice(dotIndex + 1);
      if (type === "view") {
        const viewItem = views.find(
          (v) => v.schema === itemSchema && v.name === name,
        );
        items.push({
          type: "view",
          schema: itemSchema,
          name,
          kind: viewItem?.kind,
        });
      } else if (type === "function") {
        const functionItem = functions.find(
          (f) => f.schema === itemSchema && f.name === name,
        );
        items.push({
          type: "function",
          schema: itemSchema,
          name,
          routineType: functionItem?.routine_type,
          returnType: functionItem?.return_type,
        });
      } else if (type === "table") {
        items.push({ type: "table", schema: itemSchema, name });
      }
    });
    return items;
  };

  const mapSelectedItemsToExport = (
    items: ReturnType<typeof getSelectedItems>,
  ): SidebarExportItem[] => {
    return items
      .map((item): SidebarExportItem | null => {
        if (item.type === "table") {
          return {
            schema: item.schema,
            name: item.name,
            objectType: "table",
          };
        }

        if (item.type === "view") {
          return {
            schema: item.schema,
            name: item.name,
            objectType:
              item.kind === "MaterializedView" ? "materialized_view" : "view",
          };
        }

        if (item.type === "function") {
          const isRoutineProcedure =
            item.routineType === "PROCEDURE" ||
            (!item.routineType &&
              isMySQLDb &&
              item.returnType?.toLowerCase() === "void");

          return {
            schema: item.schema,
            name: item.name,
            objectType: isRoutineProcedure ? "procedure" : "function",
          };
        }

        return null;
      })
      .filter((item): item is SidebarExportItem => item !== null);
  };

  const mapSelectedItemsToDataExport = (
    items: ReturnType<typeof getSelectedItems>,
  ): SidebarDataExportItem | null => {
    if (items.length !== 1) return null;
    const [item] = items;
    if (!item) return null;

    if (item.type === "table") {
      return {
        schema: item.schema,
        name: item.name,
        objectType: "table",
      };
    }

    if (item.type === "view") {
      return {
        schema: item.schema,
        name: item.name,
        objectType:
          item.kind === "MaterializedView" ? "materialized_view" : "view",
      };
    }

    return null;
  };

  const runMongoCommand = async (
    command: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const result = await invoke<DocumentResult>("document_execute", {
      connId: connectionId,
      operation: {
        type: "runCommand",
        command,
      },
      database,
    });

    if (result.type !== "command") {
      throw new Error("Unexpected MongoDB response");
    }
    return result.data as Record<string, unknown>;
  };

  const runRedisOperation = async (
    operation: KeyValueOperation,
  ): Promise<KeyValueResult> => {
    return invoke<KeyValueResult>("keyvalue_execute", {
      connId: connectionId,
      operation,
    });
  };

  const getCurrentRedisDatabaseIndex = (): number | null => {
    if (
      focusedActiveTabSnapshot?.type === "redis-key" &&
      focusedActiveTabSnapshot.connectionId === connectionId &&
      typeof focusedActiveTabSnapshot.database === "string"
    ) {
      const activeDb = Number.parseInt(focusedActiveTabSnapshot.database, 10);
        if (!Number.isNaN(activeDb)) {
          return activeDb;
        }
    }

    if (!database) return null;
    const parsed = Number.parseInt(database, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const truncateRedisDatabase = async (targetDb: number) => {
    const previousDb = getCurrentRedisDatabaseIndex();
    const shouldSelectTarget = previousDb === null || previousDb !== targetDb;
    const shouldRestore = previousDb !== null && previousDb !== targetDb;

    if (shouldSelectTarget) {
      await runRedisOperation({ type: "selectDb", index: targetDb });
    }

    try {
      await runRedisOperation({
        type: "executeRaw",
        command: "FLUSHDB",
        args: [],
      });
    } finally {
      if (shouldRestore) {
        try {
          await runRedisOperation({ type: "selectDb", index: previousDb });
        } catch {
          // Best effort restore. Keep original FLUSHDB result as primary outcome.
        }
      }
    }

    await refetchRedisDatabases();
    toast.success(`Truncated db${targetDb} (executed immediately)`);
  };

  const loadSqlSnapshotRows = useCallback(
    async (
      sourceConnectionId: string,
      sourceDatabase: string,
      sourceSchema: string,
      sourceName: string,
    ): Promise<{ columns: QueryColumnMeta[]; rows: RawCellValue[][] }> => {
      await databaseService.connectById(sourceConnectionId, sourceDatabase);
      const adapter = (await getAdapterForConnection(
        sourceConnectionId,
      )) as DatabaseAdapter;
      const sql = adapter.select({
        schema: sourceSchema,
        table: sourceName,
      });

      if (typeof sql !== "string") {
        throw new Error("DuckDB snapshot currently requires a SQL source query");
      }

      const rows: RawCellValue[][] = [];
      let columns: QueryColumnMeta[] = [];

      await queryStreamClient.streamWithCallbacks(
        {
          connId: sourceConnectionId,
          tabId: `duckdb-snapshot-${nanoid(8)}`,
          sql,
          batchSize: 1_000,
        },
        {
          onStarted: (startedColumns) => {
            columns = startedColumns;
          },
          onBatch: (batch) => {
            rows.push(...batch.rows);
          },
        },
      );

      return { columns, rows };
    },
    [],
  );

  const loadMongoSnapshotDocuments = useCallback(
    async (
      sourceConnectionId: string,
      sourceDatabase: string,
      collection: string,
    ): Promise<Record<string, unknown>[]> => {
      await databaseService.connectById(sourceConnectionId, sourceDatabase);
      const adapter = new MongoDBAdapter(sourceConnectionId);
      const documents: Record<string, unknown>[] = [];
      let cursor: { lastId: unknown; lastSortValues?: Record<string, unknown> } | null =
        null;

      for (;;) {
        const page = await adapter.findDocumentsPage(
          collection,
          {},
          {
            limit: MONGO_SNAPSHOT_BATCH_SIZE,
            cursor,
          },
          sourceDatabase,
        );

        page.documents.forEach((document) => {
          documents.push(expectSourceSpecRecord(document, "MongoDB document"));
        });

        if (!page.hasMore || !page.nextCursor) {
          break;
        }
        cursor = page.nextCursor;
      }

      return documents;
    },
    [],
  );

  const resolveRedisRestoreDbIndex = useCallback(
    (sourceConnectionId: string): number => {
      const activeSourceConnection = getConnectionById(sourceConnectionId);
      const activeDbIndex = parseRedisDbIndex(activeSourceConnection?.database);
      if (activeDbIndex !== null) {
        return activeDbIndex;
      }

      const storedSourceConnection =
        useConnectionStore.getState().getConnection(sourceConnectionId);
      const storedDbIndex = parseRedisDbIndex(
        storedSourceConnection?.profile.database,
      );
      return storedDbIndex ?? 0;
    },
    [getConnectionById],
  );

  const loadRedisSnapshotEntries = useCallback(
    async (
      sourceConnectionId: string,
      dbIndex: number,
    ): Promise<DuckDbRedisSnapshotEntry[]> => {
      await databaseService.connectById(sourceConnectionId, String(dbIndex));
      const adapter = new RedisAdapter(sourceConnectionId);
      const restoreDbIndex = resolveRedisRestoreDbIndex(sourceConnectionId);
      const entries: DuckDbRedisSnapshotEntry[] = [];

      await adapter.selectDatabase(dbIndex);
      try {
        let cursor = "0";

        do {
          const result = await adapter.scanKeysWithPreviews(
            "*",
            cursor,
            REDIS_SCAN_BATCH_SIZE,
          );

          for (const keyInfo of result.keys) {
            const raw = await fetchRedisSnapshotRawValue(
              adapter,
              keyInfo.key,
              keyInfo.keyType,
            );
            entries.push({
              key: keyInfo.key,
              type: keyInfo.keyType,
              ttl: keyInfo.ttl,
              dbIndex,
              raw,
            });
          }

          cursor = result.cursor;
        } while (cursor !== "0");
      } finally {
        if (restoreDbIndex !== dbIndex) {
          try {
            await adapter.selectDatabase(restoreDbIndex);
          } catch {
            // Best effort restore; keep the primary snapshot outcome intact.
          }
        }
      }

      return entries;
    },
    [resolveRedisRestoreDbIndex],
  );

  const loadSqlSnapshotFromLineage = useCallback(
    async (lineage: DuckDbManagedObjectLineage) => {
      if (!lineage.sourceConnectionId) {
        throw new Error("SQL scratchpad lineage is missing a source connection");
      }
      const sourceSpec = expectSourceSpecRecord(
        lineage.sourceSpec,
        "SQL scratchpad source spec",
      );
      const sourceDatabase = sourceSpec.database;
      const sourceSchema = sourceSpec.schema;
      const sourceName = sourceSpec.name;

      if (typeof sourceDatabase !== "string" || !sourceDatabase) {
        throw new Error("SQL scratchpad source spec is missing database");
      }
      if (typeof sourceSchema !== "string" || !sourceSchema) {
        throw new Error("SQL scratchpad source spec is missing schema");
      }
      if (typeof sourceName !== "string" || !sourceName) {
        throw new Error("SQL scratchpad source spec is missing name");
      }

      return loadSqlSnapshotRows(
        lineage.sourceConnectionId,
        sourceDatabase,
        sourceSchema,
        sourceName,
      );
    },
    [loadSqlSnapshotRows],
  );

  const loadMongoSnapshotFromLineage = useCallback(
    async (lineage: DuckDbManagedObjectLineage) => {
      if (!lineage.sourceConnectionId) {
        throw new Error("MongoDB scratchpad lineage is missing a source connection");
      }
      const sourceSpec = expectSourceSpecRecord(
        lineage.sourceSpec,
        "MongoDB scratchpad source spec",
      );
      const sourceDatabase = sourceSpec.database;
      const collection = sourceSpec.collection;

      if (typeof sourceDatabase !== "string" || !sourceDatabase) {
        throw new Error("MongoDB scratchpad source spec is missing database");
      }
      if (typeof collection !== "string" || !collection) {
        throw new Error("MongoDB scratchpad source spec is missing collection");
      }

      return loadMongoSnapshotDocuments(
        lineage.sourceConnectionId,
        sourceDatabase,
        collection,
      );
    },
    [loadMongoSnapshotDocuments],
  );

  const loadRedisSnapshotFromLineage = useCallback(
    async (lineage: DuckDbManagedObjectLineage) => {
      if (!lineage.sourceConnectionId) {
        throw new Error("Redis scratchpad lineage is missing a source connection");
      }
      const sourceSpec = expectSourceSpecRecord(
        lineage.sourceSpec,
        "Redis scratchpad source spec",
      );
      const dbIndex = parseRedisDbIndex(sourceSpec.dbIndex);
      if (dbIndex === null) {
        throw new Error("Redis scratchpad source spec is missing dbIndex");
      }
      return loadRedisSnapshotEntries(lineage.sourceConnectionId, dbIndex);
    },
    [loadRedisSnapshotEntries],
  );

  const openSnapshotDialogForSource = (source: DuckDbSnapshotSource) => {
    if (duckDbScratchpads.length === 0) {
      toast.error("Create a DuckDB scratchpad first");
      return;
    }

    setSnapshotSource(source);
    setSnapshotDialogOpen(true);
    setContextMenu(null);
    setSelectedItems(new Set());
  };

  const handleImportDuckDbFilePaths = (files: string[]) => {
    if (files.length === 0) return;

    const prepared: DuckDbAddFileDialogItem[] = [];
    const errors: string[] = [];

    for (const filePath of files) {
      try {
        const format = detectDuckDbImportFormat(filePath);
        if (!format) {
          throw new Error("Unsupported file type");
        }

        prepared.push({
          filePath,
          targetName: defaultDuckDbTargetNameFromFile(filePath),
          format,
        });
      } catch (error) {
        errors.push(
          `${defaultDuckDbTargetNameFromFile(filePath)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (prepared.length > 0) {
      setDuckDbImportFiles(prepared);
      setDuckDbAddFileDialogOpen(true);
      if (errors.length > 0) {
        toast.error(`${errors.length} file(s) could not be prepared`, {
          description: errors.join("\n"),
        });
      }
      return;
    }

    toast.error("Failed to prepare file import", {
      description: errors.join("\n"),
    });
  };

  const handleOpenDuckDbAddFileDialog = async () => {
    const selected = await open({
      multiple: true,
      title: "Add file(s) to DuckDB scratchpad",
      filters: [
        {
          name: "Supported data files",
          extensions: ["csv", "tsv", "parquet", "json", "jsonl", "ndjson", "xlsx"],
        },
      ],
    });

    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];
    handleImportDuckDbFilePaths(files);
  };

  const handleAddDuckDbFile = async (filesToImport: DuckDbAddFileDialogItem[]) => {
    if (filesToImport.length === 0) {
      return;
    }

    setIsAddingDuckDbFile(true);
    const toastId = toast.loading(
      filesToImport.length === 1 ? "Importing file..." : "Importing files...",
    );
    let successCount = 0;
    const errors: string[] = [];
    try {
      for (const [index, file] of filesToImport.entries()) {
        const normalizedTargetName = sanitizeDuckDbObjectName(
          file.targetName,
          defaultDuckDbTargetNameFromFile(file.filePath),
        );
        toast.loading(
          filesToImport.length === 1
            ? `Importing ${normalizedTargetName}...`
            : `Importing ${index + 1} of ${filesToImport.length}: ${normalizedTargetName}...`,
          { id: toastId },
        );
        try {
          await DuckDbScratchpadService.importFile(connectionId, {
            filePath: file.filePath,
            targetSchema: schema || DEFAULT_DUCKDB_SCHEMA,
            targetName: normalizedTargetName,
            sourceId: nanoid(),
            sheetName:
              file.format === "xlsx" ? (file.selectedSheet ?? null) : null,
          });
          successCount++;
        } catch (error) {
          errors.push(
            `${normalizedTargetName}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      if (successCount > 0) {
        refreshConnectionData(connection);
      }
      if (successCount === filesToImport.length) {
        toast.success(
          filesToImport.length === 1
            ? "File imported into DuckDB scratchpad"
            : `Imported ${successCount} files into DuckDB scratchpad`,
          { id: toastId },
        );
        setDuckDbAddFileDialogOpen(false);
        setDuckDbImportFiles([]);
      } else if (successCount > 0) {
        toast.error(`${errors.length} file(s) failed to import`, {
          id: toastId,
          description: errors.join("\n"),
        });
      } else {
        toast.error("Failed to import file", {
          id: toastId,
          description: errors.join("\n"),
        });
      }
    } catch (error) {
      toast.error("Failed to import file", {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsAddingDuckDbFile(false);
    }
  };

  const handleImportDuckDbUrl = async (url: string, targetName: string) => {
    const toastId = toast.loading("Importing from URL...");
    try {
      setIsAddingDuckDbFile(true);
      await DuckDbScratchpadService.importFile(connectionId, {
        filePath: url,
        targetSchema: schema || DEFAULT_DUCKDB_SCHEMA,
        targetName: sanitizeDuckDbObjectName(targetName),
        sheetName: null,
      });
      toast.success(`Imported "${targetName}" from URL`, { id: toastId });
      refreshConnectionData(connection);
      setDuckDbImportUrlDialogOpen(false);
    } catch (error) {
      toast.error(`Import failed`, {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsAddingDuckDbFile(false);
    }
  };

  const {
    dropZoneRef: duckDbDropZoneRef,
    isDragOver: isDuckDbDragOver,
  } = useDuckDbSidebarDrop({
    enabled: dbType === DbType.DuckDB,
    onFilesDropped: (files: DroppedFile[]) => {
      const missingPath = files.filter((f) => !f.path).length;
      const withPath = files
        .map((f) => f.path)
        .filter((path): path is string => Boolean(path));
      if (missingPath > 0 && withPath.length === 0) {
        toast.error("Could not read file path", {
          description:
            "Drop files from Finder / Explorer in the desktop app.",
        });
        return;
      }
      handleImportDuckDbFilePaths(withPath);
    },
    onUrlDropped: (url) => {
      setDuckDbImportUrlInitial(url);
      setDuckDbImportUrlDialogOpen(true);
    },
  });
  const connectionRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      duckDbDropZoneRef(node);
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as { current: HTMLDivElement | null }).current = node;
      }
    },
    [duckDbDropZoneRef, ref],
  );

  const handleAttachDatabase = useCallback(async (
    path: string,
    alias: string,
    attachDbType: string | undefined,
    readOnly: boolean,
  ) => {
    const toastId = toast.loading("Attaching database...");
    try {
      const attachment = await addDatabaseAttachment({
        connectionId,
        path,
        alias,
        dbType: attachDbType,
        readOnly,
      });
      useRuntimeDatabasesStore.getState().appendDatabase(connectionId, {
        name: attachment.alias,
        visible_schemas: [],
      });
      await useConnectionStore.getState().fetchConnections();
      toast.success(`Database attached as "${alias}"`, { id: toastId });
      refreshConnectionData(connection);
      void queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[1] === connectionId &&
          (q.queryKey[0] === "attached-databases" ||
            q.queryKey[0] === "schemas" ||
            q.queryKey[0] === "databases" ||
            q.queryKey[0] === "tables" ||
            q.queryKey[0] === "useSchemaData.SchemaData" ||
            q.queryKey[0] === "attached-db-schemas" ||
            q.queryKey[0] === "attached-db-objects"),
      });
      setDuckDbAttachDialogOpen(false);
    } catch (error) {
      toast.error("Failed to attach database", {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [connectionId, connection, queryClient]);

  const handleAttachCatalog = useCallback(async (
    options: DuckDbAttachCatalogSubmitOptions,
  ) => {
    const { request, saveToConnection } = options;
    const toastId = toast.loading("Attaching catalog...");
    try {
      if (saveToConnection) {
        // Phase 3: persist the attachment to the profile via duckdb_run_attach
        const attachment: Attachment = {
          alias: request.alias,
          kind: request.catalogType as AttachmentKind,
          uri: request.catalogUri,
          options: request.extraOptions ?? {},
          ...(request.readOnly ? { read_only: true } : {}),
        };
        await invoke("duckdb_run_attach", {
          connId: connectionId,
          attachment,
          secret: null,
        });
        // Also persist to profile
        const stored = await vaultStorage.getConnection(connectionId);
        if (stored) {
          const databases = stored.profile.databases;
          const db0 = databases[0];
          if (db0) {
            const existing = db0.attachments ?? [];
            if (!existing.some((a) => a.alias === attachment.alias)) {
              await vaultStorage.updateConnection(connectionId, {
                ...stored.profile,
                databases: [
                  { ...db0, attachments: [...existing, attachment] },
                  ...databases.slice(1),
                ],
              });
            }
          }
        }
        useRuntimeDatabasesStore.getState().appendDatabase(connectionId, {
          name: request.alias,
          visible_schemas: defaultVisibleSchemasFor(attachment.kind),
        });
      } else {
        // Session-only: use the existing BackendAPI path
        await BackendAPI.duckdbAttachCatalog(connectionId, request);
      }
      toast.success(`Catalog attached as "${request.alias}"`, { id: toastId });
      refreshConnectionData(connection);
      void queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[1] === connectionId &&
          (q.queryKey[0] === "attached-databases" ||
            q.queryKey[0] === "schemas" ||
            q.queryKey[0] === "databases" ||
            q.queryKey[0] === "tables" ||
            q.queryKey[0] === "useSchemaData.SchemaData"),
      });
      setDuckDbAttachCatalogDialogOpen(false);
    } catch (error) {
      toast.error("Failed to attach catalog", {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [connectionId, connection, queryClient]);

  const handleDetachDatabase = useCallback(async (alias: string) => {
    const toastId = toast.loading(`Detaching "${alias}"...`);
    try {
      await removeAttachment(connectionId, alias);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // If the database wasn't actually attached in DuckDB, treat it as success
      // — we still want to clean up the connection profile below.
      if (!msg.includes("database not found")) {
        toast.error("Failed to detach database", {
          id: toastId,
          description: msg,
        });
        return;
      }
    }
    useRuntimeDatabasesStore.getState().removeDatabase(connectionId, alias);
    await useConnectionStore.getState().fetchConnections();

    // Remove attached-db schemas (e.g. "pg.public") from visible_schemas
    const currentSchemas = useConnectionStore.getState().getVisibleSchemas(connectionId, database);
    const cleanedSchemas = currentSchemas.filter((s) => !s.startsWith(`${alias}.`));
    if (cleanedSchemas.length !== currentSchemas.length) {
      await useConnectionStore.getState().setVisibleSchemas(connectionId, database, cleanedSchemas);
    }

    toast.success(`Database "${alias}" detached`, { id: toastId });
    refreshConnectionData(connection);
    void queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[1] === connectionId &&
        (q.queryKey[0] === "attached-databases" ||
          q.queryKey[0] === "schemas" ||
          q.queryKey[0] === "databases" ||
          q.queryKey[0] === "tables" ||
          q.queryKey[0] === "useSchemaData.SchemaData" ||
          q.queryKey[0] === "attached-db-schemas" ||
          q.queryKey[0] === "attached-db-objects"),
    });
  }, [connectionId, database, connection, queryClient]);

  const handleRevealDuckDbFile = async () => {
    if (!duckDbFilePath) {
      toast.error("Scratchpad file path is unavailable");
      return;
    }

    try {
      await revealItemInDir(duckDbFilePath);
    } catch (error) {
      toast.error("Failed to reveal DuckDB scratchpad file", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleCreateDuckDbSnapshot = async (
    targetConnectionId: string,
    targetName: string,
  ) => {
    if (!snapshotSource) {
      return;
    }

    const normalizedTargetName = sanitizeDuckDbObjectName(
      targetName,
      defaultDuckDbTargetNameFromSnapshotSource(snapshotSource),
    );

    setIsCreatingDuckDbSnapshot(true);
    try {
      await databaseService.connectById(targetConnectionId);
      const sourceId = nanoid();

      if (snapshotSource.kind === "sql") {
        const snapshot = await loadSqlSnapshotRows(
          snapshotSource.sourceConnectionId,
          snapshotSource.sourceDatabase,
          snapshotSource.schema,
          snapshotSource.name,
        );
        await DuckDbScratchpadService.replaceManagedObject(
          targetConnectionId,
          DuckDbScratchpadService.buildSqlSnapshotRequest({
            targetSchema: DEFAULT_DUCKDB_SCHEMA,
            targetName: normalizedTargetName,
            sourceId,
            sourceKind:
              snapshotSource.objectType === "materialized_view"
                ? "sql_materialized_view"
                : snapshotSource.objectType === "view"
                  ? "sql_view"
                  : "sql_table",
            sourceConnectionId: snapshotSource.sourceConnectionId,
            sourceSpec: {
              database: snapshotSource.sourceDatabase,
              schema: snapshotSource.schema,
              name: snapshotSource.name,
              objectType: snapshotSource.objectType,
            },
            columns: snapshot.columns,
            rows: snapshot.rows,
          }),
        );
      } else if (snapshotSource.kind === "mongo") {
        const documents = await loadMongoSnapshotDocuments(
          snapshotSource.sourceConnectionId,
          snapshotSource.sourceDatabase,
          snapshotSource.collection,
        );
        await DuckDbScratchpadService.replaceManagedObject(
          targetConnectionId,
          DuckDbScratchpadService.buildMongoSnapshotRequest({
            targetSchema: DEFAULT_DUCKDB_SCHEMA,
            targetName: normalizedTargetName,
            sourceId,
            sourceConnectionId: snapshotSource.sourceConnectionId,
            sourceSpec: {
              database: snapshotSource.sourceDatabase,
              collection: snapshotSource.collection,
            },
            collection: snapshotSource.collection,
            documents,
          }),
        );
      } else {
        const entries = await loadRedisSnapshotEntries(
          snapshotSource.sourceConnectionId,
          snapshotSource.dbIndex,
        );
        await DuckDbScratchpadService.replaceManagedObject(
          targetConnectionId,
          DuckDbScratchpadService.buildRedisSnapshotRequest({
            targetSchema: DEFAULT_DUCKDB_SCHEMA,
            targetName: normalizedTargetName,
            sourceId,
            sourceConnectionId: snapshotSource.sourceConnectionId,
            sourceSpec: {
              dbIndex: snapshotSource.dbIndex,
              pattern: "*",
            },
            entries,
          }),
        );
      }

      const targetConnection = getConnectionById(targetConnectionId);
      if (targetConnection) {
        refreshConnectionData(targetConnection);
      }

      toast.success("Snapshot created in DuckDB scratchpad", {
        description: describeDuckDbSnapshotSource(snapshotSource),
      });
      setSnapshotDialogOpen(false);
      setSnapshotSource(null);
    } catch (error) {
      toast.error("Failed to create DuckDB snapshot", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsCreatingDuckDbSnapshot(false);
    }
  };

  const handleRefreshDuckDbSnapshots = async () => {
    setIsRefreshingDuckDbSnapshots(true);
    try {
      const managedObjects =
        await DuckDbScratchpadService.listManagedObjects(connectionId);

      if (managedObjects.length === 0) {
        toast.success("No DuckDB scratchpad snapshots to refresh");
        return;
      }

      let refreshedCount = 0;
      let failedCount = 0;
      const failures: string[] = [];

      for (const managedObject of managedObjects) {
        const lineage = await DuckDbScratchpadService.getObjectLineage(
          connectionId,
          managedObject.targetSchema,
          managedObject.targetName,
        );

        if (!lineage) {
          failedCount += 1;
          failures.push(
            `${managedObject.targetName}: missing lineage metadata`,
          );
          continue;
        }

        try {
          await DuckDbScratchpadService.refreshManagedObject(connectionId, lineage, {
            loadSqlSnapshot: loadSqlSnapshotFromLineage,
            loadMongoSnapshot: loadMongoSnapshotFromLineage,
            loadRedisSnapshot: loadRedisSnapshotFromLineage,
          });
          refreshedCount += 1;
        } catch (error) {
          failedCount += 1;
          failures.push(
            `${managedObject.targetName}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      refreshConnectionData(connection);

      if (failedCount === 0) {
        toast.success(`Refreshed ${refreshedCount} DuckDB snapshot(s)`);
      } else {
        toast.error(
          `Refreshed ${refreshedCount} snapshot(s), ${failedCount} failed`,
          {
            description: failures[0],
          },
        );
      }
    } catch (error) {
      toast.error("Failed to refresh DuckDB snapshots", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRefreshingDuckDbSnapshots(false);
    }
  };

  const stageSqlCommandsAndOpenGlobalChanges = useCallback(
    (
      commands: ReturnType<typeof stageBatchWithSingleHistoryEntry>,
      actionLabel: string,
      openGlobalChanges = true,
    ) => {
      if (commands.length === 0) {
        toast.error(`No ${actionLabel} operations to stage`);
        return;
      }
      if (openGlobalChanges) {
        setGlobalChangesDialogOpen(true);
      }
      toast.success(
        `${commands.length} ${actionLabel} command${commands.length === 1 ? "" : "s"} staged${
          openGlobalChanges ? "" : " in Global Changes"
        }`,
      );
    },
    [],
  );

  const requestConfirmation = useCallback((action: PendingConfirmAction) => {
    setPendingConfirmAction(action);
  }, []);

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
    const items = getSelectedItems();
    if (items.length === 0) {
      toast.error("No objects selected");
      return;
    }

    const sqlItems = mapSelectedItemsToExport(items);
    const collectionItems = items.filter(
      (item): item is SidebarSelectionItem & { type: "collection" } =>
        item.type === "collection",
    );

    const output: string[] = [];

    try {
      for (const item of sqlItems) {
        const definition = await databaseService.getObjectDefinition(
          connectionId,
          database,
          item.schema,
          item.name,
          item.objectType,
        );
        output.push(
          `-- ${item.objectType.toUpperCase()} ${item.schema}.${item.name}\n${definition.trimEnd()}`,
        );
      }

      for (const item of collectionItems) {
        const metadata = await runMongoCommand(
          buildMongoCollectionMetadataCommand(item.name),
        );
        output.push(buildMongoCollectionDefinition(item.name, metadata));
      }

      if (output.length === 0) {
        toast.error("No definitions available for selected objects");
        return;
      }

      await writeClipboardText(output.join("\n\n"));
      toast.success(`Copied ${output.length} definition(s)`);
    } catch (error) {
      toast.error("Failed to copy definition", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const stageSqlTruncate = (
    items: SidebarSelectionItem[],
    options: {
      restartIdentity: boolean;
      cascade: boolean;
    },
  ) => {
    const commands = stageBatchWithSingleHistoryEntry(
      items
        .filter(
          (item): item is SidebarSelectionItem & { type: "table" } =>
            item.type === "table",
        )
        .map((item) =>
          CrudCommandFactory.createTableTruncateCommand({
            target: {
              connectionId,
              database,
              schema: item.schema,
              table: item.name,
            },
            tableName: item.name,
            restartIdentity: options.restartIdentity,
            cascade: options.cascade,
          }),
        ),
    );

    stageSqlCommandsAndOpenGlobalChanges(commands, "truncate", false);
  };

  const stageSqlDelete = (items: SidebarSelectionItem[]) => {
    const commands = stageBatchWithSingleHistoryEntry(
      items
        .map((item) => {
          if (item.type === "table") {
            return CrudCommandFactory.createTableDropCommand({
              target: {
                connectionId,
                database,
                schema: item.schema,
                table: item.name,
              },
              tableName: item.name,
              ifExists: true,
            });
          }

          if (item.type === "view") {
            return CrudCommandFactory.createViewDropCommand({
              target: {
                connectionId,
                database,
                schema: item.schema,
                table: item.name,
              },
              viewName: item.name,
              ifExists: true,
              isMaterialized: item.kind === "MaterializedView",
            });
          }

          return null;
        })
        .filter(
          (command): command is NonNullable<typeof command> => command !== null,
        ),
    );

    stageSqlCommandsAndOpenGlobalChanges(commands, "delete");
  };

  const truncateMongoCollections = async (items: SidebarSelectionItem[]) => {
    const collectionItems = items.filter(
      (item): item is SidebarSelectionItem & { type: "collection" } =>
        item.type === "collection",
    );

    for (const item of collectionItems) {
      await runMongoCommand({
        delete: item.name,
        deletes: [{ q: {}, limit: 0 }],
      });
    }

    await collectionsRefetch();
    toast.success(
      `Truncated ${collectionItems.length} collection${collectionItems.length === 1 ? "" : "s"} (executed immediately)`,
    );
  };

  const deleteMongoCollections = async (items: SidebarSelectionItem[]) => {
    const collectionItems = items.filter(
      (item): item is SidebarSelectionItem & { type: "collection" } =>
        item.type === "collection",
    );

    for (const item of collectionItems) {
      await runMongoCommand({ drop: item.name });
    }

    await collectionsRefetch();
    toast.success(
      `Deleted ${collectionItems.length} collection${collectionItems.length === 1 ? "" : "s"} (executed immediately)`,
    );
  };

  const handleTruncate = () => {
    const items = getSelectedItems();
    const selectedTypes = getSelectedTypesBreakdown();
    if (!canTruncate(selectedTypes)) return;
    const truncateOptionSupport = getSqlTruncateOptionSupport(dbType);
    const showSqlTruncateOptions =
      !isImmediateExecution(selectedTypes) &&
      (truncateOptionSupport.restartIdentity || truncateOptionSupport.cascade);

    setSqlTruncateOptions({
      restartIdentity: false,
      cascade: false,
    });

    const entityName =
      items.length === 1
        ? items[0]?.name
        : `${items.length} selected object${items.length === 1 ? "" : "s"}`;

    requestConfirmation({
      title: "Truncate Objects",
      description: isImmediateExecution(selectedTypes)
        ? "This will remove all documents in the selected collection(s) immediately. It will not be staged in Global Changes."
        : "This will stage TRUNCATE commands in Global Changes. Data will be permanently removed when committed.",
      entityName,
      kind: isImmediateExecution(selectedTypes)
        ? "nosql-truncate"
        : "sql-truncate",
      confirmLabel: isImmediateExecution(selectedTypes)
        ? items.length === 1
          ? "Truncate Collection"
          : "Truncate Collections"
        : "Stage Truncate",
      onConfirm: async () => {
        if (isImmediateExecution(selectedTypes)) {
          await truncateMongoCollections(items);
          return;
        }
        stageSqlTruncate(
          items,
          showSqlTruncateOptions
            ? sqlTruncateOptions
            : { restartIdentity: false, cascade: false },
        );
      },
    });
  };

  const handleDelete = () => {
    const items = getSelectedItems();
    const selectedTypes = getSelectedTypesBreakdown();
    if (!canDelete(selectedTypes)) return;

    const entityName =
      items.length === 1
        ? items[0]?.name
        : `${items.length} selected object${items.length === 1 ? "" : "s"}`;

    requestConfirmation({
      title: "Delete Objects",
      description: isImmediateExecution(selectedTypes)
        ? "This will drop the selected collection(s) immediately. It will not be staged in Global Changes."
        : "This will stage DROP commands in Global Changes. Objects will be removed when committed.",
      entityName,
      kind: isImmediateExecution(selectedTypes) ? "nosql-delete" : "sql-delete",
      confirmLabel: isImmediateExecution(selectedTypes)
        ? items.length === 1
          ? "Delete Collection"
          : "Delete Collections"
        : "Stage Delete",
      onConfirm: async () => {
        if (isImmediateExecution(selectedTypes)) {
          await deleteMongoCollections(items);
          return;
        }
        stageSqlDelete(items);
      },
    });
  };

  const handleExportDefinition = async () => {
    const items = getSelectedItems();
    const exportItems = mapSelectedItemsToExport(items);

    if (exportItems.length === 0) {
      toast.error("No exportable objects selected");
      return;
    }

    try {
      const result = await exportSidebarObjectsToFile({
        connectionId,
        database,
        items: exportItems,
      });

      if (result.cancelled) return;

      toast.success("Export completed", {
        description: `${result.itemCount} object(s) exported`,
      });
    } catch (error) {
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleExportDefinitionDBML = async () => {
    const items = getSelectedItems();
    const exportItems = mapSelectedItemsToExport(items);

    if (exportItems.length === 0) {
      toast.error("No exportable objects selected");
      return;
    }

    try {
      const result = await exportSidebarObjectsAsDBML({
        connectionId,
        database,
        items: exportItems,
      });
      if (result.cancelled) return;
      toast.success("DBML export completed", {
        description: `${result.itemCount} object(s) exported`,
      });
    } catch (error) {
      toast.error("DBML export failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleExportDefinitionMermaid = async () => {
    const items = getSelectedItems();
    const exportItems = mapSelectedItemsToExport(items);

    if (exportItems.length === 0) {
      toast.error("No exportable objects selected");
      return;
    }

    try {
      const result = await exportSidebarObjectsAsMermaid({
        connectionId,
        database,
        items: exportItems,
      });
      if (result.cancelled) return;
      toast.success("Mermaid ERD export completed", {
        description: `${result.itemCount} object(s) exported`,
      });
    } catch (error) {
      toast.error("Mermaid ERD export failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleExportData = async (format: SidebarDataExportFormat) => {
    const items = getSelectedItems();
    const exportItem = mapSelectedItemsToDataExport(items);

    if (!exportItem) {
      toast.error("Data export requires exactly one table or view");
      return;
    }

    try {
      const result = await exportSidebarObjectDataToFile({
        connectionId,
        database,
        dbType,
        item: exportItem,
        format,
      });

      if (result.cancelled) return;

      const formatLabel = {
        csv: "CSV",
        json: "JSON",
        insert: "SQL INSERT",
        markdown: "Markdown",
      }[format];

      toast.success(`Data exported as ${formatLabel}`, {
        description: `${result.rowCount.toLocaleString()} row(s) exported`,
      });
    } catch (error) {
      toast.error("Data export failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handlePin = () => {
    const items = getSelectedItems();
    const pinnableItems = items.filter(
      (item): item is typeof item & { type: StarredItemType } =>
        item.type === "table" ||
        item.type === "view" ||
        item.type === "function",
    );

    pinnableItems.forEach((item) => {
      toggleStarred({
        connectionId,
        database,
        schema: item.schema,
        type: item.type,
        name: item.name,
      });
    });

    if (pinnableItems.length === 0) {
      toast.error("Selected item cannot be pinned");
    }
    setSelectedItems(new Set());
  };

  const handleRefreshMaterializedView = async () => {
    const items = getSelectedItems();
    const matViews = items.filter(
      (item) => item.type === "view" && item.kind === "MaterializedView",
    );
    if (matViews.length === 0) return;

    try {
      const adapter = (await getAdapterForConnection(
        connectionId,
      )) as DatabaseAdapter;

      for (const item of matViews) {
        const sql = adapter.refreshMaterializedView(
          item.schema,
          item.name,
        ) as string;
        await queryStreamClient.streamWithCallbacks(
          { connId: connectionId, tabId: "system", sql, batchSize: 1 },
          {},
        );
        useDataInvalidationStore
          .getState()
          .invalidateTable(connectionId, database, item.schema, item.name);
      }

      const label =
        matViews.length === 1
          ? (matViews[0]?.name ?? "materialized view")
          : `${matViews.length} materialized views`;
      toast.success(`Refreshed ${label}`);
    } catch (error) {
      toast.error("Failed to refresh materialized view", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
    setSelectedItems(new Set());
  };

  const handleSnapshotSelectedObjectToDuckDb = () => {
    const [item] = getSelectedItems();
    if (!item) {
      return;
    }

    if (item.type === "collection") {
      if (!database) {
        toast.error("MongoDB snapshot requires an active database");
        return;
      }

      openSnapshotDialogForSource({
        kind: "mongo",
        sourceConnectionId: connectionId,
        sourceConnectionName: profile.name,
        sourceDatabase: database,
        collection: item.name,
      });
      return;
    }

    if (item.type === "table" || item.type === "view") {
      openSnapshotDialogForSource({
        kind: "sql",
        sourceConnectionId: connectionId,
        sourceConnectionName: profile.name,
        sourceDatabase: database,
        schema: item.schema,
        name: item.name,
        objectType:
          item.type === "table"
            ? "table"
            : item.kind === "MaterializedView"
              ? "materialized_view"
              : "view",
      });
    }
  };

  const handleSnapshotRedisDatabaseToDuckDb = (dbIndex: number) => {
    openSnapshotDialogForSource({
      kind: "redis",
      sourceConnectionId: connectionId,
      sourceConnectionName: profile.name,
      dbIndex,
    });
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
      } else if (item.type === "collection") {
        openMongoCollection(item.name);
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
      } else if (item.type === "collection") {
        openMongoCollectionMetadata(item.name);
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
          : "bg-muted-foreground/40";

  // Show loading state when connecting and no data yet
  const showLoadingSkeleton =
    status === "connecting" &&
    (isSqlDb
      ? tables.length === 0
      : isDocumentDb
        ? mongoCollections.length === 0
        : isTrinoDb
          ? isLoadingCatalogs && resolvedAllCatalogs.length === 0
          : true);

  return (
    <div
      ref={connectionRootRef}
      className={cn(
        "relative",
        dbType === DbType.DuckDB &&
          isDuckDbDragOver &&
          "ring-2 ring-primary ring-inset rounded",
      )}
    >
      {dbType === DbType.DuckDB && isDuckDbDragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-popover/95 px-3 py-2 text-xs font-medium text-primary shadow-md">
            <IconFileImport className="h-4 w-4" />
            Drop file or URL to import into DuckDB
          </div>
        </div>
      )}
      {/* Connection Header */}
      <ContextMenu>
        <ContextMenuTrigger
          className={cn(
            "w-full flex items-center gap-2 p-2 hover:bg-muted/80 backdrop-blur-md transition-colors text-left cursor-pointer",
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

          {/* Catalog filter (Trino only, when multiple catalogs available) */}
          {isTrinoDb && allTrinoCatalogs.length > 1 && (
            <div onClick={(e) => { e.stopPropagation(); }} className="shrink-0 -mt-1">
              <CatalogSchemaFilter
                connectionId={connectionId}
                catalogs={allTrinoCatalogs}
              />
            </div>
          )}

          {/* Schema dropdown inline (SQL databases only, not Trino) - stop propagation to prevent toggle */}
          {isSqlDb && !isTrinoDb && (
            <div
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="shrink-0 -mt-1"
            >
              <SchemaDropdown
                connectionId={connectionId}
                databaseName={database}
                open={schemaDropdownOpen}
                onOpenChange={setSchemaDropdownOpen}
              />
            </div>
          )}

          {/* Redis database filter dropdown (non-cluster key-value only) */}
          {isKeyValueDb && !isClusterMode && (
            <div
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="shrink-0 -mt-1"
            >
              <RedisDbFilterDropdown
                databases={allRedisDatabases}
                visibleDbs={visibleDbSet}
                onVisibleDbsChange={handleVisibleDbsChange}
                totalDbs={redisMaxDbs}
                isLoading={isLoadingKeys}
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
                  setTimeout(() => {
                    setNestedMode({ type: "set-safe-mode" });
                  }, 0);
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
            className={cn(
              "h-2 w-2 rounded-full shrink-0 transition-colors duration-300",
              statusColor,
            )}
            title={status}
          />
          {(profile.tunnel_profile_id || profile.tunnel_inline) && (
            <span className="text-[10px] text-muted-foreground ml-1.5 shrink-0">
              via{" "}
              {profile.tunnel_inline &&
              "SsmBastion" in profile.tunnel_inline.tunnel_type
                ? "SSM"
                : profile.tunnel_profile_id
                  ? "Tunnel"
                  : "SSH"}
            </span>
          )}
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
          <ContextMenuItem disabled>
            <IconExternalLink className="h-4 w-4 mr-2" />
            Open in New Window (coming soon)
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              const uri = buildConnectionUri(profile, true);
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
          {dbType === DbType.DuckDB && (
            <>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <IconPlus className="h-4 w-4 mr-2" />
                  Add Data
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem
                    onClick={() => {
                      void handleOpenDuckDbAddFileDialog();
                    }}
                    disabled={isAddingDuckDbFile}
                  >
                    <IconFileImport className="h-4 w-4 mr-2" />
                    Import from File...
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      setDuckDbImportUrlDialogOpen(true);
                    }}
                  >
                    <IconLink className="h-4 w-4 mr-2" />
                    Import from URL...
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuItem
                onClick={() => {
                  requestConfirmation({
                    title: "Refresh DuckDB Snapshots",
                    description:
                      "This will replace each managed DuckDB table with freshly imported data from its source.",
                    entityName: profile.name,
                    confirmLabel: "Refresh Snapshots",
                    onConfirm: handleRefreshDuckDbSnapshots,
                  });
                }}
                disabled={isRefreshingDuckDbSnapshots}
              >
                <IconRefresh className="h-4 w-4 mr-2" />
                Refresh Snapshots
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  void handleRevealDuckDbFile();
                }}
                disabled={!duckDbFilePath}
              >
                <IconFolderOpen className="h-4 w-4 mr-2" />
                Reveal File
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => {
                  setDuckDbExportSource({ type: "query", sql: "" });
                  setDuckDbExportDialogOpen(true);
                }}
              >
                <IconFileExport className="h-4 w-4 mr-2" />
                Export...
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => { setDuckDbAttachDialogOpen(true); }}
              >
                <IconPlugConnected className="h-4 w-4 mr-2" />
                Attach Database...
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => { setDuckDbAttachCatalogDialogOpen(true); }}
              >
                <IconBuildingWarehouse className="h-4 w-4 mr-2" />
                Attach Catalog...
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => { setDuckDbSecretsPanelOpen(true); }}
              >
                <IconKey className="h-4 w-4 mr-2" />
                Secrets...
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => { setDuckDbExtensionsPanelOpen(true); }}
              >
                <IconPuzzle className="h-4 w-4 mr-2" />
                Extensions...
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => { setDuckDbGlobHelperDialogOpen(true); }}
              >
                <IconFileCode className="h-4 w-4 mr-2" />
                File Pattern Helper...
              </ContextMenuItem>
              {(() => {
                const primaryDbName = connection.database
                  .split(/[/\\]/)
                  .pop()
                  ?.replace(/\.duckdb$/i, "");
                const detachable = attachedDatabases.filter(
                  (db) => db.databaseName !== "memory" && db.databaseName !== "system" && db.databaseName !== primaryDbName,
                );
                const detachableNames = new Set(detachable.map(db => db.databaseName));
                const extraDetachable = duckDbAttachedFromSchemas.filter(
                  name => !detachableNames.has(name) && name !== primaryDbName,
                );
                return (detachable.length > 0 || extraDetachable.length > 0) ? (
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <IconPlugConnectedX className="h-4 w-4 mr-2" />
                      Detach Database
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {detachable.map((db) => (
                        <ContextMenuItem
                          key={db.databaseName}
                          onClick={() => { void handleDetachDatabase(db.databaseName); }}
                        >
                          <span className="truncate">{db.databaseName}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {db.dbType || "duckdb"}
                            {db.readOnly ? " (ro)" : ""}
                          </span>
                        </ContextMenuItem>
                      ))}
                      {extraDetachable.map((name) => (
                        <ContextMenuItem
                          key={name}
                          onClick={() => { void handleDetachDatabase(name); }}
                        >
                          <span className="truncate">{name}</span>
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                ) : null;
              })()}
            </>
          )}
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
        <div className="px-3 py-2 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
          <IconAlertCircle className="h-4 w-4 shrink-0" />
          <span className="truncate">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-2 text-xs ml-auto"
            onClick={() => void reconnectDisconnectedConnections()}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Content - always visible */}
      {status !== "error" && (
        <div className="">
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

          {/* Object tree - Trino: catalog → schema → table hierarchy */}
          {isTrinoDb && !showLoadingSkeleton && !schemaError && (
            <div className="px-1 py-1">
              {visibleTrinoCatalogs.length === 0 && !isLoadingCatalogs && (
                <p className="text-xs text-muted-foreground px-2 py-1 italic">
                  No catalogs configured. Edit the connection to add catalogs.
                </p>
              )}
              {visibleTrinoCatalogs.map((catalog) => (
                <CatalogSection
                  key={catalog}
                  connectionId={connectionId}
                  catalog={catalog}
                  visibleSchemas={trinoCatalogFilter?.schemaFilters[catalog]}
                  onTableClick={(table, cat) => {
                    setFocusedConnection(connectionId);
                    openTableObject({
                      table,
                      connectionId,
                      database: cat,
                      viewType: "data",
                    });
                  }}
                />
              ))}
            </div>
          )}

          {/* Object tree - SQL databases (non-Trino) */}
          {isSqlDb && !isTrinoDb && !showLoadingSkeleton && !schemaError && (
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
                    const objectKey = `${item.schema}.${item.name}`;
                    const selectionKey = `${item.type}:${objectKey}`;
                    const itemData =
                      item.type === "function"
                        ? functionsByKey.get(objectKey)
                        : item.type === "view"
                          ? viewsByKey.get(objectKey)
                          : tablesByKey.get(objectKey);

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
                              ? "text-sky-500/80"
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

                    const starredDragData: SidebarItemDragData =
                      item.type === "function"
                        ? {
                            type: "sidebar-item",
                            objectType: isProcedure(itemData as FunctionMeta)
                              ? "procedure"
                              : "function",
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
                          pendingChangeVariant={
                            destructivePendingChangesSet.has(
                              `${item.schema}.${item.name}`,
                            )
                              ? "destructive"
                              : "standard"
                          }
                          isSelected={selectedItems.has(selectionKey)}
                          onContextMenu={(e) => {
                            handleContextMenu(selectionKey, e);
                          }}
                        />
                      </DraggableSidebarItem>
                    );
                  })}
                </SidebarSection>
              )}

              {/* Multi-schema grouping: when multiple schemas are visible, group objects under each schema */}
              {/* For DuckDB, only local schemas (no dots) — attached DB schemas are rendered by DuckDbAttachedDatabaseSection */}
              {duckDbLocalSchemas.length > 1 && duckDbLocalSchemas.map((schemaName, schemaIdx) => {
                const schemaNodeKey = `schema:${schemaName}`;
                const schemaTables = filterItems(tables, "table").filter(t => t.schema === schemaName);
                const schemaViews = filterItems(views, "view").filter(v => v.schema === schemaName);
                const schemaFunctions = filterItems(functions, "function").filter(f => f.schema === schemaName);
                const schemaSequences = filterItems(sequences).filter(s => s.schema === schemaName);
                const schemaPackages = filterItems(packages).filter(p => p.schema === schemaName);
                const schemaSynonyms = filterItems(synonyms).filter(s => s.schema === schemaName);
                const schemaDraftTables = sidebarDraftTables.filter(d => {
                  const draftSchema = d.schema;
                  return draftSchema === schemaName;
                });
                const schemaTableCount = schemaTables.filter(t => !starredSet.has(`table:${t.schema}.${t.name}`)).length + schemaDraftTables.length;
                const schemaViewCount = schemaViews.filter(v => !starredSet.has(`view:${v.schema}.${v.name}`)).length;
                const schemaFunctionCount = schemaFunctions.filter(f => !starredSet.has(`function:${f.schema}.${f.name}`)).length;
                return (
                  <div key={schemaName}>
                    <button
                      className="flex items-center gap-1 w-full px-2 py-1 text-xs text-foreground/80 hover:bg-muted/50 rounded"
                      onClick={() => {
                        toggleNode(schemaNodeKey);
                      }}
                    >
                      {expandedNodes.has(schemaNodeKey) ? (
                        <IconChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <IconChevronRight className="h-3.5 w-3.5" />
                      )}
                      <IconDatabase className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{schemaName}</span>
                      {schemaIdx === 0 && <PrimaryBadge className="ml-1" />}
                    </button>
                    {expandedNodes.has(schemaNodeKey) && (
                      <div className="ml-2">
                        {/* Tables for this schema */}
                        {(schemaTableCount > 0 || isLoadingData) && (
                          <SidebarSection
                            title="Tables"
                            count={schemaTableCount}
                            isExpanded={expandedNodes.has(`tables:${schemaName}`)}
                            onToggle={() => {
                              toggleNode(`tables:${schemaName}`);
                            }}
                            stickyClass=""
                            onAdd={
                              dbType !== DbType.DuckDB ? handleCreateTable : undefined
                            }
                            addTooltip={
                              dbType !== DbType.DuckDB ? "Create new table" : undefined
                            }
                            addContent={
                              dbType === DbType.DuckDB ? (
                                <DuckDbTablesDropdown
                                  onNewTable={handleCreateTable}
                                  onImportFile={() => {
                                    void handleOpenDuckDbAddFileDialog();
                                  }}
                                  onImportUrl={() => {
                                    setDuckDbImportUrlDialogOpen(true);
                                  }}
                                  onFilePatternHelper={() => {
                                    setDuckDbGlobHelperDialogOpen(true);
                                  }}
                                  onExportData={() => {
                                    setDuckDbExportSource({ type: "query", sql: "" });
                                    setDuckDbExportDialogOpen(true);
                                  }}
                                  onAttachDatabase={() => {
                                    setDuckDbAttachDialogOpen(true);
                                  }}
                                  onAttachCatalog={() => {
                                    setDuckDbAttachCatalogDialogOpen(true);
                                  }}
                                  onManageSecrets={() => {
                                    setDuckDbSecretsPanelOpen(true);
                                  }}
                                  onManageExtensions={() => {
                                    setDuckDbExtensionsPanelOpen(true);
                                  }}
                                  onDetachDatabase={(alias) => {
                                    void handleDetachDatabase(alias);
                                  }}
                                  attachedDatabases={attachedDatabases}
                                  connections={connectedNonDuckDbSources}
                                  onSnapshotFromConnection={(_connId, connName) => {
                                    toast.info(
                                      `Snapshot from "${connName}" — use the context menu on individual tables to snapshot.`,
                                    );
                                  }}
                                  disabled={isAddingDuckDbFile}
                                />
                              ) : undefined
                            }
                            onSelectAll={handleSelectAllTables}
                            onCopyAllNames={handleCopyAllTableNames}
                          >
                            {schemaDraftTables.map((draft) => {
                              const isDraftActive = Boolean(
                                draft.panelId &&
                                draft.tabId &&
                                focusedPanelId === draft.panelId &&
                                focusedActiveTabSnapshot?.activeTabId === draft.tabId,
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
                                  className="bg-green-500/10 border-l-green-500"
                                />
                              );
                            })}
                            {schemaTables.map((table) => {
                              const tableKey = `${table.schema}.${table.name}`;
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
                                    pendingChangeVariant={
                                      destructivePendingChangesSet.has(
                                        `${table.schema}.${table.name}`,
                                      )
                                        ? "destructive"
                                        : "standard"
                                    }
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

                        {/* Views for this schema */}
                        {schemaViewCount > 0 && (
                          <SidebarSection
                            title="Views"
                            count={schemaViewCount}
                            isExpanded={expandedNodes.has(`views:${schemaName}`)}
                            onToggle={() => {
                              toggleNode(`views:${schemaName}`);
                            }}
                            onAdd={handleCreateView}
                            addTooltip="Create new view"
                            stickyClass=""
                            onSelectAll={handleSelectAllViews}
                            onCopyAllNames={handleCopyAllViewNames}
                          >
                            {schemaViews.map((view) => {
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
                                            ? "text-sky-500/80"
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
                                    pendingChangeVariant={
                                      destructivePendingChangesSet.has(
                                        `${view.schema}.${view.name}`,
                                      )
                                        ? "destructive"
                                        : "standard"
                                    }
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

                        {/* Functions for this schema */}
                        {schemaFunctionCount > 0 && (
                          <SidebarSection
                            title="Functions"
                            count={schemaFunctionCount}
                            isExpanded={expandedNodes.has(`functions:${schemaName}`)}
                            onToggle={() => {
                              toggleNode(`functions:${schemaName}`);
                            }}
                            stickyClass=""
                            onAdd={handleCreateFunction}
                            addTooltip="Create new function"
                            headerExtra={
                              <FunctionFilterDropdown
                                value={functionFilterMode}
                                onChange={setFunctionFilterMode}
                              />
                            }
                            onSelectAll={handleSelectAllFunctions}
                            onCopyAllNames={handleCopyAllFunctionNames}
                          >
                            {schemaFunctions.map((func) => {
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

                        {/* Sequences for this schema */}
                        {schemaSequences.length > 0 && (
                          <SidebarSection
                            title="Sequences"
                            count={schemaSequences.length}
                            isExpanded={expandedNodes.has(`sequences:${schemaName}`)}
                            onToggle={() => {
                              toggleNode(`sequences:${schemaName}`);
                            }}
                            stickyClass=""
                          >
                            {schemaSequences.map((sequence) => (
                              <SidebarItem
                                key={`${sequence.schema}.${sequence.name}`}
                                icon={
                                  <IconHash className="h-3.5 w-4 min-w-4 text-amber-500 shrink-0" />
                                }
                                name={sequence.name}
                                isActive={isObjectDefinitionActive(
                                  sequence.name,
                                  sequence.schema,
                                  "sequence",
                                )}
                                onClick={() => {
                                  handleSqlObjectDefinitionClick(sequence, "sequence");
                                }}
                              />
                            ))}
                          </SidebarSection>
                        )}

                        {/* Packages for this schema */}
                        {schemaPackages.length > 0 && (
                          <SidebarSection
                            title="Packages"
                            count={schemaPackages.length}
                            isExpanded={expandedNodes.has(`packages:${schemaName}`)}
                            onToggle={() => {
                              toggleNode(`packages:${schemaName}`);
                            }}
                            stickyClass=""
                          >
                            {schemaPackages.map((pkg) => (
                              <SidebarItem
                                key={`${pkg.schema}.${pkg.name}`}
                                icon={
                                  <IconPackage className="h-3.5 w-4 min-w-4 text-indigo-500 shrink-0" />
                                }
                                name={pkg.name}
                                badge={pkg.has_body ? "body" : undefined}
                                isActive={isObjectDefinitionActive(
                                  pkg.name,
                                  pkg.schema,
                                  "package",
                                )}
                                onClick={() => {
                                  handleSqlObjectDefinitionClick(pkg, "package");
                                }}
                              />
                            ))}
                          </SidebarSection>
                        )}

                        {/* Synonyms for this schema */}
                        {schemaSynonyms.length > 0 && (
                          <SidebarSection
                            title="Synonyms"
                            count={schemaSynonyms.length}
                            isExpanded={expandedNodes.has(`synonyms:${schemaName}`)}
                            onToggle={() => {
                              toggleNode(`synonyms:${schemaName}`);
                            }}
                            stickyClass=""
                          >
                            {schemaSynonyms.map((synonym) => (
                              <SidebarItem
                                key={`${synonym.schema}.${synonym.name}`}
                                icon={
                                  <IconLink className="h-3.5 w-4 min-w-4 text-cyan-500 shrink-0" />
                                }
                                name={synonym.name}
                                badge={
                                  synonym.target_name
                                    ? `${synonym.target_schema ? `${synonym.target_schema}.` : ""}${synonym.target_name}`
                                    : undefined
                                }
                                isActive={isObjectDefinitionActive(
                                  synonym.name,
                                  synonym.schema,
                                  "synonym",
                                )}
                                onClick={() => {
                                  handleSqlObjectDefinitionClick(synonym, "synonym");
                                }}
                              />
                            ))}
                          </SidebarSection>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Single-schema layout: flat Tables/Views/Functions sections */}
              {duckDbLocalSchemas.length <= 1 && (
              <>
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
                  onAdd={
                    dbType !== DbType.DuckDB ? handleCreateTable : undefined
                  }
                  addTooltip={
                    dbType !== DbType.DuckDB ? "Create new table" : undefined
                  }
                  addContent={
                    dbType === DbType.DuckDB ? (
                      <DuckDbTablesDropdown
                        onNewTable={handleCreateTable}
                        onImportFile={() => {
                          void handleOpenDuckDbAddFileDialog();
                        }}
                        onImportUrl={() => {
                          setDuckDbImportUrlDialogOpen(true);
                        }}
                        onFilePatternHelper={() => {
                          setDuckDbGlobHelperDialogOpen(true);
                        }}
                        onExportData={() => {
                          setDuckDbExportSource({ type: "query", sql: "" });
                          setDuckDbExportDialogOpen(true);
                        }}
                        onAttachDatabase={() => {
                          setDuckDbAttachDialogOpen(true);
                        }}
                        onAttachCatalog={() => {
                          setDuckDbAttachCatalogDialogOpen(true);
                        }}
                        onManageSecrets={() => {
                          setDuckDbSecretsPanelOpen(true);
                        }}
                        onManageExtensions={() => {
                          setDuckDbExtensionsPanelOpen(true);
                        }}
                        onDetachDatabase={(alias) => {
                          void handleDetachDatabase(alias);
                        }}
                        attachedDatabases={attachedDatabases}
                        connections={connectedNonDuckDbSources}
                        onSnapshotFromConnection={(_connId, connName) => {
                          toast.info(
                            `Snapshot from "${connName}" — use the context menu on individual tables to snapshot.`,
                          );
                        }}
                        disabled={isAddingDuckDbFile}
                      />
                    ) : undefined
                  }
                  onSelectAll={handleSelectAllTables}
                  onCopyAllNames={handleCopyAllTableNames}
                  extraContextMenuItems={
                    dbType === DbType.DuckDB ? (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={() => {
                            setDuckDbExportSource({ type: "query", sql: "" });
                            setDuckDbExportDialogOpen(true);
                          }}
                        >
                          <IconFileExport className="h-4 w-4 mr-2" />
                          Export...
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => { setDuckDbAttachDialogOpen(true); }}
                        >
                          <IconPlugConnected className="h-4 w-4 mr-2" />
                          Attach Database...
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => { setDuckDbAttachCatalogDialogOpen(true); }}
                        >
                          <IconBuildingWarehouse className="h-4 w-4 mr-2" />
                          Attach Catalog...
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => { setDuckDbSecretsPanelOpen(true); }}
                        >
                          <IconKey className="h-4 w-4 mr-2" />
                          Secrets...
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => { setDuckDbExtensionsPanelOpen(true); }}
                        >
                          <IconPuzzle className="h-4 w-4 mr-2" />
                          Extensions...
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => { setDuckDbGlobHelperDialogOpen(true); }}
                        >
                          <IconFileCode className="h-4 w-4 mr-2" />
                          File Pattern Helper...
                        </ContextMenuItem>
                        {attachedDatabases.filter(
                          (db) => db.databaseName !== "memory" && db.databaseName !== "system",
                        ).length > 0 && (
                          <ContextMenuSub>
                            <ContextMenuSubTrigger>
                              <IconPlugConnectedX className="h-4 w-4 mr-2" />
                              Detach Database
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                              {attachedDatabases
                                .filter((db) => db.databaseName !== "memory" && db.databaseName !== "system")
                                .map((db) => (
                                  <ContextMenuItem
                                    key={db.databaseName}
                                    onClick={() => { void handleDetachDatabase(db.databaseName); }}
                                  >
                                    <span className="truncate">{db.databaseName}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {db.dbType || "duckdb"}
                                      {db.readOnly ? " (ro)" : ""}
                                    </span>
                                  </ContextMenuItem>
                                ))}
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                        )}
                      </>
                    ) : undefined
                  }
                >
                  {sidebarDraftTables.map((draft) => {
                    const isDraftActive = Boolean(
                      draft.panelId &&
                      draft.tabId &&
                      focusedPanelId === draft.panelId &&
                      focusedActiveTabSnapshot?.activeTabId === draft.tabId,
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
                        className="bg-green-500/10 border-l-green-500"
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
                          pendingChangeVariant={
                            destructivePendingChangesSet.has(
                              `${table.schema}.${table.name}`,
                            )
                              ? "destructive"
                              : "standard"
                          }
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
                                  ? "text-sky-500/80"
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
                          pendingChangeVariant={
                            destructivePendingChangesSet.has(
                              `${view.schema}.${view.name}`,
                            )
                              ? "destructive"
                              : "standard"
                          }
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

              {/* Attached Databases (DuckDB only) */}
              {dbType === DbType.DuckDB && (() => {
                const primaryDbName = connection.database
                  .split(/[/\\]/)
                  .pop()
                  ?.replace(/\.duckdb$/i, "");
                // Databases from live query
                const liveAttached = attachedDatabases.filter((db) => {
                  if (db.databaseName === "memory" || db.databaseName === "system") return false;
                  return db.databaseName !== primaryDbName;
                });
                const liveNames = new Set(liveAttached.map(db => db.databaseName));
                // Databases derived from visible schemas (e.g. "pg.public" → "pg")
                // that aren't already in the live query results
                const extraFromSchemas = duckDbAttachedFromSchemas.filter(
                  name => !liveNames.has(name) && name !== primaryDbName,
                );
                return (
                  <>
                    {liveAttached.map((db) => {
                      // Derive schema names from visible schemas for this DB
                      const dbSchemas = visibleSchemas
                        .filter(s => s.startsWith(db.databaseName + "."))
                        .map(s => s.slice(db.databaseName.length + 1));
                      return (
                        <DuckDbAttachedDatabaseSection
                          key={`attached-${db.databaseName}`}
                          connectionId={connectionId}
                          dbName={db.databaseName}
                          dbType={db.dbType}
                          readOnly={db.readOnly}
                          schemaNames={dbSchemas}
                          onTableClick={(table) => { handleTableClick(table, "data"); }}
                          onDetach={(name) => { void handleDetachDatabase(name); }}
                        />
                      );
                    })}
                    {extraFromSchemas.map((name) => {
                      // Derive schema names for this attached DB from visible schemas
                      // e.g. visible ["pg.public", "pg.test"] for dbName "pg" → ["public", "test"]
                      const dbSchemas = visibleSchemas
                        .filter(s => s.startsWith(name + "."))
                        .map(s => s.slice(name.length + 1));
                      return (
                        <DuckDbAttachedDatabaseSection
                          key={`attached-schema-${name}`}
                          connectionId={connectionId}
                          dbName={name}
                          schemaNames={dbSchemas}
                          onTableClick={(table) => { handleTableClick(table, "data"); }}
                          onDetach={(dbName) => { void handleDetachDatabase(dbName); }}
                        />
                      );
                    })}
                  </>
                );
              })()}

              {/* Runtime databases from Phase 3 replay (not yet in attachedDatabases live query) */}
              {dbType === DbType.DuckDB &&
                runtimeDbs.databases
                  .filter(
                    (rd) =>
                      !attachedDatabases.some((ad) => ad.databaseName === rd.name),
                  )
                  .map((rd) => (
                    <DuckDbAttachedDatabaseSection
                      key={`runtime-${rd.name}`}
                      connectionId={connectionId}
                      dbName={rd.name}
                      dbType="DuckDB"
                      readOnly={false}
                      className="qp-runtime-only"
                      schemaNames={rd.visible_schemas}
                      onTableClick={(table) => { handleTableClick(table, "data"); }}
                      onDetach={(name) => { void handleDetachDatabase(name); }}
                    />
                  ))}

              {/* Attach errors from replay — with Retry */}
              {dbType === DbType.DuckDB &&
                runtimeAttachErrors.map((err) => (
                  <div
                    key={`attach-error-${err.alias}`}
                    className="px-3 py-1 text-xs text-destructive flex items-center gap-1"
                    title={err.message}
                  >
                    <span className="truncate">⚠ {err.alias}: {err.message}</span>
                  </div>
                ))}

              {/* Functions Section */}
              {allFunctions.length > 0 && (
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
                  headerExtra={
                    <FunctionFilterDropdown
                      value={functionFilterMode}
                      onChange={setFunctionFilterMode}
                    />
                  }
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

              {sequences.length > 0 && (
                <SidebarSection
                  title="Sequences"
                  count={sequences.length}
                  isExpanded={expandedNodes.has("sequences")}
                  onToggle={() => {
                    toggleNode("sequences");
                  }}
                  stickyClass=""
                >
                  {filterItems(sequences).map((sequence) => (
                    <SidebarItem
                      key={`${sequence.schema}.${sequence.name}`}
                      icon={
                        <IconHash className="h-3.5 w-4 min-w-4 text-amber-500 shrink-0" />
                      }
                      name={sequence.name}
                      isActive={isObjectDefinitionActive(
                        sequence.name,
                        sequence.schema,
                        "sequence",
                      )}
                      onClick={() => {
                        handleSqlObjectDefinitionClick(sequence, "sequence");
                      }}
                    />
                  ))}
                </SidebarSection>
              )}

              {packages.length > 0 && (
                <SidebarSection
                  title="Packages"
                  count={packages.length}
                  isExpanded={expandedNodes.has("packages")}
                  onToggle={() => {
                    toggleNode("packages");
                  }}
                  stickyClass=""
                >
                  {filterItems(packages).map((pkg) => (
                    <SidebarItem
                      key={`${pkg.schema}.${pkg.name}`}
                      icon={
                        <IconPackage className="h-3.5 w-4 min-w-4 text-indigo-500 shrink-0" />
                      }
                      name={pkg.name}
                      badge={pkg.has_body ? "body" : undefined}
                      isActive={isObjectDefinitionActive(
                        pkg.name,
                        pkg.schema,
                        "package",
                      )}
                      onClick={() => {
                        handleSqlObjectDefinitionClick(pkg, "package");
                      }}
                    />
                  ))}
                </SidebarSection>
              )}

              {synonyms.length > 0 && (
                <SidebarSection
                  title="Synonyms"
                  count={synonyms.length}
                  isExpanded={expandedNodes.has("synonyms")}
                  onToggle={() => {
                    toggleNode("synonyms");
                  }}
                  stickyClass=""
                >
                  {filterItems(synonyms).map((synonym) => (
                    <SidebarItem
                      key={`${synonym.schema}.${synonym.name}`}
                      icon={
                        <IconLink className="h-3.5 w-4 min-w-4 text-cyan-500 shrink-0" />
                      }
                      name={synonym.name}
                      badge={
                        synonym.target_name
                          ? `${synonym.target_schema ? `${synonym.target_schema}.` : ""}${synonym.target_name}`
                          : undefined
                      }
                      isActive={isObjectDefinitionActive(
                        synonym.name,
                        synonym.schema,
                        "synonym",
                      )}
                      onClick={() => {
                        handleSqlObjectDefinitionClick(synonym, "synonym");
                      }}
                    />
                  ))}
                </SidebarSection>
              )}
              </>
              )}

              {/* Empty state - SQL */}
              {!isLoadingData &&
                tables.length === 0 &&
                views.length === 0 &&
                allFunctions.length === 0 &&
                sequences.length === 0 &&
                packages.length === 0 &&
                synonyms.length === 0 && (
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
                            openMongoCollection(collection.name);
                          }}
                          isSelected={selectedItems.has(
                            `collection:${collection.name}`,
                          )}
                          onContextMenu={(e) => {
                            handleContextMenu(
                              `collection:${collection.name}`,
                              e,
                            );
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
                filteredRedisDatabases.map((dbInfo) => {
                  const isActive = isRedisDatabaseActive(dbInfo.db);
                  const dbLabel = `db${dbInfo.db}`;
                  const selectCommand = buildRedisSelectCommand(dbInfo.db);

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
                      <ContextMenu>
                        <ContextMenuTrigger className="block">
                          <SidebarItem
                            icon={
                              <IconDatabase className="h-3.5 w-4 min-w-4 text-orange-500 shrink-0" />
                            }
                            name={dbLabel}
                            rowCount={dbInfo.keys}
                            isActive={isActive}
                            onClick={() => {
                              openRedisDatabaseTab(dbInfo.db);
                            }}
                          />
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                            onClick={() => {
                              openRedisDatabaseTab(dbInfo.db);
                            }}
                          >
                            <IconEye className="h-4 w-4 mr-2" />
                            View Data
                          </ContextMenuItem>
                          <ContextMenuItem
                            onClick={() => {
                              void refetchRedisDatabases();
                            }}
                          >
                            <IconRefresh className="h-4 w-4 mr-2" />
                            Reload
                          </ContextMenuItem>
                          {duckDbScratchpads.length > 0 && (
                            <>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => {
                                  handleSnapshotRedisDatabaseToDuckDb(dbInfo.db);
                                }}
                              >
                                <IconDatabase className="h-4 w-4 mr-2" />
                                Snapshot to DuckDB...
                              </ContextMenuItem>
                            </>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onClick={() => {
                              void writeClipboardText(dbLabel);
                              toast.success("Copied DB name");
                            }}
                          >
                            <IconCopy className="h-4 w-4 mr-2" />
                            Copy DB Name
                          </ContextMenuItem>
                          <ContextMenuItem
                            onClick={() => {
                              void writeClipboardText(selectCommand);
                              toast.success("Copied Redis command");
                            }}
                          >
                            <IconCopy className="h-4 w-4 mr-2" />
                            Copy Command: {selectCommand}
                          </ContextMenuItem>
                          <ContextMenuItem
                            onClick={() => {
                              const definition = buildRedisDatabaseDefinition({
                                dbIndex: dbInfo.db,
                                keys: dbInfo.keys,
                                expires: dbInfo.expires,
                              });
                              void writeClipboardText(definition)
                                .then(() => {
                                  toast.success("Copied DB definition");
                                })
                                .catch(() => {
                                  toast.error("Failed to copy DB definition");
                                });
                            }}
                          >
                            <IconCopy className="h-4 w-4 mr-2" />
                            Copy Definition
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem disabled>
                            <IconBolt className="h-4 w-4 mr-2" />
                            Create Key (coming soon)
                          </ContextMenuItem>
                          <ContextMenuItem
                            variant="destructive"
                            onClick={() => {
                              requestConfirmation({
                                kind: "redis-truncate",
                                title: "Truncate Redis Database",
                                description:
                                  "This will remove all keys in the selected Redis database immediately. It will not be staged in Global Changes.",
                                entityName: dbLabel,
                                confirmLabel: "Flush DB",
                                onConfirm: async () => {
                                  await truncateRedisDatabase(dbInfo.db);
                                },
                              });
                            }}
                          >
                            <IconX className="h-4 w-4 mr-2" />
                            Truncate...
                          </ContextMenuItem>
                          <ContextMenuItem disabled variant="destructive">
                            <IconX className="h-4 w-4 mr-2" />
                            Delete DB (coming soon)
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    </DraggableSidebarItem>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu?.visible &&
        selectedItems.size > 0 &&
        (() => {
          const sidebarItems = getSelectedItems();
          const dataExportItem = mapSelectedItemsToDataExport(sidebarItems);
          const definitionExportItems = mapSelectedItemsToExport(sidebarItems);
          const selectedTypes = getSelectedTypesBreakdown();

          return (
            <DatabaseSidebarContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              selectedCount={selectedItems.size}
              selectedTypes={selectedTypes}
              onClose={() => {
                setContextMenu(null);
                setSelectedItems(new Set());
              }}
              canExportData={dataExportItem !== null}
              canExportDefinition={definitionExportItems.length > 0}
              onExportDataCSV={() => {
                void handleExportData("csv");
              }}
              onExportDataJSON={() => {
                void handleExportData("json");
              }}
              onExportDataInsert={() => {
                void handleExportData("insert");
              }}
              onExportDataMarkdown={() => {
                void handleExportData("markdown");
              }}
              onExportDefinition={() => {
                void handleExportDefinition();
              }}
              onExportDefinitionDBML={() => {
                void handleExportDefinitionDBML();
              }}
              onExportDefinitionMermaid={() => {
                void handleExportDefinitionMermaid();
              }}
              onCopyName={handleCopyName}
              onCopyDefinition={
                canCopyDefinition(selectedTypes)
                  ? () => void handleCopyDefinition()
                  : undefined
              }
              onPin={handlePin}
              onTruncate={
                canTruncate(selectedTypes) ? handleTruncate : undefined
              }
              onDelete={canDelete(selectedTypes) ? handleDelete : undefined}
              onRefreshMaterializedView={
                selectedTypes.materializedViews > 0
                  ? () => void handleRefreshMaterializedView()
                  : undefined
              }
              onSnapshotToDuckDb={
                canSnapshotToDuckDb(selectedTypes) &&
                duckDbScratchpads.length > 0
                  ? handleSnapshotSelectedObjectToDuckDb
                  : undefined
              }
              onViewData={handleViewData}
              onViewStructure={handleViewStructure}
              onViewIndexes={handleViewIndexes}
              onViewTriggers={handleViewTriggers}
              onViewDefinition={handleViewDefinition}
            />
          );
        })()}

      <DuckDbAddFileDialog
        key={
          duckDbAddFileDialogOpen
            ? `duckdb-add-file:${duckDbImportFiles
                .map((file) => file.filePath)
                .join("|")}`
            : "duckdb-add-file:closed"
        }
        open={duckDbAddFileDialogOpen}
        onOpenChange={(openValue) => {
          setDuckDbAddFileDialogOpen(openValue);
          if (!openValue) {
            setDuckDbImportFiles([]);
          }
        }}
        files={duckDbImportFiles}
        isSubmitting={isAddingDuckDbFile}
        loadSheets={(filePath) =>
          DuckDbScratchpadService.listExcelSheets(connectionId, filePath)
        }
        onConfirm={handleAddDuckDbFile}
      />

      <DuckDbImportUrlDialog
        open={duckDbImportUrlDialogOpen}
        onClose={() => {
          setDuckDbImportUrlDialogOpen(false);
          setDuckDbImportUrlInitial(undefined);
        }}
        onSubmit={handleImportDuckDbUrl}
        initialUrl={duckDbImportUrlInitial}
      />

      <DuckDbGlobHelperDialog
        open={duckDbGlobHelperDialogOpen}
        onClose={() => {
          setDuckDbGlobHelperDialogOpen(false);
        }}
      />

      <DuckDbAttachDatabaseDialog
        open={duckDbAttachDialogOpen}
        onClose={() => {
          setDuckDbAttachDialogOpen(false);
        }}
        onSubmit={handleAttachDatabase}
        currentConnectionId={connectionId}
      />

      <DuckDbAttachCatalogDialog
        open={duckDbAttachCatalogDialogOpen}
        onClose={() => {
          setDuckDbAttachCatalogDialogOpen(false);
        }}
        onSubmit={handleAttachCatalog}
      />

      <DuckDbSecretsPanel
        open={duckDbSecretsPanelOpen}
        onClose={() => {
          setDuckDbSecretsPanelOpen(false);
        }}
        connectionId={connectionId}
      />

      <DuckDbExtensionsPanel
        open={duckDbExtensionsPanelOpen}
        onClose={() => {
          setDuckDbExtensionsPanelOpen(false);
        }}
        connectionId={connectionId}
      />

      {duckDbExportSource && (
        <DuckDbExportDialog
          open={duckDbExportDialogOpen}
          onOpenChange={(openValue) => {
            setDuckDbExportDialogOpen(openValue);
            if (!openValue) {
              setDuckDbExportSource(null);
            }
          }}
          connId={connectionId}
          source={duckDbExportSource}
        />
      )}

      <SnapshotToDuckDbDialog
        key={
          snapshotDialogOpen && snapshotSource
            ? `duckdb-snapshot:${snapshotSource.kind}:${describeDuckDbSnapshotSource(snapshotSource)}`
            : "duckdb-snapshot:closed"
        }
        open={snapshotDialogOpen}
        onOpenChange={(openValue) => {
          setSnapshotDialogOpen(openValue);
          if (!openValue) {
            setSnapshotSource(null);
          }
        }}
        scratchpads={duckDbScratchpads}
        defaultTargetName={
          snapshotSource
            ? defaultDuckDbTargetNameFromSnapshotSource(snapshotSource)
            : DEFAULT_DUCKDB_TABLE_NAME
        }
        sourceLabel={
          snapshotSource
            ? describeDuckDbSnapshotSource(snapshotSource)
            : "selected source"
        }
        isSubmitting={isCreatingDuckDbSnapshot}
        onConfirm={handleCreateDuckDbSnapshot}
      />

      <ConfirmDeleteDialog
        open={pendingConfirmAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingConfirmAction(null);
          }
        }}
        title={pendingConfirmAction?.title ?? "Confirm Action"}
        description={pendingConfirmAction?.description ?? ""}
        entityName={pendingConfirmAction?.entityName}
        confirmLabel={pendingConfirmAction?.confirmLabel}
        confirmVariant={pendingConfirmAction?.confirmVariant}
        extraContent={
          pendingConfirmAction?.kind === "sql-truncate" &&
          (() => {
            const support = getSqlTruncateOptionSupport(dbType);
            if (!support.restartIdentity && !support.cascade) return null;

            return (
              <div className="space-y-3">
                {support.restartIdentity && (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={restartIdentityOptionId}
                      checked={sqlTruncateOptions.restartIdentity}
                      onCheckedChange={(checked) => {
                        setSqlTruncateOptions((prev) => ({
                          ...prev,
                          restartIdentity: checked,
                        }));
                      }}
                    />
                    <label
                      htmlFor={restartIdentityOptionId}
                      className="space-y-1 cursor-pointer select-none"
                    >
                      <div className="text-xs/relaxed font-medium">
                        Restart identity
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Reset sequences/auto-increment counters.
                      </p>
                    </label>
                  </div>
                )}
                {support.cascade && (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={cascadeOptionId}
                      checked={sqlTruncateOptions.cascade}
                      onCheckedChange={(checked) => {
                        setSqlTruncateOptions((prev) => ({
                          ...prev,
                          cascade: checked,
                        }));
                      }}
                    />
                    <label
                      htmlFor={cascadeOptionId}
                      className="space-y-1 cursor-pointer select-none"
                    >
                      <div className="text-xs/relaxed font-medium">Cascade</div>
                      <p className="text-xs text-muted-foreground">
                        Include dependent tables.
                      </p>
                    </label>
                  </div>
                )}
              </div>
            );
          })()
        }
        onConfirm={() => {
          const action = pendingConfirmAction;
          if (!action) return;
          setPendingConfirmAction(null);
          void action.onConfirm().catch((error: unknown) => {
            toast.error("Action failed", {
              description:
                error instanceof Error ? error.message : String(error),
            });
          });
        }}
      />

      <GlobalChangesDialog
        open={globalChangesDialogOpen}
        onOpenChange={setGlobalChangesDialogOpen}
        connectionId={connectionId}
      />
    </div>
  );
});
