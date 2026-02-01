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
import type {
  AIContext,
  AIConnectionContext,
  AIMention,
  TableMention,
  MentionReference,
} from "@/types/aiContext";
import { parseMentions } from "@/utils/mentionParser";

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
 * Enrich @ mentions in the user's message with full table/view details.
 * Parses mentions from the text and fetches column info from schema cache.
 *
 * @param messageText - The user's message containing @ mentions
 * @param context - The current AI context with connection info
 * @returns Promise resolving to enriched mentions array
 */
export async function enrichMentionsFromMessage(
  messageText: string,
  context: AIContext
): Promise<AIMention[]> {
  const parsed = parseMentions(messageText);
  if (parsed.length === 0) return [];

  const enrichedMentions: AIMention[] = [];

  for (const ref of parsed) {
    // Skip tab mentions for now (they don't need column info)
    if (ref.type === "tab") continue;

    // Find which connection this table belongs to
    const matchingConn = findConnectionForMention(ref, context);
    if (!matchingConn) continue;

    try {
      // Ensure connection is ready
      await databaseService.connectById(matchingConn.connectionId);
      schemaCache.setConnection(matchingConn.connectionId);

      // Fetch column details
      const columns = await schemaCache.getTableColumns(
        matchingConn.connectionId,
        matchingConn.schema,
        ref.name
      );

      // Build enriched mention
      const tableMention: TableMention = {
        type: "table",
        name: ref.name,
        schema: matchingConn.schema,
        connectionId: matchingConn.connectionId,
        columns: columns.map((c) => ({
          name: c.name,
          dataType: c.db_type,
          nullable: c.nullable,
          defaultValue: c.default ?? undefined,
          isPrimaryKey: c.is_pk,
          isUnique: false, // Not directly available in ColumnMeta
          comment: c.comment ?? undefined,
        })),
        indexes: [], // TODO: fetch indexes if needed
        triggers: [],
        foreignKeys: [],
        constraints: [],
      };

      enrichedMentions.push(tableMention);
    } catch (error) {
      console.warn(`Failed to enrich mention @${ref.schema ? ref.schema + "." : ""}${ref.name}:`, error);
    }
  }

  return enrichedMentions;
}

/**
 * Find which connection a mentioned table belongs to.
 * Matches by schema.table or just table name against available schemas.
 */
function findConnectionForMention(
  ref: MentionReference,
  context: AIContext
): { connectionId: string; schema: string } | null {
  // If schema is specified in the mention, look for exact match
  if (ref.schema) {
    for (const conn of context.connections) {
      const schema = conn.schemas.find(
        (s) =>
          s.name === ref.schema &&
          (s.tables.includes(ref.name) || s.views.includes(ref.name))
      );
      if (schema) {
        return { connectionId: conn.id, schema: schema.name };
      }
    }
  }

  // No schema specified - search all connections/schemas
  // Prefer focused connection if it has the table
  const focusedConn = context.connections.find(
    (c) => c.id === context.focusedConnectionId
  );

  if (focusedConn) {
    for (const schema of focusedConn.schemas) {
      if (schema.tables.includes(ref.name) || schema.views.includes(ref.name)) {
        return { connectionId: focusedConn.id, schema: schema.name };
      }
    }
  }

  // Search other connections
  for (const conn of context.connections) {
    if (conn.id === context.focusedConnectionId) continue;
    for (const schema of conn.schemas) {
      if (schema.tables.includes(ref.name) || schema.views.includes(ref.name)) {
        return { connectionId: conn.id, schema: schema.name };
      }
    }
  }

  return null;
}

/**
 * System instructions for the AI agent in QueryPilot context.
 * Defines capabilities and restrictions for database IDE assistance.
 */
const QUERYPILOT_SYSTEM_INSTRUCTIONS = `
## Context: QueryPilot Database IDE

You are assisting a user in QueryPilot, a database IDE application. The user has connected to one or more databases and is asking for help with SQL queries, schema understanding, or data analysis.

## CRITICAL RESTRICTIONS

**DO NOT use any of these tools:**
- Bash, Terminal, Shell commands
- psql, mysql, sqlite3, mongosh, or any database CLI tools
- File system operations (Read, Write, Edit, Glob, Grep)
- Any tool that executes commands on the user's machine

**WHY:** The user's database connections are managed by QueryPilot's internal connection manager. You do NOT have direct access to their databases via terminal. Any psql/mysql commands you try to run will fail or connect to wrong databases.

## WHAT YOU SHOULD DO

1. **Generate SQL queries** - Write SQL that the user can run in QueryPilot's query editor
2. **Explain schemas** - Help users understand their database structure using the provided context
3. **Optimize queries** - Suggest performance improvements for SQL queries
4. **Answer questions** - Explain SQL concepts, best practices, and database design
5. **Debug SQL errors** - Help fix SQL syntax or logic issues

## HOW TO RESPOND

- Provide SQL queries in code blocks with the appropriate language tag (\`\`\`sql)
- Reference the actual table/column names from the provided schema context
- If you need more information about a table's structure, ask the user to use @ mentions
- Do NOT attempt to query the database yourself - provide SQL for the user to run

## SCHEMA CONTEXT FORMAT

Below you'll find the database schema context with:
- Connected databases and their types (PostgreSQL, MySQL, SQLite, etc.)
- Available schemas, tables, views, and functions
- If the user mentioned specific objects with @, detailed column/index info is included
`.trim();

/**
 * Convert AI context to JSON string for sending to AI.
 * Includes system instructions and schema context.
 */
export function serializeAIContext(context: AIContext): string {
  const schemaContext = {
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

  // Combine instructions with schema context
  return `${QUERYPILOT_SYSTEM_INSTRUCTIONS}

## Database Schema

\`\`\`json
${JSON.stringify(schemaContext, null, 2)}
\`\`\``;
}
