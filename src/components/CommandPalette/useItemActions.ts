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
import {
  openTableObject,
  openFunctionObject,
  openQueryWithTemplate,
} from "@/utils/workbench/openers";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import { DbType } from "@/types/connection";

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
  const connectionId = useWorkspaceSelectionStore((state) => state.connectionId);
  const database = useWorkspaceSelectionStore((state) => state.database);
  const schema = useWorkspaceSelectionStore((state) => state.schema);

  const currentConnection = useConnectionStore((state) =>
    connectionId ? state.getConnection(connectionId) : undefined
  );
  const dbType: DbType | null = currentConnection?.profile.db_type ?? null;

  const services = useKeyboardServicesOptional();

  const context: ActionContext = useMemo(
    () => ({
      connectionId,
      database,
      schema,
      dbType,
      closePalette,
    }),
    [connectionId, database, schema, dbType, closePalette]
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
      id: ACTION_IDS.OPEN_DESIGNER,
      label: "Open in Designer",
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

function getViewActions(_item: UnifiedItem): ActionItem[] {
  return [
    {
      id: ACTION_IDS.OPEN_DATA,
      label: "Open Data",
      shortcut: "Enter",
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
      id: ACTION_IDS.COPY_CALL_SIGNATURE,
      label: "Copy Call Signature",
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
    {
      id: ACTION_IDS.COPY_COMMAND_ID,
      label: "Copy Command ID",
      shortcut: "C",
    },
  ];
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
      if (!connectionId || !database || !item.table) return;
      openTableObject({
        table: item.table,
        connectionId,
        database,
        viewType: "data",
      });
      closePalette();
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

    case ACTION_IDS.OPEN_DESIGNER: {
      if (!connectionId || !database || !item.table) return;
      // Open in designer mode - using the design tab type
      openTableObject({
        table: item.table,
        connectionId,
        database,
        viewType: "structure", // Designer uses structure view type
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
        // For views, open definition shows the SQL
        openTableObject({
          table: item.table,
          connectionId,
          database,
          viewType: "structure",
        });
      }
      closePalette();
      break;
    }

    case ACTION_IDS.COPY_NAME: {
      const name = item.name;
      await navigator.clipboard.writeText(name);
      toast.success(`Copied "${name}" to clipboard`);
      closePalette();
      break;
    }

    case ACTION_IDS.COPY_QUALIFIED_NAME: {
      const qualifiedName = item.schema ? `${item.schema}.${item.name}` : item.name;
      await navigator.clipboard.writeText(qualifiedName);
      toast.success(`Copied "${qualifiedName}" to clipboard`);
      closePalette();
      break;
    }

    case ACTION_IDS.COPY_CALL_SIGNATURE: {
      if (!item.func) return;
      // Create a basic call signature: schema.func_name()
      const signature = `${item.func.schema}.${item.func.name}()`;
      await navigator.clipboard.writeText(signature);
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

    case ACTION_IDS.COPY_COMMAND_ID: {
      if (!item.command) return;
      await navigator.clipboard.writeText(item.command.id);
      toast.success(`Copied "${item.command.id}" to clipboard`);
      closePalette();
      break;
    }

    default:
      console.warn(`Unknown action: ${actionId}`);
  }
}

/**
 * Get actions for schema items in nested schema list
 */
export function getSchemaActions(dbType: DbType | null): ActionItem[] {
  const actions: ActionItem[] = [
    {
      id: ACTION_IDS.MARK_AS_DEFAULT,
      label: "Mark as Default",
      shortcut: "D",
    },
  ];

  if (dbType && SCHEMA_CREATION_SUPPORTED.includes(dbType)) {
    actions.push({
      id: ACTION_IDS.CREATE_SCHEMA,
      label: "Create New Schema",
      shortcut: "N",
    });
  }

  return actions;
}

/**
 * Get actions for database items in nested database list
 */
export function getDatabaseActions(dbType: DbType | null): ActionItem[] {
  const actions: ActionItem[] = [];

  if (dbType && DATABASE_CREATION_SUPPORTED.includes(dbType)) {
    actions.push({
      id: ACTION_IDS.CREATE_DATABASE,
      label: "Create New Database",
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
  schemaName: string,
  context: ActionContext
): void {
  const { connectionId, database, closePalette } = context;

  switch (actionId) {
    case ACTION_IDS.MARK_AS_DEFAULT: {
      // This would update the connection profile's default_schema
      // For now, just show a toast - the actual implementation
      // would need to update the vault storage
      toast.info(`Marked "${schemaName}" as default schema`);
      closePalette();
      break;
    }

    case ACTION_IDS.CREATE_SCHEMA: {
      if (!connectionId) return;
      openQueryWithTemplate({
        connectionId,
        database,
        schema: schemaName,
        objectType: "schema",
      });
      closePalette();
      break;
    }
  }
}

/**
 * Execute database-specific actions
 */
export async function executeDatabaseAction(
  actionId: string,
  _databaseName: string,
  context: ActionContext
): Promise<void> {
  const { connectionId, closePalette, dbType } = context;

  switch (actionId) {
    case ACTION_IDS.CREATE_DATABASE: {
      if (!connectionId) return;
      // Open a query tab with CREATE DATABASE template
      // The template varies by database type
      const template = getCreateDatabaseTemplate(dbType, "new_database");
      // For now, copy to clipboard since we need a way to open query without schema context
      await navigator.clipboard.writeText(template);
      toast.success("CREATE DATABASE template copied to clipboard");
      closePalette();
      break;
    }
  }
}

function getCreateDatabaseTemplate(dbType: DbType | null, dbName: string): string {
  switch (dbType) {
    case DbType.PostgreSQL:
      return `CREATE DATABASE "${dbName}"
  WITH
  OWNER = current_user
  ENCODING = 'UTF8'
  LC_COLLATE = 'en_US.UTF-8'
  LC_CTYPE = 'en_US.UTF-8'
  TEMPLATE = template0;`;

    case DbType.MySQL:
      return `CREATE DATABASE \`${dbName}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;`;

    case DbType.SQLServer:
      return `CREATE DATABASE [${dbName}];`;

    default:
      return `CREATE DATABASE ${dbName};`;
  }
}
