/**
 * useAIContext Hook
 *
 * Builds lightweight AI context for the current workspace.
 * Provides connection info + schema/table names without full column details.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { schemaCache } from "@/services/schemaCache";
import { databaseService } from "@/services/databaseService";
import type { AIContext, AIConnectionContext } from "@/types/aiContext";

/**
 * Build lightweight AI context for all connections in the workspace.
 * Returns connection info + table/view/function names (not full column details).
 */
export function useAIContext(): AIContext {
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const connections = useConnectionStore((s) => s.connections);
  const focusedConnectionId = activeWorkspace?.focusedConnectionId ?? null;

  // Get open connections from workspace
  const openConnections = useMemo(() => {
    if (!activeWorkspace) return [];
    return Array.from(activeWorkspace.connections.entries());
  }, [activeWorkspace]);

  // Build connection contexts
  const connectionContexts = useMemo((): AIConnectionContext[] => {
    return openConnections.map(([connectionId, openConn]) => {
      // Get stored connection profile for name and dbType
      const storedConn = connections.find((c) => c.profile.id === connectionId);
      const profile = storedConn?.profile;

      return {
        id: connectionId,
        name: profile?.name ?? "Unknown",
        dbType: profile?.db_type ?? "Unknown",
        database: openConn.database,
        // Schemas will be populated by useAIContextWithSchema
        schemas: [],
      };
    });
  }, [openConnections, connections]);

  return {
    connections: connectionContexts,
    focusedConnectionId,
    mentions: [], // Populated when user adds @ mentions
  };
}

/**
 * Build AI context with schema data for ALL connections in workspace.
 * Includes table/view/function names for each connection's current schema.
 */
export function useAIContextWithSchema(): AIContext {
  const baseContext = useAIContext();
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);

  // Get all open connections with their schema info
  const openConnections = useMemo(() => {
    if (!activeWorkspace) return [];
    return Array.from(activeWorkspace.connections.entries()).map(
      ([id, conn]) => ({
        id,
        database: conn.database,
        schema: conn.schema || "public",
      })
    );
  }, [activeWorkspace]);

  // Load schema data for ALL connections in parallel using useQueries
  const schemaQueries = useQueries({
    queries: openConnections.map((conn) => ({
      queryKey: ["ai-schema", conn.id, conn.database, conn.schema],
      queryFn: async () => {
        // Ensure connection is established
        await databaseService.connectById(conn.id);
        schemaCache.setConnection(conn.id);

        // Load tables and functions
        const [tables, functions] = await Promise.all([
          schemaCache.getTables(conn.id, conn.schema),
          schemaCache.getFunctions(conn.id, conn.schema),
        ]);

        return {
          connectionId: conn.id,
          schema: conn.schema,
          tables: tables.filter((t) => t.kind === "Table").map((t) => t.name),
          views: tables
            .filter((t) => t.kind === "View" || t.kind === "MaterializedView")
            .map((t) => t.name),
          functions: functions.map((f) => f.name),
        };
      },
      enabled: !!conn.id && !!conn.database && !!conn.schema,
      staleTime: 5 * 60 * 1000, // 5 minutes
    })),
  });

  // Merge schema data into connection contexts
  const connectionsWithSchema = useMemo((): AIConnectionContext[] => {
    return baseContext.connections.map((conn) => {
      // Find the schema query result for this connection
      const queryResult = schemaQueries.find(
        (q) => q.data?.connectionId === conn.id
      );

      if (queryResult?.data) {
        const data = queryResult.data;
        return {
          ...conn,
          schemas: [
            {
              name: data.schema,
              tables: data.tables,
              views: data.views,
              functions: data.functions,
            },
          ],
        };
      }

      return conn;
    });
  }, [baseContext.connections, schemaQueries]);

  return {
    ...baseContext,
    connections: connectionsWithSchema,
  };
}

/**
 * Convert AI context to JSON string for sending to AI.
 * Produces a compact representation suitable for LLM consumption.
 */
export function serializeAIContext(context: AIContext): string {
  const simplified = {
    focusedConnection: context.focusedConnectionId,
    connections: context.connections.map((conn) => ({
      id: conn.id,
      name: conn.name,
      type: conn.dbType,
      database: conn.database,
      schemas: conn.schemas.map((s) => ({
        name: s.name,
        tables: s.tables,
        views: s.views,
        functions: s.functions,
      })),
    })),
    mentions: context.mentions.map((m) => {
      // Serialize based on mention type
      switch (m.type) {
        case "table":
          return {
            type: "table",
            name: `${m.schema}.${m.name}`,
            columns: m.columns.map((c) => ({
              name: c.name,
              type: c.dataType,
              nullable: c.nullable,
              pk: c.isPrimaryKey,
            })),
            indexes: m.indexes.map((i) => ({
              name: i.name,
              columns: i.columns,
              unique: i.isUnique,
            })),
            triggers: m.triggers.map((t) => t.name),
            foreignKeys: m.foreignKeys.map((fk) => ({
              columns: fk.columns,
              references: `${fk.referencedSchema ?? ""}.${fk.referencedTable}(${fk.referencedColumns.join(", ")})`,
            })),
          };
        case "view":
          return {
            type: "view",
            name: `${m.schema}.${m.name}`,
            columns: m.columns.map((c) => ({
              name: c.name,
              type: c.dataType,
            })),
            definition: m.definition,
          };
        case "function":
          return {
            type: "function",
            name: `${m.schema}.${m.name}`,
            signature: m.signature,
            returnType: m.returnType,
            parameters: m.parameters,
          };
        case "tab":
          return {
            type: "tab",
            id: m.id,
            name: m.name,
            tabType: m.tabType,
            sql: m.sql,
          };
      }
    }),
  };

  return JSON.stringify(simplified, null, 2);
}
