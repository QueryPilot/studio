import { tool } from "ai";
import { z } from "zod";
import { TAURI_API_URL } from "../config/constants";

// Common validation schemas
const connectionIdSchema = z
  .string()
  .min(1, "Connection ID is required")
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid connection ID format");

const identifierSchema = z
  .string()
  .min(1, "Identifier is required")
  .max(63, "Identifier too long")
  .regex(
    /^[a-zA-Z0-9_]+$/,
    "Identifier contains invalid characters (only alphanumeric and underscore allowed)"
  );

const databaseSchema = z.string().min(1, "Database name is required");
const schemaNameSchema = identifierSchema;
const tableSchema = identifierSchema;

// Helper to call Tauri backend via HTTP proxy
async function callTauri(command: string, args: Record<string, any>) {
  const startTime = Date.now();
  console.log(`🔧 [Tool] Calling Tauri command: ${command}`, JSON.stringify(args));

  try {
    const response = await fetch(`${TAURI_API_URL}/__tauri__/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: command,
        args,
      }),
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [Tool] ${command} failed (${response.status}) after ${elapsed}ms:`, errorText);
      throw new Error(`Tauri command failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ [Tool] ${command} succeeded in ${elapsed}ms`);
    return result;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error(`❌ [Tool] ${command} - HTTP server not reachable at ${TAURI_API_URL} (${elapsed}ms)`);
      throw new Error(`Cannot reach Tauri HTTP server at ${TAURI_API_URL}. Is the app running?`);
    }
    throw error;
  }
}

// Core Tools
export const list_tables = tool({
  description:
    "Get all tables in a database schema. Use this to discover what tables are available.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    schema: schemaNameSchema.describe(
      'The schema name (e.g., "public" for PostgreSQL)'
    ),
  }),
  execute: async ({ connectionId, schema }) => {
    try {
      const result = await callTauri("get_tables", {
        conn_id: connectionId,
        schema,
      });
      return {
        success: true,
        tables: result.map((t: any) => ({
          name: t.name,
          schema: t.schema,
          rowCount: t.row_count,
          size: t.size,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

export const get_table_structure = tool({
  description:
    "Get detailed structure of a table including columns, data types, constraints, and keys.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    schema: schemaNameSchema.describe("The schema name"),
    table: tableSchema.describe("The table name"),
  }),
  execute: async ({ connectionId, schema, table }) => {
    try {
      const [columns, constraints] = await Promise.all([
        callTauri("get_columns", { conn_id: connectionId, schema, table }),
        callTauri("get_constraints", { conn_id: connectionId, table }),
      ]);

      return {
        success: true,
        table,
        schema,
        columns: columns.map((c: any) => ({
          name: c.name,
          dataType: c.db_type,
          nullable: c.nullable,
          primaryKey: c.primary_key,
          defaultValue: c.default_value,
        })),
        constraints: constraints.map((c: any) => ({
          name: c.name,
          type: c.constraint_type,
          definition: c.definition,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

export const get_sample_data = tool({
  description:
    "Get sample rows from a table (up to 10 rows). Useful for understanding the data structure.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    schema: schemaNameSchema.describe("The schema name"),
    table: tableSchema.describe("The table name"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe("Number of rows to fetch (max 100)"),
  }),
  execute: async ({ connectionId, schema, table, limit }) => {
    try {
      // Use backend to safely construct and execute query
      const rows = await callTauri("get_sample_data", {
        conn_id: connectionId,
        schema,
        table,
        limit: Math.min(limit, 100),
      });

      return {
        success: true,
        rows,
        rowCount: rows.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

export const execute_readonly_query = tool({
  description:
    "Execute a read-only SQL query (SELECT only). Use this to query data from the database.",
  inputSchema: z.object({
    connectionId: z
      .string()
      .min(1, "Connection ID is required")
      .regex(/^[a-zA-Z0-9_-]+$/, "Invalid connection ID format"),
    sql: z
      .string()
      .optional()
      .describe("The SQL query to execute (must be a SELECT statement)"),
    query: z
      .string()
      .optional()
      .describe("Alias for the SQL query to execute"),
    schema: z
      .string()
      .optional()
      .describe("Optional schema context for the query"),
    database: z
      .string()
      .optional()
      .describe("Optional database context for the query"),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .optional()
      .default(100)
      .describe("Maximum rows to return"),
  }),
  execute: async ({ connectionId, sql, query, limit }) => {
    const rawSql = sql ?? query;
    if (!rawSql || rawSql.trim().length === 0) {
      return {
        success: false,
        error:
          "No SQL provided. Please supply either the `sql` or `query` parameter with a SELECT statement.",
        errorCode: "MISSING_QUERY",
      };
    }

    // Validate that it's a SELECT or WITH query
    const trimmedSql = rawSql.trim().toLowerCase();
    if (!trimmedSql.startsWith("select") && !trimmedSql.startsWith("with")) {
      return {
        success: false,
        error:
          "Only SELECT or WITH (CTE) queries are allowed for safety reasons",
        errorCode: "INVALID_QUERY_TYPE",
      };
    }

    // Block dangerous keywords
    const dangerous = [
      "insert",
      "update",
      "delete",
      "drop",
      "create",
      "alter",
      "truncate",
      "grant",
      "revoke",
    ];
    const foundDangerous = dangerous.find((kw) => trimmedSql.includes(kw));
    if (foundDangerous) {
      return {
        success: false,
        error: `Query contains forbidden keyword: ${foundDangerous.toUpperCase()}`,
        errorCode: "FORBIDDEN_KEYWORD",
      };
    }

    try {
      // Add LIMIT if not present
      const finalSql = trimmedSql.includes("limit")
        ? rawSql
        : `${rawSql} LIMIT ${limit}`;

      const rows = await callTauri("execute_query", {
        conn_id: connectionId,
        sql: finalSql,
      });

      return {
        success: true,
        rows,
        rowCount: rows.length,
        query: finalSql,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

// Extended Tools
export const get_indexes = tool({
  description: "Get all indexes for a table, including index type and columns.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    table: tableSchema.describe("The table name"),
  }),
  execute: async ({ connectionId, table }) => {
    try {
      const result = await callTauri("get_indexes", {
        conn_id: connectionId,
        table,
      });
      return {
        success: true,
        indexes: result.map((idx: any) => ({
          name: idx.name,
          columns: idx.columns,
          unique: idx.is_unique,
          primary: idx.is_primary,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

export const get_triggers = tool({
  description: "Get all triggers defined on a table.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    schema: schemaNameSchema.describe("The schema name"),
    table: tableSchema.describe("The table name"),
  }),
  execute: async ({ connectionId, schema, table }) => {
    try {
      const result = await callTauri("get_triggers", {
        conn_id: connectionId,
        schema,
        table,
      });
      return {
        success: true,
        triggers: result.map((t: any) => ({
          name: t.name,
          event: t.event,
          timing: t.timing,
          enabled: t.enabled,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

export const get_foreign_keys = tool({
  description: "Get foreign key relationships for a table.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    table: tableSchema.describe("The table name"),
  }),
  execute: async ({ connectionId, table }) => {
    try {
      const constraints = await callTauri("get_constraints", {
        conn_id: connectionId,
        table,
      });

      const foreignKeys = constraints.filter(
        (c: any) =>
          c.constraint_type === "ForeignKey" ||
          c.constraint_type === "FOREIGN KEY",
      );

      return {
        success: true,
        foreignKeys: foreignKeys.map((fk: any) => ({
          name: fk.name,
          definition: fk.definition,
          foreignTable: fk.foreign_table,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

export const get_table_statistics = tool({
  description: "Get statistics about a table (row count, size, etc.).",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    schema: schemaNameSchema.describe("The schema name"),
    table: tableSchema.optional().describe("The table name"),
    table_name: z.string().optional().describe("Alias for table name"),
  }),
  execute: async ({ connectionId, schema, table, table_name }) => {
    const tableName = table || table_name;
    if (!tableName) {
      return {
        success: false,
        error: "Table name is required (use 'table' parameter)",
        errorCode: "MISSING_TABLE",
      };
    }

    try {
      const count = await callTauri("get_table_count", {
        conn_id: connectionId,
        schema,
        table: tableName,
      });

      return {
        success: true,
        statistics: {
          rowCount: count,
          schema,
          table: tableName,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

// Full Suite Tools
export const get_views = tool({
  description: "Get all views in a schema.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    schema: schemaNameSchema.describe("The schema name"),
  }),
  execute: async ({ connectionId, schema }) => {
    try {
      const result = await callTauri("get_views", {
        conn_id: connectionId,
        schema,
      });
      return {
        success: true,
        views: result.map((v: any) => ({
          name: v.name,
          schema: v.schema,
          definition: v.definition,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

export const get_functions = tool({
  description: "Get all functions/stored procedures in a schema.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    schema: schemaNameSchema.describe("The schema name"),
  }),
  execute: async ({ connectionId, schema }) => {
    try {
      const result = await callTauri("get_functions", {
        conn_id: connectionId,
        schema,
      });
      return {
        success: true,
        functions: result.map((f: any) => ({
          name: f.name,
          schema: f.schema,
          returnType: f.return_type,
          language: f.language,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

export const list_schemas = tool({
  description: "Get all schemas in the database.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    database: databaseSchema.describe("The database name"),
  }),
  execute: async ({ connectionId, database }) => {
    try {
      const result = await callTauri("get_schemas", {
        conn_id: connectionId,
        database,
      });
      return {
        success: true,
        schemas: result.map((s: any) => ({
          name: s.name,
          owner: s.owner,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

export const get_object_definition = tool({
  description:
    "Get the SQL definition of a database object (table, view, function, etc.).",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    database: databaseSchema.describe("The database name"),
    schema: schemaNameSchema.describe("The schema name"),
    objectName: identifierSchema.describe("The object name"),
    objectType: z
      .string()
      .min(1)
      .describe("The object type (table, view, function, etc.)"),
  }),
  execute: async ({
    connectionId,
    database,
    schema,
    objectName,
    objectType,
  }) => {
    try {
      const result = await callTauri("get_object_definition", {
        conn_id: connectionId,
        database,
        schema,
        object_name: objectName,
        object_type: objectType,
      });
      return {
        success: true,
        definition: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "QUERY_FAILED",
      };
    }
  },
});

export const explain_query = tool({
  description:
    "Get query execution plan (EXPLAIN) for performance analysis. Helps understand how PostgreSQL will execute a query.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    sql: z
      .string()
      .min(1, "SQL query is required")
      .describe("The SELECT query to explain"),
    analyze: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Use EXPLAIN ANALYZE to get actual execution stats (runs the query)"
      ),
  }),
  execute: async ({ connectionId, sql, analyze }) => {
    // Validate SELECT query
    const trimmed = sql.trim().toLowerCase();
    if (!trimmed.startsWith("select") && !trimmed.startsWith("with")) {
      return {
        success: false,
        error: "Only SELECT or WITH queries can be explained",
        errorCode: "INVALID_QUERY_TYPE",
      };
    }

    try {
      const explainSql = analyze
        ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`
        : `EXPLAIN (FORMAT JSON) ${sql}`;

      const rows = await callTauri("execute_query", {
        conn_id: connectionId,
        sql: explainSql,
      });

      return {
        success: true,
        plan: rows[0]?.[0], // EXPLAIN JSON returns plan in first column
        analyzed: analyze,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "EXPLAIN_FAILED",
      };
    }
  },
});

export const get_relationship_graph = tool({
  description:
    "Get relationship graph between tables via foreign keys. Shows how tables are connected in the database schema.",
  inputSchema: z.object({
    connectionId: connectionIdSchema.describe("The database connection ID"),
    schema: schemaNameSchema.describe("The schema name"),
    depth: z
      .number()
      .min(1)
      .max(3)
      .optional()
      .default(2)
      .describe("How many levels of relationships to traverse (1-3)"),
  }),
  execute: async ({ connectionId, schema, depth }) => {
    try {
      // Get all tables in schema
      const tables = await callTauri("get_tables", {
        conn_id: connectionId,
        schema,
      });

      // Build relationship graph
      const graph: Record<
        string,
        Array<{ to: string; via: string; type: string }>
      > = {};

      // Get foreign keys for each table
      for (const table of tables) {
        const tableName = table.name;
        graph[tableName] = [];

        const constraints = await callTauri("get_constraints", {
          conn_id: connectionId,
          table: tableName,
        });

        const foreignKeys = constraints.filter(
          (c: any) =>
            c.constraint_type === "ForeignKey" ||
            c.constraint_type === "FOREIGN KEY"
        );

        for (const fk of foreignKeys) {
          if (fk.foreign_table) {
            graph[tableName].push({
              to: fk.foreign_table,
              via: fk.name,
              type: "foreign_key",
            });
          }
        }
      }

      // Count relationships
      const stats = {
        totalTables: tables.length,
        totalRelationships: Object.values(graph).reduce(
          (sum, rels) => sum + rels.length,
          0
        ),
        tablesWithRelationships: Object.values(graph).filter(
          (rels) => rels.length > 0
        ).length,
      };

      return {
        success: true,
        graph,
        stats,
        depth,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "GRAPH_FAILED",
      };
    }
  },
});

// Export all tools as a record for AI SDK
export const tools = {
  list_tables,
  get_table_structure,
  get_sample_data,
  execute_readonly_query,
  get_indexes,
  get_triggers,
  get_foreign_keys,
  get_table_statistics,
  get_views,
  get_functions,
  list_schemas,
  get_object_definition,
  explain_query,
  get_relationship_graph,
};
