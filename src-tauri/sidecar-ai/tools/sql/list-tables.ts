/**
 * List Tables Tool
 *
 * Gets all tables in a schema using the new registry pattern.
 * Uses ai_sql_execute command for read-only introspection.
 */

import { defineTool } from "../base";

interface TableInfo {
  name: string;
  schema: string;
  kind?: string;
}

interface SqlExecuteResult {
  columns: string[];
  rows: unknown[][];
}

export default defineTool({
  name: "list_tables",
  friendlyName: "List Tables",
  description: "Get all tables in a database schema with metadata",
  category: "schema",
  icon: "table",
  capabilities: ["sql"],

  parameters: {
    schema: {
      type: "string",
      default: "public",
      description: 'The schema name (e.g., "public" for PostgreSQL)',
    },
  },

  messages: {
    pending: (input) => `Listing tables in schema "${input.schema || "public"}"...`,
    success: (input, output) => {
      const count = Array.isArray(output) ? output.length : 0;
      const schema = input.schema || "public";
      return `Found ${count} table${count === 1 ? "" : "s"} in schema "${schema}"`;
    },
    error: (input, err) => {
      const schema = input.schema || "public";
      return `Failed to list tables in schema "${schema}": ${err.message}`;
    },
  },

  async execute({ schema = "public" }, ctx, tauri) {
    // Call ai_sql_execute with list_tables operation
    const result = await tauri.invoke<SqlExecuteResult>("ai_sql_execute", {
      connId: ctx.connectionId,
      operation: {
        type: "list_tables",
        schema,
      },
    });

    // Transform rows to structured output
    const tables: TableInfo[] = result.rows.map((row) => ({
      schema: String(row[0] || schema),
      name: String(row[1] || ""),
      kind: row[2] ? String(row[2]) : undefined,
    }));

    return tables;
  },
});
