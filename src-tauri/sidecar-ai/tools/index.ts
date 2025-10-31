import { tool } from "ai";
import { z } from "zod";
import { TAURI_API_URL } from "../config/constants";

// Helper to call Tauri backend via HTTP proxy
async function callTauri(command: string, args: Record<string, any>) {
  const response = await fetch(`${TAURI_API_URL}/__tauri__/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cmd: command,
      args,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tauri command failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

// Core Tools
export const list_tables = tool({
  description:
    "Get all tables in a database schema. Use this to discover what tables are available.",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    schema: z
      .string()
      .describe('The schema name (e.g., "public" for PostgreSQL)'),
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
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    schema: z.string().describe("The schema name"),
    table: z.string().describe("The table name"),
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
      };
    }
  },
});

export const get_sample_data = tool({
  description:
    "Get sample rows from a table (up to 10 rows). Useful for understanding the data structure.",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    schema: z.string().describe("The schema name"),
    table: z.string().describe("The table name"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Number of rows to fetch (max 100)"),
  }),
  execute: async ({ connectionId, schema, table, limit }) => {
    try {
      // Use stream_query command with a simple SELECT
      const sql = `SELECT * FROM "${schema}"."${table}" LIMIT ${Math.min(
        limit,
        100,
      )}`;

      // Note: This is a simplified version. In production, we'd use the streaming API
      // For now, we'll return a placeholder
      return {
        success: true,
        message: `Would execute: ${sql}`,
        note: "Full implementation requires streaming query support",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

export const execute_readonly_query = tool({
  description:
    "Execute a read-only SQL query (SELECT only). Use this to query data from the database.",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
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
      .optional()
      .default(100)
      .describe("Maximum rows to return"),
  }),
  execute: async ({ connectionId, sql, query, limit, schema, database }) => {
    const rawSql = sql ?? query;
    if (!rawSql || rawSql.trim().length === 0) {
      return {
        success: false,
        error:
          "No SQL provided. Please supply either the `sql` or `query` parameter with a SELECT statement.",
      };
    }

    // Validate that it's a SELECT query
    const trimmedSql = rawSql.trim().toLowerCase();
    if (!trimmedSql.startsWith("select")) {
      return {
        success: false,
        error: "Only SELECT queries are allowed for safety reasons",
      };
    }

    try {
      // Add LIMIT if not present
      const finalSql = trimmedSql.includes("limit")
        ? rawSql
        : `${rawSql} LIMIT ${limit}`;

      return {
        success: true,
        message: `Would execute: ${finalSql}`,
        note: "Full implementation requires streaming query support",
        context: {
          connectionId,
          schema,
          database,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Extended Tools
export const get_indexes = tool({
  description: "Get all indexes for a table, including index type and columns.",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    table: z.string().describe("The table name"),
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
      };
    }
  },
});

export const get_triggers = tool({
  description: "Get all triggers defined on a table.",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    schema: z.string().describe("The schema name"),
    table: z.string().describe("The table name"),
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
      };
    }
  },
});

export const get_foreign_keys = tool({
  description: "Get foreign key relationships for a table.",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    table: z.string().describe("The table name"),
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
      };
    }
  },
});

export const get_table_statistics = tool({
  description: "Get statistics about a table (row count, size, etc.).",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    schema: z.string().describe("The schema name"),
    table: z.string().describe("The table name"),
  }),
  execute: async ({ connectionId, schema, table }) => {
    try {
      const count = await callTauri("get_table_count", {
        conn_id: connectionId,
        schema,
        table,
      });

      return {
        success: true,
        statistics: {
          rowCount: count,
          schema,
          table,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Full Suite Tools
export const get_views = tool({
  description: "Get all views in a schema.",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    schema: z.string().describe("The schema name"),
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
      };
    }
  },
});

export const get_functions = tool({
  description: "Get all functions/stored procedures in a schema.",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    schema: z.string().describe("The schema name"),
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
      };
    }
  },
});

export const list_schemas = tool({
  description: "Get all schemas in the database.",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    database: z.string().describe("The database name"),
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
      };
    }
  },
});

export const get_object_definition = tool({
  description:
    "Get the SQL definition of a database object (table, view, function, etc.).",
  parameters: z.object({
    connectionId: z.string().describe("The database connection ID"),
    database: z.string().describe("The database name"),
    schema: z.string().describe("The schema name"),
    objectName: z.string().describe("The object name"),
    objectType: z
      .string()
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
};
