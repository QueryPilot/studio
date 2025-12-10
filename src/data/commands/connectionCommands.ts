import { type Command } from "@/types/command";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { databaseService } from "@/services/databaseService";
import { toast } from "sonner";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/utils/tauri";

export const connectionCommands: Command[] = [
  {
    id: "connection.disconnect",
    label: "Disconnect",
    category: "Connection",
    when: "hasActiveConnection",
    handler: async () => {
      const { connectionId } = useWorkspaceSelectionStore.getState();
      if (!connectionId) {
        toast.error("No active connection");
        return;
      }

      try {
        await databaseService.disconnect(connectionId);
        toast.success("Disconnected successfully");

        // Close the workspace window
        if (isTauri()) {
          const window = getCurrentWindow();
          await window.close();
        }
      } catch (error) {
        toast.error("Failed to disconnect", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  },
  {
    id: "connection.reconnect",
    label: "Reconnect",
    category: "Connection",
    when: "hasActiveConnection",
    handler: async () => {
      const { connectionId } = useWorkspaceSelectionStore.getState();
      const connectionStore = useConnectionStore.getState();

      if (!connectionId) {
        toast.error("No active connection");
        return;
      }

      const connection = connectionStore.getConnection(connectionId);
      if (!connection) {
        toast.error("Connection not found");
        return;
      }

      try {
        toast.loading("Reconnecting...", { id: "reconnect" });

        // Disconnect first
        await databaseService.disconnect(connectionId);

        // Then reconnect using the connection profile
        await databaseService.connect({
          id: connectionId,
          name: connection.profile.name,
          db_type: connection.profile.db_type,
          host: connection.profile.host,
          port: connection.profile.port,
          database: connection.profile.database,
          username: connection.profile.username,
          password: connection.profile.password,
          options: connection.profile.options,
        });

        toast.success("Reconnected successfully", { id: "reconnect" });
      } catch (error) {
        toast.error("Failed to reconnect", {
          id: "reconnect",
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  },
  {
    id: "connection.showInfo",
    label: "Show Connection Info",
    category: "Connection",
    when: "hasActiveConnection",
    handler: () => {
      const { connectionId } = useWorkspaceSelectionStore.getState();
      const connectionStore = useConnectionStore.getState();

      if (!connectionId) {
        toast.error("No active connection");
        return;
      }

      const connection = connectionStore.getConnection(connectionId);
      if (!connection) {
        toast.error("Connection not found");
        return;
      }

      const { profile } = connection;
      const info = [
        `Host: ${profile.host}:${profile.port}`,
        `Database: ${profile.database}`,
        `User: ${profile.username}`,
        `Type: ${profile.db_type}`,
      ].join("\n");

      toast.info("Connection Info", {
        description: info,
        duration: 10000,
      });
    },
  },
  {
    id: "connection.copyConnectionString",
    label: "Copy Connection String",
    category: "Connection",
    when: "hasActiveConnection",
    handler: async () => {
      const { connectionId } = useWorkspaceSelectionStore.getState();
      const connectionStore = useConnectionStore.getState();

      if (!connectionId) {
        toast.error("No active connection");
        return;
      }

      const connection = connectionStore.getConnection(connectionId);
      if (!connection) {
        toast.error("Connection not found");
        return;
      }

      const { profile } = connection;
      // Build connection string (without password for security)
      const dbTypeMap: Record<string, string> = {
        PostgreSQL: "postgresql",
        MySQL: "mysql",
        SQLite: "sqlite",
        SQLServer: "sqlserver",
      };
      const scheme = dbTypeMap[profile.db_type] || profile.db_type.toLowerCase();
      const connString = `${scheme}://${profile.username}@${profile.host}:${profile.port}/${profile.database}`;

      try {
        await navigator.clipboard.writeText(connString);
        toast.success("Connection string copied to clipboard");
      } catch {
        toast.error("Failed to copy to clipboard");
      }
    },
  },
];
