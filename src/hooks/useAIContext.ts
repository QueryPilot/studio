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
import {
  COMMAND_META,
  type AiCommandName,
  type CommandApprovalLevel,
} from "@/types/aiCommands";

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
 *
 * @param ref - The mention reference parsed from user input
 * @param context - The AI context with all connections
 * @returns Connection ID and schema if found, null otherwise
 */
export function findConnectionForMention(
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
    } else {
      // Redis: Search key patterns
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
 * Find connection from @ mentions in a message text.
 * Parses mentions from the text and returns the first matching connection.
 *
 * @param messageText - Text potentially containing @ mentions (e.g., "@users" or "@public.users")
 * @param context - The AI context with all connections
 * @returns Connection info if a mention matches a known table/view, null otherwise
 */
export function findConnectionFromMentions(
  messageText: string,
  context: AIContext
): { connectionId: string; connectionName: string; schema: string } | null {
  const mentions = parseMentions(messageText);

  for (const mention of mentions) {
    // Skip tab mentions
    if (mention.type === "tab") continue;

    const match = findConnectionForMention(mention, context);
    if (match) {
      // Find the connection name
      const conn = context.connections.find((c) => c.id === match.connectionId);
      return {
        connectionId: match.connectionId,
        connectionName: conn?.name ?? "Unknown",
        schema: match.schema,
      };
    }
  }

  return null;
}

// ============================================================================
// Command Parameter Schema Registry
// ============================================================================

interface ParamSchema {
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

interface CommandSchema {
  params: Record<string, ParamSchema>;
  example: Record<string, unknown>;
  guidelines: string;
}

/**
 * Complete parameter schemas for all AI commands.
 * Used to generate documentation for the AI system prompt.
 *
 * Note: Read commands (sql.execute, mongodb.find, redis.get, etc.) have been removed.
 * The AI agent should use MCP tools for database reads instead.
 */
const COMMAND_SCHEMAS: Record<AiCommandName, CommandSchema> = {
  // Universal Commands
  "crud.stage": {
    params: {
      connectionId: { type: "string", required: true, description: "Connection ID from context" },
      database: { type: "string", required: false, description: "Database name" },
      schema: { type: "string", required: false, description: "Schema name (SQL only)" },
      table: { type: "string", required: false, description: "Table name (SQL databases)" },
      collection: { type: "string", required: false, description: "Collection name (MongoDB)" },
      operation: { type: '"insert" | "update" | "delete"', required: true, description: "Type of mutation" },
      document: { type: "object", required: false, description: "Document to insert (for insert)" },
      filter: { type: "object", required: false, description: "Filter for update/delete" },
      update: { type: "object", required: false, description: "Update document (for update)" },
      primaryKeys: { type: "object", required: false, description: "Primary key values (for delete)" },
      description: { type: "string", required: false, description: "Human-readable description of the change" },
    },
    example: {
      connectionId: "conn-123",
      table: "users",
      operation: "insert",
      document: { name: "John", email: "john@example.com" },
      description: "Add new user John",
    },
    guidelines: "Changes are STAGED, not executed. User must review and commit from Changes panel.",
  },
  "tab.update": {
    params: {
      tabId: { type: "string", required: false, description: "Tab ID (defaults to active tab)" },
      content: { type: "string", required: false, description: "New content for the editor" },
      title: { type: "string", required: false, description: "New tab title" },
    },
    example: {
      content: "SELECT * FROM users WHERE created_at > NOW() - INTERVAL '7 days'",
    },
    guidelines: "Updates the current active tab by default. Use to modify SQL queries.",
  },
  "tab.create": {
    params: {
      connectionId: { type: "string", required: true, description: "Connection ID from context" },
      type: { type: '"query"', required: true, description: "Tab type (currently only query)" },
      title: { type: "string", required: false, description: "Tab title" },
      content: { type: "string", required: false, description: "Initial content" },
    },
    example: {
      connectionId: "conn-123",
      type: "query",
      title: "User Analysis",
      content: "SELECT COUNT(*) FROM users GROUP BY status",
    },
    guidelines: "Creates a new query tab associated with the specified connection.",
  },
  "editor.insert": {
    params: {
      text: { type: "string", required: true, description: "Text to insert" },
      position: { type: '"cursor" | "end" | "replace"', required: false, description: "Where to insert", default: '"cursor"' },
    },
    example: {
      text: "WHERE status = 'active'",
      position: "cursor",
    },
    guidelines: "Insert snippets at cursor, append to end, or replace entire content.",
  },
  "tab.focus": {
    params: {
      tabId: { type: "string", required: true, description: "Tab ID to focus" },
    },
    example: {
      tabId: "tab-123",
    },
    guidelines: "Switches to the specified tab. Use to navigate between open tabs.",
  },
  "crud.unstage": {
    params: {
      scope: { type: '"id" | "table" | "all"', required: true, description: "Scope of unstaging" },
      commandId: { type: "string", required: false, description: "Command ID to unstage (when scope = id)" },
      table: { type: "string", required: false, description: "Table name to unstage all commands for (when scope = table)" },
      connectionId: { type: "string", required: false, description: "Filter by connection ID" },
    },
    example: {
      scope: "id",
      commandId: "cmd-abc123",
    },
    guidelines: "Removes staged CRUD changes. Use 'id' to unstage a specific command, 'table' to unstage all commands for a table, or 'all' to clear all staged changes.",
  },
  "query.run": {
    params: {
      connectionId: { type: "string", required: true, description: "Connection ID from context" },
      query: { type: "string", required: true, description: "Query to execute" },
      title: { type: "string", required: false, description: "Result panel title" },
      database: { type: "string", required: false, description: "Database name" },
      schema: { type: "string", required: false, description: "Schema name" },
    },
    example: {
      connectionId: "conn-123",
      query: "SELECT * FROM users WHERE active = true LIMIT 10",
      title: "Active Users",
    },
    guidelines: "Executes a query and displays results in a new tab. Use for showing query results directly.",
  },
};

/**
 * Generate documentation for a single command from COMMAND_META and COMMAND_SCHEMAS.
 */
function generateCommandDoc(name: AiCommandName): string {
  const meta = COMMAND_META[name];
  const schema = COMMAND_SCHEMAS[name];

  // Build parameters table
  const paramLines = Object.entries(schema.params).map(([paramName, param]) => {
    const reqStr = param.required ? "required" : `optional${param.default ? `, default: ${param.default}` : ""}`;
    return `  - \`${paramName}\` (${param.type}, ${reqStr}): ${param.description}`;
  });

  // Approval level description
  const approvalDesc = getApprovalLevelDescription(meta.approvalLevel);

  return `### ${name}

**${meta.description}** | Approval: ${meta.approvalLevel} (${approvalDesc})

Parameters:
${paramLines.join("\n")}

Example:
\`\`\`
<command name="${name}">
${JSON.stringify(schema.example, null, 2)}
</command>
\`\`\`

> ${schema.guidelines}`;
}

/**
 * Get human-readable description for approval level.
 */
function getApprovalLevelDescription(level: CommandApprovalLevel): string {
  switch (level) {
    case "auto":
      return "executes automatically";
    case "approve":
      return "requires user approval";
    case "dangerous":
      return "requires explicit confirmation";
  }
}

/**
 * Generate complete command documentation from COMMAND_META registry.
 * Groups commands by paradigm and includes approval level info.
 */
function generateCommandDocumentation(): string {
  const commandNames = Object.keys(COMMAND_META) as AiCommandName[];

  // Group by paradigm
  const byParadigm = {
    sql: commandNames.filter((n) => COMMAND_META[n].paradigm === "sql"),
    document: commandNames.filter((n) => COMMAND_META[n].paradigm === "document"),
    keyvalue: commandNames.filter((n) => COMMAND_META[n].paradigm === "keyvalue"),
    universal: commandNames.filter((n) => COMMAND_META[n].paradigm === "universal"),
  };

  const sections: string[] = [];

  // Approval level legend
  sections.push(`## Command Approval Levels

Commands have different approval levels:
- **auto**: Executes immediately without user confirmation (read-only operations)
- **approve**: Requires user to click "Run" button before execution
- **dangerous**: Requires explicit confirmation with warning dialog

Always check the approval level to understand if user interaction is needed.`);

  // SQL commands
  if (byParadigm.sql.length > 0) {
    sections.push(`## SQL Commands (PostgreSQL, MySQL, SQLite, MSSQL)

Use these commands when the connection paradigm is "sql".

${byParadigm.sql.map(generateCommandDoc).join("\n\n---\n\n")}`);
  }

  // MongoDB commands
  if (byParadigm.document.length > 0) {
    sections.push(`## MongoDB Commands

Use these commands when the connection paradigm is "document".

${byParadigm.document.map(generateCommandDoc).join("\n\n---\n\n")}`);
  }

  // Redis commands
  if (byParadigm.keyvalue.length > 0) {
    sections.push(`## Redis Commands

Use these commands when the connection paradigm is "keyvalue".

${byParadigm.keyvalue.map(generateCommandDoc).join("\n\n---\n\n")}`);
  }

  // Universal commands
  if (byParadigm.universal.length > 0) {
    sections.push(`## Universal Commands (All Databases)

These commands work with any database type.

${byParadigm.universal.map(generateCommandDoc).join("\n\n---\n\n")}`);
  }

  // Command summary table
  const summaryRows = commandNames.map((name) => {
    const meta = COMMAND_META[name];
    return `| ${name} | ${meta.paradigm} | ${meta.approvalLevel} | ${meta.description} |`;
  });

  sections.push(`## Command Quick Reference

| Command | Paradigm | Approval | Description |
|---------|----------|----------|-------------|
${summaryRows.join("\n")}`);

  return sections.join("\n\n");
}

/**
 * System instructions for the AI agent in QueryPilot context.
 * Defines capabilities and restrictions for database IDE assistance.
 * Command documentation is generated dynamically from COMMAND_META.
 */
const QUERYPILOT_SYSTEM_INSTRUCTIONS = `
# QueryPilot Database IDE - AI Assistant

You are assisting a user in QueryPilot, a database IDE that supports:
- **SQL databases**: PostgreSQL, MySQL, SQLite, MSSQL
- **Document databases**: MongoDB
- **Key-value stores**: Redis

## Your Capabilities

1. **Read database data** - Use MCP tools (query_database, list_tables, describe_table) to query databases
2. **Read database schema** - Use the provided context to understand tables, collections, keys
3. **Stage mutations** - Output commands to stage INSERT/UPDATE/DELETE (user must review and commit)
4. **Modify tabs** - Update SQL in editor tabs or create new tabs

## IMPORTANT: Use MCP Tools for Database Reads

**DO NOT use structured commands for reading data.** Instead, use MCP tools:

- \`query_database\` - Execute SQL queries, MongoDB queries, or Redis commands
- \`list_tables\` - List tables/collections in a database
- \`describe_table\` - Get column info for a table
- \`list_connections\` - Get available database connections
- \`get_query_history\` - See recent queries the user executed
- \`get_current_context\` - See what the user is currently working on
- \`get_execution_plan\` - Get EXPLAIN output for query optimization

## Command Format (for mutations and UI actions only)

To stage mutations or modify tabs, output command blocks:

\`\`\`
<command name="command.name">
{
  "param1": "value1",
  "param2": "value2"
}
</command>
\`\`\`

The JSON must be valid. Commands will be parsed and displayed to the user for approval.

## Important Rules

1. **Use MCP tools for reads** - DO NOT output sql.execute, mongodb.find, or redis.get commands
2. **Use commands for mutations** - Use crud.stage to stage INSERT/UPDATE/DELETE changes
3. **Use commands for UI** - Use tab.update, tab.create, editor.insert to modify the editor
4. **Always use connectionId from context** - Look at the \`connections\` array

`.trim();

/**
 * Build the complete system prompt with dynamically generated command documentation.
 */
function buildSystemPrompt(): string {
  return `${QUERYPILOT_SYSTEM_INSTRUCTIONS}

${generateCommandDocumentation()}

## Schema Context

Below you'll find the database context with:
- All connected databases with their connectionId, type, and paradigm
- SQL: schemas, tables, views, functions
- MongoDB: collections with sample fields and indexes
- Redis: key patterns with counts and types
- If the user used @ mentions, detailed column/field info is included`;
}

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

  // Combine system prompt (with generated command docs) and database context
  return `${buildSystemPrompt()}

## Database Context

\`\`\`json
${JSON.stringify(schemaContext, null, 2)}
\`\`\``;
}
