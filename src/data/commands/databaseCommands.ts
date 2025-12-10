import { type Command } from "@/types/command";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { openQueryWithTemplate, openTableDesigner, type CreateObjectType } from "@/utils/workbench/openers";
import { clearAllCaches } from "@/lib/cacheManager";
import { toast } from "sonner";

function createObjectCommand(objectType: CreateObjectType, label: string): Command {
  return {
    id: `database.create.${objectType}`,
    label: `New ${label}`,
    category: "Database",
    when: "hasActiveConnection",
    handler: () => {
      const { connectionId, database, schema } = useWorkspaceSelectionStore.getState();
      if (!connectionId) {
        toast.error("No active connection");
        return;
      }

      if (objectType === "table") {
        openTableDesigner({
          connectionId,
          database,
          schema,
        });
      } else {
        openQueryWithTemplate({
          connectionId,
          database,
          schema,
          objectType,
        });
      }
    },
  };
}

export const databaseCommands: Command[] = [
  {
    id: "database.refresh",
    label: "Refresh Schema",
    category: "Database",
    when: "hasActiveConnection",
    handler: async () => {
      await clearAllCaches();
      toast.success("Schema refreshed");
    },
  },
  {
    id: "database.showDatabases",
    label: "Show Databases",
    category: "Database",
    when: "hasActiveConnection",
    description: "Switch to a different database",
    handler: () => {
      // This will be handled by focusing the database selector dropdown
      // For now, show a toast directing users to the selector
      toast.info("Use the database selector in the sidebar header");
    },
  },
  {
    id: "database.showSchemas",
    label: "Show Schemas",
    category: "Database",
    when: "hasActiveConnection",
    description: "Switch to a different schema",
    handler: () => {
      toast.info("Use the schema selector in the sidebar header");
    },
  },
  // Create object commands
  createObjectCommand("table", "Table"),
  createObjectCommand("view", "View"),
  createObjectCommand("materializedView", "Materialized View"),
  createObjectCommand("function", "Function"),
  createObjectCommand("procedure", "Procedure"),
  createObjectCommand("trigger", "Trigger"),
  createObjectCommand("schema", "Schema"),
];
