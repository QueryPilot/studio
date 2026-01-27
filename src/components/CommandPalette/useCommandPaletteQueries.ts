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
import type { DbType } from "@/types/connection";

export interface CategorizedCommand extends CommandDescriptor {
  keybinding?: ResolvedKeybinding;
}

// Unified item types for command palette
export type UnifiedItemType = "table" | "view" | "materializedView" | "function" | "command";

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
  command?: CategorizedCommand;
}

type TableEntityType = "table" | "view" | "materializedView";

// System function prefixes to filter out (same as useSchemaData)
const SYSTEM_FUNCTION_PREFIXES = [
  "pg_", "pgp_", "pgsodium_", "hstore_", "json_", "jsonb_", "array_",
  "enum_", "range_", "ts_", "txid_", "uuid_", "xml_", "inet_", "cidr_",
  "macaddr_", "bit_", "varbit_", "bytea_", "lo_", "large_object_", "obj_",
  "oid", "regclass", "regconfig", "regdictionary", "regnamespace",
  "regoper", "regoperator", "regproc", "regprocedure", "regrole", "regtype",
];

const filterUserFunctions = (functions: FunctionMeta[]): FunctionMeta[] => {
  const userFunctions = functions.filter((func) => {
    if (func.schema === "pg_catalog" || func.schema === "information_schema") {
      return false;
    }

    const funcNameLower = func.name.toLowerCase();
    if (SYSTEM_FUNCTION_PREFIXES.some((prefix) => funcNameLower.startsWith(prefix))) {
      return false;
    }

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

interface ConnectionSchemaData {
  connection: OpenConnection;
  tables: TableMeta[];
  views: TableMeta[];
  functions: FunctionMeta[];
}

/**
 * Hook to fetch schema data from ALL open connections in the workspace.
 * Used by Command Palette for cross-connection search.
 */
export function useAllConnectionsSchemaData() {
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);

  // Get connected connections
  const connectedConnections = useMemo(() => {
    if (!activeWorkspace) return [];
    return Array.from(activeWorkspace.connections.values())
      .filter(c => c.status === "connected" && c.database && c.schema);
  }, [activeWorkspace]);

  // Build stable query key from connection states
  const connectionKeys = useMemo(() => {
    return connectedConnections
      .map(c => `${c.id}:${c.database}:${c.schema}`)
      .sort();
  }, [connectedConnections]);

  return useQuery({
    queryKey: ["allConnectionsSchemaData", connectionKeys],
    queryFn: async (): Promise<ConnectionSchemaData[]> => {
      logger.info(`[useAllConnectionsSchemaData] Fetching data for ${connectedConnections.length} connections`);

      const results = await Promise.all(
        connectedConnections.map(async (conn) => {
          try {
            const [allTables, functions] = await Promise.all([
              schemaCache.getTables(conn.id, conn.schema),
              schemaCache.getFunctions(conn.id, conn.schema),
            ]);

            // Separate tables and views
            const tables = allTables.filter((t) => t.kind === "Table");
            const views = allTables.filter((t) => t.kind === "View" || t.kind === "MaterializedView");

            logger.info(`[useAllConnectionsSchemaData] ${conn.profile.name}: ${tables.length} tables, ${views.length} views, ${functions.length} functions`);

            return {
              connection: conn,
              tables,
              views,
              functions: filterUserFunctions(functions),
            };
          } catch (err) {
            logger.error(`[useAllConnectionsSchemaData] Failed to fetch for ${conn.profile.name}:`, err);
            return {
              connection: conn,
              tables: [],
              views: [],
              functions: [],
            };
          }
        })
      );

      return results;
    },
    enabled: connectionKeys.length > 0,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook that combines all searchable items into a unified list.
 * Searches across ALL open connections in the workspace.
 */
export function useUnifiedItems() {
  const { data: commands = [], isLoading: isLoadingCommands } = useCommands();
  const { data: allConnectionsData = [], isLoading: isLoadingSchemaData } = useAllConnectionsSchemaData();

  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const isInWorkspace = !!activeWorkspace;
  const connectionCount = activeWorkspace?.connections.size ?? 0;

  const unifiedItems = useMemo<UnifiedItem[]>(() => {
    const items: UnifiedItem[] = [];

    // Add database objects from all connections
    for (const connData of allConnectionsData) {
      const { connection, tables, views, functions } = connData;
      const connId = connection.id;
      const connName = connection.profile.name;
      const database = connection.database;
      const dbType = connection.profile.db_type;

      // Helper to create item ID with connection context
      const makeId = (entityType: string, schemaName: string, name: string) =>
        `${entityType}:${connId}:${schemaName}.${name}`;

      // Add tables
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

      // Add views
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

      // Add functions
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
    }

    // Filter commands based on context
    const contextFilteredCommands = commands.filter((cmd) => {
      // Hide commands that shouldn't appear in the palette
      if (cmd.id === "quickOpen.show") {
        return false;
      }
      // Workspace-only commands - only show when in a workspace
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
      // Home-only commands - only show when NOT in a workspace
      if (cmd.id === "connection.open") {
        return !isInWorkspace;
      }
      return true;
    });

    // Add filtered commands
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
  }, [commands, allConnectionsData, isInWorkspace]);

  return {
    unifiedItems,
    isLoading: isLoadingCommands || isLoadingSchemaData,
    connectionCount,
  };
}
