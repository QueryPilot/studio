import { tool } from "ai";
import { z } from "zod/v4";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useConnectionWindowStore } from "@/stores/connectionWindowStore";

export function createListConnectionsTool() {
  return tool({
    description:
      "List all available database connections with their IDs, names, types, and status. Call this first to discover which databases you can query.",
    inputSchema: z.object({}),
    execute: () => {
      const connections = useConnectionStore.getState().connections;

      if (connections.length === 0) {
        return "No database connections available. Please add a connection in Query Pilot first.";
      }

      const windowStore = useConnectionWindowStore.getState();

      let output = "Available Database Connections:\n\n";
      for (const conn of connections) {
        const hasWindows = windowStore.hasOpenWindows(conn.profile.id);
        const status = hasWindows ? "Connected" : "Disconnected";
        output += `- ${conn.profile.name} (${conn.profile.db_type})\n`;
        output += `  ID: ${conn.profile.id}\n`;
        output += `  Database: ${conn.profile.database} | Status: ${status}\n\n`;
      }
      output += `Total: ${connections.length} connection${connections.length !== 1 ? "s" : ""}`;
      output +=
        "\n\nUse the connection ID with queryDatabase, listTables, or describeTable tools.";

      return output;
    },
  });
}
