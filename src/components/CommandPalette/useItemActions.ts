import { useMemo, useCallback } from "react";
import { toast } from "sonner";
import type { UnifiedItem } from "./useCommandPaletteQueries";
import {
  ACTION_IDS,
  SCHEMA_CREATION_SUPPORTED,
  DATABASE_CREATION_SUPPORTED,
  type ActionItem,
  type ActionContext,
} from "./actions";
import { logger } from "@/lib/logger";
import { getAdapterForConnection } from "@/adapters";
import type { DatabaseAdapter } from "@/adapters/types";
import { queryStreamClient } from "@/services/queryStreamClient";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";

export type { ActionContext };
import {
  openTableObject,
  openFunctionObject,
  openMongoCollectionObject,
  openMongoCollectionMetadata,
  openRedisDatabaseObject,
  openRedisCliTab,
  openQueryWithSql,
  getCreateDatabaseTemplate,
  getCreateSchemaTemplate,
} from "@/utils/workbench/openers";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { windowManager } from "@/services/windowManager";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import type { DbType } from "@/types/connection";
import { writeClipboardText } from "@/lib/clipboard";
import { buildRedisSelectCommand } from "@/screens/workspace/components/sidebarContextMenuHelpers";

export interface UseItemActionsResult {
  actions: ActionItem[];
  executeAction: (actionId: string) => Promise<void>;
  context: ActionContext;
}

/**
 * Hook that returns context-sensitive actions for the selected item
 */
export function useItemActions(
  selectedItem: UnifiedItem | null,
  closePalette: () => void
): UseItemActionsResult {
  const fallbackConnectionId = useWorkspaceSelectionStore((state) => state.connectionId);
  const fallbackDatabase = useWorkspaceSelectionStore((state) => state.database);
  const fallbackSchema = useWorkspaceSelectionStore((state) => state.schema);

  const currentConnection = useConnectionStore((state) =>
    fallbackConnectionId ? state.getConnection(fallbackConnectionId) : undefined
  );
  const fallbackDbType: DbType | null = currentConnection?.profile.db_type ?? null;

  const services = useKeyboardServicesOptional();

  const context: ActionContext = useMemo(
    () => ({
      connectionId: selectedItem?.connectionId ?? fallbackConnectionId,
      database: selectedItem?.database ?? fallbackDatabase,
      schema: selectedItem?.schema ?? fallbackSchema,
      dbType: selectedItem?.dbType ?? fallbackDbType,
      closePalette,
    }),
    [
      selectedItem,
      fallbackConnectionId,
      fallbackDatabase,
      fallbackSchema,
      fallbackDbType,
      closePalette,
    ]
  );

  const actions = useMemo<ActionItem[]>(() => {
    if (!selectedItem) return [];

    switch (selectedItem.type) {
      case "table":
        return getTableActions(selectedItem);

      case "view":
      case "materializedView":
        return getViewActions(selectedItem);

      case "function":
        return getFunctionActions(selectedItem);

      case "collection":
        return getCollectionActions(selectedItem);

      case "redisDatabase":
        return getRedisDatabaseActions(selectedItem);

      case "command":
        return getCommandActions(selectedItem);

      default:
        return [];
    }
  }, [selectedItem]);

  const executeAction = useCallback(
    async (actionId: string) => {
      if (!selectedItem) return;

      try {
        await executeActionHandler(actionId, selectedItem, context, services);
      } catch (error) {
        console.error("Failed to execute action:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to execute action"
        );
      }
    },
    [selectedItem, context, services]
  );

  return {
    actions,
    executeAction,
    context,
  };
}

function getTableActions(_item: UnifiedItem): ActionItem[] {
  return [
    {
      id: ACTION_IDS.OPEN_DATA,
      label: "Open Data",
      shortcut: "Enter",
    },
    {
      id: ACTION_IDS.OPEN_STRUCTURE,
      label: "Open Structure",
      shortcut: "S",
    },
    {
      id: ACTION_IDS.OPEN_INDEXES,
      label: "Open Indexes",
      shortcut: "I",
    },
    {
      id: ACTION_IDS.OPEN_TRIGGERS,
      label: "Open Triggers",
      shortcut: "T",
    },
    {
      id: ACTION_IDS.OPEN_DEFINITION,
      label: "Open Definition",
      shortcut: "D",
    },
    {
      id: ACTION_IDS.COPY_NAME,
      label: "Copy Name",
      shortcut: "C",
    },
    {
      id: ACTION_IDS.COPY_QUALIFIED_NAME,
      label: "Copy Qualified Name",
      shortcut: "Shift+C",
    },
  ];
}

function getViewActions(item: UnifiedItem): ActionItem[] {
  const isMaterializedView = item.type === "materializedView";
  const actions: ActionItem[] = [
    {
      id: ACTION_IDS.OPEN_DATA,
      label: "Open Data",
      shortcut: "Enter",
    },
    {
      id: ACTION_IDS.OPEN_STRUCTURE,
      label: "Open Structure",
      shortcut: "S",
    },
  ];

  if (isMaterializedView) {
    actions.push({
      id: ACTION_IDS.OPEN_INDEXES,
      label: "Open Indexes",
      shortcut: "I",
    });
  }

  actions.push({
    id: ACTION_IDS.OPEN_DEFINITION,
    label: "Open Definition",
    shortcut: "D",
  });

  if (isMaterializedView) {
    actions.push({
      id: ACTION_IDS.REFRESH_MATERIALIZED_VIEW,
      label: "Refresh Materialized View",
      shortcut: "R",
    });
  }

  actions.push(
    {
      id: ACTION_IDS.COPY_NAME,
      label: "Copy Name",
      shortcut: "C",
    },
    {
      id: ACTION_IDS.COPY_QUALIFIED_NAME,
      label: "Copy Qualified Name",
      shortcut: "Shift+C",
    },
  );

  return actions;
}

function getFunctionActions(_item: UnifiedItem): ActionItem[] {
  return [
    {
      id: ACTION_IDS.OPEN_DEFINITION,
      label: "Open Definition",
      shortcut: "Enter",
    },
    {
      id: ACTION_IDS.COPY_NAME,
      label: "Copy Name",
      shortcut: "C",
    },
    {
      id: ACTION_IDS.COPY_QUALIFIED_NAME,
      label: "Copy Qualified Name",
      shortcut: "Shift+C",
    },
    {
      id: ACTION_IDS.COPY_CALL_SIGNATURE,
      label: "Copy Call Signature",
      shortcut: "S",
    },
  ];
}

function getCollectionActions(_item: UnifiedItem): ActionItem[] {
  return [
    {
      id: ACTION_IDS.OPEN_DATA,
      label: "Open Data",
      shortcut: "Enter",
    },
    {
      id: ACTION_IDS.OPEN_METADATA,
      label: "Open Metadata",
      shortcut: "M",
    },
    {
      id: ACTION_IDS.COPY_NAME,
      label: "Copy Name",
      shortcut: "C",
    },
    {
      id: ACTION_IDS.COPY_QUALIFIED_NAME,
      label: "Copy Qualified Name",
      shortcut: "Shift+C",
    },
  ];
}

function getRedisDatabaseActions(_item: UnifiedItem): ActionItem[] {
  return [
    {
      id: ACTION_IDS.OPEN_DATA,
      label: "Open Data",
      shortcut: "Enter",
    },
    {
      id: ACTION_IDS.OPEN_REDIS_CLI,
      label: "Open Redis CLI",
      shortcut: "R",
    },
    {
      id: ACTION_IDS.COPY_NAME,
      label: "Copy DB Name",
      shortcut: "C",
    },
    {
      id: ACTION_IDS.COPY_REDIS_SELECT_COMMAND,
      label: "Copy SELECT Command",
      shortcut: "S",
    },
  ];
}

function getCommandActions(_item: UnifiedItem): ActionItem[] {
  return [
    {
      id: ACTION_IDS.EXECUTE,
      label: "Execute",
      shortcut: "Enter",
    },
  ];
}

function getRedisDbIndex(item: UnifiedItem): number | null {
  const isValidDbIndex = (dbIndex: number): boolean =>
    Number.isInteger(dbIndex) && dbIndex >= 0;

  if (item.redisDatabase && isValidDbIndex(item.redisDatabase.db)) {
    return item.redisDatabase.db;
  }

  if (item.database && /^\d+$/.test(item.database)) {
    const parsedDbIndex = Number.parseInt(item.database, 10);
    if (isValidDbIndex(parsedDbIndex)) {
      return parsedDbIndex;
    }
  }

  const nameMatch = item.name.match(/^db(\d+)$/i);
  if (nameMatch) {
    const matchedDbIndex = nameMatch[1];
    if (matchedDbIndex) {
      const parsedDbIndex = Number.parseInt(matchedDbIndex, 10);
      if (isValidDbIndex(parsedDbIndex)) {
        return parsedDbIndex;
      }
    }
  }

  return null;
}

async function executeActionHandler(
  actionId: string,
  item: UnifiedItem,
  context: ActionContext,
  services: ReturnType<typeof useKeyboardServicesOptional>
): Promise<void> {
  const { connectionId, database, closePalette } = context;

  switch (actionId) {
    case ACTION_IDS.OPEN_DATA: {
      if (item.table) {
        if (!connectionId || !database) return;
        openTableObject({
          table: item.table,
          connectionId,
          database,
          viewType: "data",
        });
        closePalette();
        break;
      }

      if (item.type === "collection" && item.collection) {
        if (!connectionId || !database) return;
        openMongoCollectionObject({
          connectionId,
          database,
          collectionName: item.collection.name,
        });
        closePalette();
        break;
      }

      if (item.type === "redisDatabase") {
        if (!connectionId) return;
        const dbIndex = getRedisDbIndex(item);
        if (dbIndex === null) return;
        openRedisDatabaseObject({
          connectionId,
          dbIndex,
        });
        closePalette();
      }
      break;
    }

    case ACTION_IDS.OPEN_STRUCTURE: {
      if (!connectionId || !database || !item.table) return;
      openTableObject({
        table: item.table,
        connectionId,
        database,
        viewType: "structure",
      });
      closePalette();
      break;
    }

    case ACTION_IDS.OPEN_INDEXES: {
      if (!connectionId || !database || !item.table) return;
      openTableObject({
        table: item.table,
        connectionId,
        database,
        viewType: "indexes",
      });
      closePalette();
      break;
    }

    case ACTION_IDS.OPEN_TRIGGERS: {
      if (!connectionId || !database || !item.table) return;
      openTableObject({
        table: item.table,
        connectionId,
        database,
        viewType: "triggers",
      });
      closePalette();
      break;
    }

    case ACTION_IDS.OPEN_METADATA: {
      if (!connectionId || !database || item.type !== "collection" || !item.collection) return;
      openMongoCollectionMetadata({
        connectionId,
        database,
        collectionName: item.collection.name,
      });
      closePalette();
      break;
    }

    case ACTION_IDS.OPEN_REDIS_CLI: {
      if (!connectionId || item.type !== "redisDatabase") return;
      const dbIndex = getRedisDbIndex(item);
      if (dbIndex === null) return;
      openRedisCliTab({
        connectionId,
        dbIndex,
      });
      closePalette();
      break;
    }

    case ACTION_IDS.OPEN_DEFINITION: {
      if (!connectionId || !database) return;

      if (item.func) {
        openFunctionObject({
          func: item.func,
          connectionId,
          database,
        });
      } else if (item.table) {
        // For tables/views, open definition shows the DDL
        openTableObject({
          table: item.table,
          connectionId,
          database,
          viewType: "definition",
        });
      }
      closePalette();
      break;
    }

    case ACTION_IDS.COPY_NAME: {
      const name = item.name;
      await writeClipboardText(name);
      toast.success(`Copied "${name}" to clipboard`);
      closePalette();
      break;
    }

    case ACTION_IDS.COPY_QUALIFIED_NAME: {
      const qualifiedName = item.type === "collection"
        ? `${item.database ?? ""}.${item.name}`.replace(/^\./, "")
        : item.schema
        ? `${item.schema}.${item.name}`
        : item.name;
      await writeClipboardText(qualifiedName);
      toast.success(`Copied "${qualifiedName}" to clipboard`);
      closePalette();
      break;
    }

    case ACTION_IDS.COPY_CALL_SIGNATURE: {
      if (!item.func) return;
      // Create a basic call signature: schema.func_name()
      const signature = `${item.func.schema}.${item.func.name}()`;
      await writeClipboardText(signature);
      toast.success(`Copied "${signature}" to clipboard`);
      closePalette();
      break;
    }

    case ACTION_IDS.EXECUTE: {
      if (!item.command || !services) return;
      await services.commandService.execute(item.command.id);
      closePalette();
      break;
    }

    case ACTION_IDS.COPY_REDIS_SELECT_COMMAND: {
      if (item.type !== "redisDatabase") return;
      const dbIndex = getRedisDbIndex(item);
      if (dbIndex === null) return;
      const selectCommand = buildRedisSelectCommand(dbIndex);
      await writeClipboardText(selectCommand);
      toast.success(`Copied "${selectCommand}" to clipboard`);
      closePalette();
      break;
    }

    case ACTION_IDS.REFRESH_MATERIALIZED_VIEW: {
      if (!connectionId || !database || !item.table || item.table.kind !== "MaterializedView") return;
      const { schema, name } = item.table;
      try {
        const adapter = (await getAdapterForConnection(connectionId)) as DatabaseAdapter;
        const sql = adapter.refreshMaterializedView(schema, name) as string;
        if (typeof sql !== "string") {
          throw new Error("Refresh materialized view is not supported by this database");
        }
        await queryStreamClient.streamWithCallbacks(
          {
            connId: connectionId,
            tabId: "system",
            sql,
            batchSize: 1,
          },
          {},
        );
        useDataInvalidationStore
          .getState()
          .invalidateTable(connectionId, database, schema, name);
        openTableObject({
          table: item.table,
          connectionId,
          database,
          viewType: "data",
        });
        toast.success(`Refreshed ${name}`);
        closePalette();
      } catch (error) {
        logger.error("Failed to refresh materialized view:", error);
        throw error;
      }
      break;
    }

    default:
      console.warn(`Unknown action: ${actionId}`);
  }
}

/**
 * Sanitize a name for database/schema creation
 * - Trim whitespace
 * - Replace spaces with underscores
 * - Remove invalid characters
 */
function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();
}

/**
 * Get actions for nested database list view
 */
export function getNestedDatabaseActions(dbType: DbType | null, query: string): ActionItem[] {
  const actions: ActionItem[] = [];

  actions.push(
    {
      id: ACTION_IDS.ADD_TO_WORKSPACE,
      label: "Add to Workspace",
      shortcut: "W",
    },
    {
      id: ACTION_IDS.OPEN_IN_NEW_WINDOW,
      label: "Open in New Window",
      shortcut: "O",
    },
  );

  if (dbType && DATABASE_CREATION_SUPPORTED.includes(dbType)) {
    const sanitizedName = sanitizeName(query);
    const displayName = sanitizedName || "new_database";
    actions.push({
      id: ACTION_IDS.CREATE_DATABASE,
      label: `Create Database "${displayName}"`,
      shortcut: "N",
    });
  }

  return actions;
}

/**
 * Get actions for nested schema list view
 */
export function getNestedSchemaActions(dbType: DbType | null, query: string): ActionItem[] {
  const actions: ActionItem[] = [];

  if (dbType && SCHEMA_CREATION_SUPPORTED.includes(dbType)) {
    const sanitizedName = sanitizeName(query);
    const displayName = sanitizedName || "new_schema";
    actions.push({
      id: ACTION_IDS.CREATE_SCHEMA,
      label: `Create Schema "${displayName}"`,
      shortcut: "N",
    });
  }

  return actions;
}

/**
 * Execute schema-specific actions
 */
export function executeSchemaAction(
  actionId: string,
  query: string,
  context: ActionContext
): void {
  const { connectionId, database, closePalette, dbType } = context;

  switch (actionId) {
    case ACTION_IDS.CREATE_SCHEMA: {
      if (!connectionId) return;
      // Use sanitized query as the schema name, fallback to "new_schema"
      const schemaName = sanitizeName(query) || "new_schema";
      const sql = getCreateSchemaTemplate(dbType, schemaName);
      openQueryWithSql({
        connectionId,
        database,
        schema: null,
        sql,
        title: `Create Schema "${schemaName}"`,
      });
      closePalette();
      break;
    }
  }
}

/**
 * Execute database-specific actions
 */
export function executeDatabaseAction(
  actionId: string,
  query: string,
  context: ActionContext,
  selectedValue?: string,
): void {
  const { connectionId, database, closePalette, dbType } = context;

  switch (actionId) {
    case ACTION_IDS.CREATE_DATABASE: {
      if (!connectionId) return;
      // Use sanitized query as the database name, fallback to "new_database"
      const dbName = sanitizeName(query) || "new_database";
      const sql = getCreateDatabaseTemplate(dbType, dbName);
      openQueryWithSql({
        connectionId,
        database,
        schema: null,
        sql,
        title: `Create Database "${dbName}"`,
      });
      closePalette();
      break;
    }

    case ACTION_IDS.ADD_TO_WORKSPACE: {
      if (!selectedValue || !connectionId) return;
      void addSelectedToWorkspace(selectedValue, connectionId, closePalette);
      break;
    }

    case ACTION_IDS.OPEN_IN_NEW_WINDOW: {
      if (!selectedValue || !connectionId) return;
      void openSelectedInNewWindow(selectedValue, connectionId, closePalette);
      break;
    }
  }
}

/**
 * Resolve the selected value to a connection ID.
 * selectedValue is either a database name (from "On this Server") or a profile ID (from "Saved Profiles").
 */
async function resolveSelectedConnection(
  selectedValue: string,
  currentConnectionId: string,
): Promise<{ connectionId: string; label: string } | null> {
  const connectionStore = useConnectionStore.getState();

  // Check if selectedValue is a saved profile ID
  const profileMatch = connectionStore.connections.find(
    (c) => c.profile.id === selectedValue,
  );
  if (profileMatch) {
    return { connectionId: profileMatch.profile.id, label: profileMatch.profile.name };
  }

  // Otherwise it's a database name on the current server
  const dbName = selectedValue;
  const newId = await connectionStore.getOrCreateDatabaseConnection(
    currentConnectionId,
    dbName,
  );
  if (!newId) return null;
  return { connectionId: newId, label: dbName };
}

async function addSelectedToWorkspace(
  selectedValue: string,
  currentConnectionId: string,
  closePalette: () => void,
): Promise<void> {
  try {
    const resolved = await resolveSelectedConnection(selectedValue, currentConnectionId);
    if (!resolved) {
      toast.error("Failed to resolve connection");
      return;
    }

    const store = useWorkspaceBundleStore.getState();
    if (store.activeWorkspace?.connections.has(resolved.connectionId)) {
      store.setFocusedConnection(resolved.connectionId);
      toast.info(`${resolved.label} is already in workspace`);
    } else {
      await store.addConnectionToWorkspace(resolved.connectionId);
      toast.success(`Added ${resolved.label} to workspace`);
    }
    closePalette();
  } catch (error) {
    logger.error("Failed to add to workspace:", error);
    toast.error("Failed to add to workspace");
  }
}

async function openSelectedInNewWindow(
  selectedValue: string,
  currentConnectionId: string,
  closePalette: () => void,
): Promise<void> {
  try {
    const resolved = await resolveSelectedConnection(selectedValue, currentConnectionId);
    if (!resolved) {
      toast.error("Failed to resolve connection");
      return;
    }

    if (windowManager.isWorkspaceOpen(resolved.connectionId)) {
      await windowManager.focusWorkspace(resolved.connectionId);
    } else {
      await windowManager.openWorkspace(resolved.connectionId, resolved.label);
    }
    closePalette();
  } catch (error) {
    logger.error("Failed to open in new window:", error);
    toast.error("Failed to open in new window");
  }
}
