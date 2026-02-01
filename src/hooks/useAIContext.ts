/**
 * useAIContext Hook
 *
 * Builds lightweight AI context for the current workspace.
 * Provides connection info + schema/table names without full column details.
 * Supports SQL, MongoDB, and Redis connections.
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
import { getParadigm, type DatabaseParadigm } from "@/types/connection";

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

      // Determine paradigm from database type
      const dbType = profile?.db_type;
      const paradigm: DatabaseParadigm = dbType
        ? getParadigm(dbType)
        : "sql"; // Default to SQL for unknown types

      return {
        id: connectionId,
        name: profile?.name ?? "Unknown",
        dbType: profile?.db_type ?? "Unknown",
        database: openConn.database,
        paradigm,
        // Schemas will be populated by useAIContextWithSchema
        schemas: [],
        // NoSQL fields will be populated by useAIContextWithSchema
        collections: undefined,
        keyPatterns: undefined,
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
 * Supports SQL (schemas), MongoDB (collections), and Redis (key patterns).
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
  // Query function adapts based on paradigm
  const schemaQueries = useQueries({
    queries: openConnections.map((conn) => {
      // Find the paradigm for this connection
      const connContext = baseContext.connections.find((c) => c.id === conn.id);
      const paradigm = connContext?.paradigm ?? "sql";

      return {
        queryKey: ["ai-schema", conn.id, conn.database, conn.schema, paradigm],
        queryFn: async () => {
          // Ensure connection is established
          await databaseService.connectById(conn.id);
          schemaCache.setConnection(conn.id);

          // Load data based on paradigm
          if (paradigm === "document") {
            // MongoDB: load collections
            const collections = await schemaCache.getMongoCollections(
              conn.id,
              conn.database,
            );
            return {
              connectionId: conn.id,
              paradigm: "document" as const,
              collections,
            };
          } else if (paradigm === "keyvalue") {
            // Redis: load key patterns
            const keyPatterns = await schemaCache.getRedisKeyPatterns(conn.id);
            return {
              connectionId: conn.id,
              paradigm: "keyvalue" as const,
              keyPatterns,
            };
          } else {
            // SQL: load tables and functions
            const [tables, functions] = await Promise.all([
              schemaCache.getTables(conn.id, conn.schema),
              schemaCache.getFunctions(conn.id, conn.schema),
            ]);

            return {
              connectionId: conn.id,
              paradigm: "sql" as const,
              schema: conn.schema,
              tables: tables.filter((t) => t.kind === "Table").map((t) => t.name),
              views: tables
                .filter((t) => t.kind === "View" || t.kind === "MaterializedView")
                .map((t) => t.name),
              functions: functions.map((f) => f.name),
            };
          }
        },
        enabled: !!conn.id && !!conn.database,
        staleTime: 5 * 60 * 1000, // 5 minutes
      };
    }),
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

        if (data.paradigm === "document") {
          // MongoDB connection
          return {
            ...conn,
            collections: data.collections,
          };
        } else if (data.paradigm === "keyvalue") {
          // Redis connection
          return {
            ...conn,
            keyPatterns: data.keyPatterns,
          };
        } else {
          // SQL connection
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
 * Find which connection a mentioned table/collection belongs to.
 * Supports all database paradigms: SQL (tables/views), MongoDB (collections), Redis (keys).
 */
function findConnectionForMention(
  ref: MentionReference,
  context: AIContext
): { connectionId: string; schema: string } | null {
  const focusedConn = context.connections.find(
    (c) => c.id === context.focusedConnectionId
  );

  // Helper to check if connection has the mentioned entity
  const hasEntity = (conn: AIConnectionContext): string | null => {
    if (conn.paradigm === "sql") {
      // Search SQL schemas for tables/views
      if (ref.schema) {
        const schema = conn.schemas.find(
          (s) =>
            s.name === ref.schema &&
            (s.tables.includes(ref.name) || s.views.includes(ref.name))
        );
        if (schema) return schema.name;
      } else {
        for (const schema of conn.schemas) {
          if (schema.tables.includes(ref.name) || schema.views.includes(ref.name)) {
            return schema.name;
          }
        }
      }
    } else if (conn.paradigm === "document") {
      // Search MongoDB collections
      if (conn.collections?.some((c) => c.name === ref.name)) {
        return ""; // MongoDB has no schema concept
      }
    } else if (conn.paradigm === "keyvalue") {
      // Search Redis key patterns
      if (conn.keyPatterns?.some((p) => p.pattern === ref.name || p.sampleKeys?.includes(ref.name))) {
        return ""; // Redis has no schema concept
      }
    }
    return null;
  };

  // Prefer focused connection
  if (focusedConn) {
    const schema = hasEntity(focusedConn);
    if (schema !== null) {
      return { connectionId: focusedConn.id, schema };
    }
  }

  // Search other connections
  for (const conn of context.connections) {
    if (conn.id === context.focusedConnectionId) continue;
    const schema = hasEntity(conn);
    if (schema !== null) {
      return { connectionId: conn.id, schema };
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

You are assisting a user in QueryPilot, a database IDE application. The user has connected to one or more databases and is asking for help with queries, schema understanding, or data analysis.

QueryPilot supports multiple database paradigms:
- **SQL databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server
- **Document databases**: MongoDB
- **Key-value stores**: Redis

## CRITICAL RESTRICTIONS

**DO NOT use any of these tools:**
- Bash, Terminal, Shell commands
- psql, mysql, sqlite3, mongosh, redis-cli, or any database CLI tools
- File system operations (Read, Write, Edit, Glob, Grep)
- Any tool that executes commands on the user's machine

**WHY:** The user's database connections are managed by QueryPilot's internal connection manager. You do NOT have direct access to their databases via terminal. Any CLI commands you try to run will fail or connect to wrong databases.

## WHAT YOU SHOULD DO

### For SQL Databases (paradigm: "sql")
1. **Generate SQL queries** - Write SQL that the user can run in QueryPilot's query editor
2. **Explain schemas** - Help users understand their database structure
3. **Optimize queries** - Suggest performance improvements
4. **Debug SQL errors** - Help fix SQL syntax or logic issues

### For MongoDB (paradigm: "document")
1. **Generate MongoDB queries** - Write find/aggregate operations
2. **Explain collections** - Help users understand document structure
3. **Design aggregation pipelines** - Build complex data transformations
4. **Index recommendations** - Suggest indexes for query optimization

### For Redis (paradigm: "keyvalue")
1. **Generate Redis commands** - Write GET/SET/SCAN operations
2. **Explain key patterns** - Help users understand data organization
3. **Data structure guidance** - Recommend appropriate Redis data types

## HOW TO RESPOND

- For SQL: Use \`\`\`sql code blocks
- For MongoDB: Use \`\`\`javascript or \`\`\`json code blocks
- For Redis: Use \`\`\`redis or plain text for commands
- Reference actual object names from the provided context
- If you need more information, ask the user to use @ mentions
- Do NOT attempt to query the database yourself - provide queries for the user to run

## DATABASE CONTEXT FORMAT

Below you'll find the database context with:
- Connected databases and their types
- For SQL: schemas, tables, views, and functions
- For MongoDB: collections with indexes and sample field names
- For Redis: key patterns with counts and data types
- If the user mentioned specific objects with @, detailed info is included
`.trim();

/**
 * Serialize a connection context based on its paradigm.
 * Returns an object with appropriate fields for SQL, MongoDB, or Redis.
 */
function serializeConnectionContext(conn: AIConnectionContext): Record<string, unknown> {
  const base = {
    id: conn.id,
    name: conn.name,
    type: conn.dbType,
    database: conn.database,
    paradigm: conn.paradigm,
  };

  if (conn.paradigm === "document") {
    // MongoDB: include collections
    return {
      ...base,
      collections: conn.collections?.map((c) => ({
        name: c.name,
        documentCount: c.documentCount,
        indexes: c.indexes,
        sampleFields: c.sampleFields,
      })) ?? [],
    };
  } else if (conn.paradigm === "keyvalue") {
    // Redis: include key patterns
    return {
      ...base,
      keyPatterns: conn.keyPatterns?.map((p) => ({
        pattern: p.pattern,
        count: p.count,
        types: p.types,
        sampleKeys: p.sampleKeys,
      })) ?? [],
    };
  } else {
    // SQL: include schemas
    return {
      ...base,
      schemas: conn.schemas.map((s) => ({
        name: s.name,
        tables: s.tables,
        views: s.views,
        functions: s.functions,
      })),
    };
  }
}

/**
 * Convert AI context to JSON string for sending to AI.
 * Includes system instructions and schema context.
 * Supports SQL, MongoDB, and Redis connections.
 */
export function serializeAIContext(context: AIContext): string {
  const schemaContext = {
    focusedConnection: context.focusedConnectionId,
    connections: context.connections.map(serializeConnectionContext),
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

  // Combine instructions with database context
  return `${QUERYPILOT_SYSTEM_INSTRUCTIONS}

## Database Context

\`\`\`json
${JSON.stringify(schemaContext, null, 2)}
\`\`\``;
}
