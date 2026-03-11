import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ResolvedKeybinding } from "@/types/keybinding";
import type { CommandDescriptor } from "@/types/command";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import type { FunctionMeta, TableMeta } from "@/services/databaseService";
import { formatNumber } from "@/utils/formatters";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { schemaCache } from "@/services/schemaCache";
import { logger } from "@/lib/logger";
import type { OpenConnection } from "@/types/workspace";
import { type DbType, getParadigm } from "@/types/connection";
import type { CollectionInfo } from "@/adapters/types/mongodb";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import { RedisAdapter } from "@/adapters/redis/RedisAdapter";

export interface CategorizedCommand extends CommandDescriptor {
  keybinding?: ResolvedKeybinding;
}

// Unified item types for command palette
export type UnifiedItemType =
  | "table"
  | "view"
  | "materializedView"
  | "function"
  | "collection"
  | "redisDatabase"
  | "command";

interface RedisDatabaseInfo {
  db: number;
  keys: number;
  expires: number;
}

export interface UnifiedItem {
  id: string;
  type: UnifiedItemType;
  name: string;
  subtitle: string;
  keywords: string[];

  // Connection context for multi-connection support
  connectionId?: string;   // Which connection this belongs to
  connectionName?: string; // Display name (e.g., "ftl")
  database?: string;       // Database name (e.g., "aaa")
  schema?: string;         // Schema name (e.g., "public")
  dbType?: DbType;         // Database type for icon display

  // Type-specific payload
  table?: TableMeta;
  func?: FunctionMeta;
  collection?: CollectionInfo;
  redisDatabase?: RedisDatabaseInfo;
  command?: CategorizedCommand;
}

type TableEntityType = "table" | "view" | "materializedView";

const filterUserFunctions = (functions: FunctionMeta[]): FunctionMeta[] => {
  const userFunctions = functions.filter((func) => {
    // Skip extension functions (flagged by pg_depend + pg_extension query)
    if (func.is_extension) {
      return false;
    }

    if (func.schema === "pg_catalog" || func.schema === "information_schema") {
      return false;
    }

    const funcNameLower = func.name.toLowerCase();
    if (funcNameLower.includes("$$") || funcNameLower.startsWith("@") || funcNameLower.startsWith("~")) {
      return false;
    }

    return true;
  });

  // Deduplicate functions based on schema and name only (ignore overloads)
  const seen = new Set<string>();
  return userFunctions.filter((func) => {
    const key = `${func.schema}.${func.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function resolveKeybindingForCommand(
  commandId: string,
  bindings: ResolvedKeybinding[],
): ResolvedKeybinding | undefined {
  const candidates = bindings.filter(
    (binding) => binding.command === commandId,
  );
  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.sort((left, right) => right.weight - left.weight)[0];
}

/**
 * Hook to fetch and cache all available commands with their keybindings
 */
export function useCommands() {
  const keyboardServices = useKeyboardServicesOptional();

  return useQuery({
    queryKey: ["commands", "list"],
    queryFn: () => {
      // Return empty array if services not available yet
      if (!keyboardServices) {
        return [];
      }

      const { commandService, keybindingService } = keyboardServices;
      const descriptors = commandService.list();
      const keybindings = keybindingService.list();

      const enriched: CategorizedCommand[] = descriptors.map((descriptor) => ({
        ...descriptor,
        keybinding: resolveKeybindingForCommand(descriptor.id, keybindings),
      }));

      return enriched;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: !!keyboardServices, // Only fetch when services are available
  });
}

/**
 * Hook to fetch and cache keybindings, with invalidation mechanism
 */
export function useKeybindings() {
  const keyboardServices = useKeyboardServicesOptional();

  return useQuery({
    queryKey: ["keybindings", "list"],
    queryFn: () => {
      // Return empty array if services not available yet
      if (!keyboardServices) {
        return [];
      }

      const { keybindingService } = keyboardServices;
      return keybindingService.list();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: !!keyboardServices, // Only fetch when services are available
  });
}

interface ConnectionPaletteData {
  connection: OpenConnection;
  tables: TableMeta[];
  views: TableMeta[];
  functions: FunctionMeta[];
  collections: CollectionInfo[];
  redisDatabases: RedisDatabaseInfo[];
}

function canIncludeConnectionInPalette(connection: OpenConnection): boolean {
  if (connection.status !== "connected") return false;
  const paradigm = getParadigm(connection.profile.db_type);

  if (paradigm === "sql") {
    return Boolean(connection.database && connection.schema);
  }

  if (paradigm === "document") {
    return Boolean(connection.database);
  }

  // Redis can always be represented by keyspaces (db0, db1, ...)
  return true;
}

function getConnectionPaletteKey(connection: OpenConnection): string {
  const paradigm = getParadigm(connection.profile.db_type);

  if (paradigm === "sql") {
    return `${connection.id}:${connection.database}:${connection.schema}`;
  }

  if (paradigm === "document") {
    return `${connection.id}:${connection.database}`;
  }

  return `${connection.id}:${connection.database || "0"}`;
}

function parseRedisDatabases(
  serverInfo: Record<string, string>,
): RedisDatabaseInfo[] {
  const databases: RedisDatabaseInfo[] = [];

  for (const [key, value] of Object.entries(serverInfo)) {
    const dbMatch = key.match(/^db(\d+)$/);
    const valueMatch = value.match(/keys=(\d+),expires=(\d+)/);
    if (!dbMatch || !valueMatch) continue;

    databases.push({
      db: Number.parseInt(dbMatch[1]!, 10),
      keys: Number.parseInt(valueMatch[1]!, 10),
      expires: Number.parseInt(valueMatch[2]!, 10),
    });
  }

  databases.sort((left, right) => left.db - right.db);
  if (databases.length === 0) {
    return [{ db: 0, keys: 0, expires: 0 }];
  }
  return databases;
}

/**
 * Fetch searchable palette data for a single connection, across paradigms.
 */
async function fetchConnectionPaletteData(
  conn: OpenConnection,
): Promise<ConnectionPaletteData> {
  const emptyResult: ConnectionPaletteData = {
    connection: conn,
    tables: [],
    views: [],
    functions: [],
    collections: [],
    redisDatabases: [],
  };

  try {
    const paradigm = getParadigm(conn.profile.db_type);

    if (paradigm === "sql") {
      const [allTables, functions] = await Promise.all([
        schemaCache.getTables(conn.id, conn.schema),
        schemaCache.getFunctions(conn.id, conn.schema),
      ]);

      const tables = allTables.filter((t) => t.kind === "Table");
      const views = allTables.filter(
        (t) => t.kind === "View" || t.kind === "MaterializedView",
      );

      logger.info(
        `[fetchConnectionPaletteData] SQL ${conn.profile.name}: ${tables.length} tables, ${views.length} views, ${functions.length} functions`,
      );

      return {
        ...emptyResult,
        tables,
        views,
        functions: filterUserFunctions(functions),
      };
    }

    if (paradigm === "document") {
      const adapter = new MongoDBAdapter(conn.id);
      const collections = await adapter.listCollections();
      logger.info(
        `[fetchConnectionPaletteData] MongoDB ${conn.profile.name}: ${collections.length} collections`,
      );

      return {
        ...emptyResult,
        collections,
      };
    }

    const adapter = new RedisAdapter(conn.id);
    const serverInfo = await adapter.getServerInfo("keyspace");
    const redisDatabases = parseRedisDatabases(serverInfo);
    logger.info(
      `[fetchConnectionPaletteData] Redis ${conn.profile.name}: ${redisDatabases.length} keyspaces`,
    );

    return {
      ...emptyResult,
      redisDatabases,
    };
  } catch (err) {
    logger.error(
      `[fetchConnectionPaletteData] Failed to fetch for ${conn.profile.name}:`,
      err,
    );
    return emptyResult;
  }
}

/**
 * Hook to fetch palette data for the CURRENT (focused) connection.
 * High priority - fetches immediately for instant results.
 */
export function useCurrentConnectionPaletteData() {
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const focusedConnectionId = activeWorkspace?.focusedConnectionId;

  const currentConnection = useMemo(() => {
    if (!activeWorkspace || !focusedConnectionId) return null;
    const conn = activeWorkspace.connections.get(focusedConnectionId);
    if (conn && canIncludeConnectionInPalette(conn)) {
      return conn;
    }
    return null;
  }, [activeWorkspace, focusedConnectionId]);

  const connectionKey = currentConnection
    ? getConnectionPaletteKey(currentConnection)
    : null;

  return useQuery({
    queryKey: ["currentConnectionPaletteData", connectionKey],
    queryFn: async (): Promise<ConnectionPaletteData | null> => {
      if (!currentConnection) return null;
      logger.info(
        `[useCurrentConnectionPaletteData] Fetching data for current connection: ${currentConnection.profile.name}`,
      );
      return fetchConnectionPaletteData(currentConnection);
    },
    enabled: !!connectionKey,
    staleTime: 5 * 60 * 1000, // 5 minutes - reduce refetches
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false, // Use cache on open
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch palette data for OTHER connections (not the focused one).
 * Lower priority - fetches in background after current connection data is ready.
 */
export function useOtherConnectionsPaletteData(currentDataReady: boolean) {
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const focusedConnectionId = activeWorkspace?.focusedConnectionId;

  const otherConnections = useMemo(() => {
    if (!activeWorkspace) return [];
    return Array.from(activeWorkspace.connections.values())
      .filter(
        (connection) =>
          connection.id !== focusedConnectionId &&
          canIncludeConnectionInPalette(connection),
      );
  }, [activeWorkspace, focusedConnectionId]);

  const connectionKeys = useMemo(() => {
    return otherConnections
      .map(getConnectionPaletteKey)
      .sort();
  }, [otherConnections]);

  return useQuery({
    queryKey: ["otherConnectionsPaletteData", connectionKeys],
    queryFn: async (): Promise<ConnectionPaletteData[]> => {
      logger.info(
        `[useOtherConnectionsPaletteData] Fetching data for ${otherConnections.length} other connections`,
      );
      return Promise.all(otherConnections.map(fetchConnectionPaletteData));
    },
    enabled: currentDataReady && connectionKeys.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes - reduce refetches
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false, // Use cache on open
    refetchOnWindowFocus: false,
  });
}

/**
 * Convert connection palette data to unified items.
 */
function connectionDataToItems(connData: ConnectionPaletteData): UnifiedItem[] {
  const items: UnifiedItem[] = [];
  const { connection, tables, views, functions, collections, redisDatabases } =
    connData;
  const connId = connection.id;
  const connName = connection.profile.name;
  const database = connection.database || "";
  const dbType = connection.profile.db_type;

  const makeId = (entityType: string, schemaName: string, name: string) =>
    `${entityType}:${connId}:${schemaName}.${name}`;

  for (const table of tables) {
    items.push({
      id: makeId("table", table.schema, table.name),
      type: "table",
      name: table.name,
      subtitle: table.row_estimate ? `~${formatNumber(table.row_estimate)} rows` : "",
      schema: table.schema,
      connectionId: connId,
      connectionName: connName,
      database,
      dbType,
      keywords: [
        `${table.schema}.${table.name}`.toLowerCase(),
        "table",
        connName.toLowerCase(),
        database.toLowerCase(),
      ],
      table,
    });
  }

  for (const view of views) {
    const entityType: TableEntityType =
      view.kind === "MaterializedView" ? "materializedView" : "view";
    items.push({
      id: makeId(entityType, view.schema, view.name),
      type: entityType,
      name: view.name,
      subtitle: "",
      schema: view.schema,
      connectionId: connId,
      connectionName: connName,
      database,
      dbType,
      keywords: [
        `${view.schema}.${view.name}`.toLowerCase(),
        entityType,
        connName.toLowerCase(),
        database.toLowerCase(),
      ],
      table: view,
    });
  }

  for (const func of functions) {
    items.push({
      id: makeId("function", func.schema, func.name),
      type: "function",
      name: func.name,
      subtitle: "",
      schema: func.schema,
      connectionId: connId,
      connectionName: connName,
      database,
      dbType,
      keywords: [
        `${func.schema}.${func.name}`.toLowerCase(),
        "function",
        "func",
        connName.toLowerCase(),
        database.toLowerCase(),
      ],
      func,
    });
  }

  for (const collection of collections) {
    const collectionCount =
      typeof collection.docCount === "number"
        ? `~${formatNumber(collection.docCount)} docs`
        : "";

    items.push({
      id: `collection:${connId}:${database}.${collection.name}`,
      type: "collection",
      name: collection.name,
      subtitle: collectionCount,
      connectionId: connId,
      connectionName: connName,
      database,
      dbType,
      keywords: [
        collection.name.toLowerCase(),
        "collection",
        "mongo",
        connName.toLowerCase(),
        database.toLowerCase(),
      ],
      collection,
    });
  }

  for (const redisDatabase of redisDatabases) {
    const databaseName = `db${redisDatabase.db}`;
    const keyCount = `${formatNumber(redisDatabase.keys)} keys`;

    items.push({
      id: `redis-db:${connId}:${databaseName}`,
      type: "redisDatabase",
      name: databaseName,
      subtitle: keyCount,
      connectionId: connId,
      connectionName: connName,
      database: String(redisDatabase.db),
      dbType,
      keywords: [
        databaseName.toLowerCase(),
        "redis",
        "database",
        "keyspace",
        connName.toLowerCase(),
      ],
      redisDatabase,
    });
  }

  return items;
}

/**
 * Hook that combines all searchable items into a unified list.
 * Searches across ALL open connections in the workspace.
 * Uses prioritized loading: current connection first, others in background.
 */
export function useUnifiedItems() {
  const { data: commands = [], isLoading: isLoadingCommands } = useCommands();

  // Fetch current connection first (high priority)
  const {
    data: currentConnectionData,
    isLoading: isLoadingCurrent,
  } = useCurrentConnectionPaletteData();

  // Fetch other connections in background (lower priority, waits for current)
  const currentDataReady = !isLoadingCurrent && currentConnectionData !== undefined;
  const {
    data: otherConnectionsData = [],
    isLoading: isLoadingOthers,
  } = useOtherConnectionsPaletteData(currentDataReady);

  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const isInWorkspace = !!activeWorkspace;
  const connectionCount = activeWorkspace?.connections.size ?? 0;

  const unifiedItems = useMemo<UnifiedItem[]>(() => {
    const items: UnifiedItem[] = [];

    // Add current connection items first (available immediately)
    if (currentConnectionData) {
      items.push(...connectionDataToItems(currentConnectionData));
    }

    // Add other connections items (available progressively)
    for (const connData of otherConnectionsData) {
      items.push(...connectionDataToItems(connData));
    }

    // Filter commands based on context
    const contextFilteredCommands = commands.filter((cmd) => {
      if (cmd.id === "quickOpen.show") {
        return false;
      }
      if (
        cmd.id === "workspace.openDatabase" ||
        cmd.id === "workspace.openSchema" ||
        cmd.id === "workspace.createDatabase" ||
        cmd.id === "workspace.createSchema" ||
        cmd.id === "workspace.createTable" ||
        cmd.id === "workspace.createView" ||
        cmd.id === "workspace.createMaterializedView" ||
        cmd.id === "workspace.createFunction" ||
        cmd.id === "workspace.createProcedure" ||
        cmd.id === "workspace.createTrigger"
      ) {
        return isInWorkspace;
      }
      if (cmd.id === "connection.open") {
        return !isInWorkspace;
      }
      return true;
    });

    for (const command of contextFilteredCommands) {
      items.push({
        id: `command:${command.id}`,
        type: "command",
        name: command.label,
        subtitle: command.keybinding?.resolvedLabel ?? "",
        keywords: [
          command.id,
          command.description ?? "",
          command.category ?? "",
          "command",
        ].filter(Boolean),
        command,
      });
    }

    return items;
  }, [commands, currentConnectionData, otherConnectionsData, isInWorkspace]);

  return {
    unifiedItems,
    isLoading: isLoadingCommands,
    isLoadingCurrent,
    isLoadingOthers,
    connectionCount,
  };
}
