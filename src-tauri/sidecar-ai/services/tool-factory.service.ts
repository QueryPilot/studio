/**
 * Tool Factory Service
 * Creates AI SDK tools with bound connection context, caching, and retry logic
 */

import { tool } from "ai";
import { z } from "zod";
import { TAURI_API_URL } from "../config/constants";
import { metadataCache, CacheTypes } from "../utils/cache";
import { withRetry, isTransientError } from "../utils/retry";

// Types for tool results
interface TableInfo {
  name: string;
  schema?: string;
  rowCount?: number;
  size?: string;
}

interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey?: boolean;
  defaultValue?: string;
}

interface ConstraintInfo {
  name: string;
  type: string;
  definition?: string;
  foreignTable?: string;
}

interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

interface ForeignKeyInfo {
  name: string;
  column: string;
  foreignTable: string;
  foreignColumn: string;
  definition?: string;
}

// Cache TTLs (in ms)
const CACHE_TTL = {
  TABLES: 5 * 60 * 1000, // 5 minutes
  STRUCTURE: 5 * 60 * 1000, // 5 minutes
  QUERY_RESULTS: 60 * 1000, // 1 minute for query results
};

/**
 * Helper to call Tauri backend via HTTP proxy with retry logic
 */
async function callTauri(command: string, args: Record<string, unknown>): Promise<unknown> {
  return withRetry(
    async () => {
      const response = await fetch(`${TAURI_API_URL}/__tauri__/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: command, args }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tauri command failed (${response.status}): ${errorText}`);
      }

      return response.json();
    },
    {
      maxAttempts: 3,
      initialDelayMs: 100,
      isRetryable: isTransientError,
      onRetry: (attempt, error) => {
        console.log(`🔄 [Tool] Retrying ${command} (attempt ${attempt}):`, error);
      },
    }
  );
}

/**
 * Connection context for tool factory
 */
export interface ToolContext {
  connectionId: string;
  schema: string;
}

/**
 * Create text-to-SQL specific tools with bound connection context
 * These tools are optimized for WHERE clause generation with cross-table support
 */
export function createTextToSqlTools(ctx: ToolContext) {
  const { connectionId, schema } = ctx;

  return {
    /**
     * List all tables in the current schema
     */
    list_tables: tool({
      description: "Get all tables in the current schema. Returns table names and basic stats.",
      inputSchema: z.object({}),
      execute: async () => {
        // Check cache first
        const cached = metadataCache.get<TableInfo[]>(connectionId, CacheTypes.TABLES, schema);
        if (cached) {
          console.log(`📋 [list_tables] Cache hit for ${connectionId}:${schema}`);
          return { success: true, tables: cached, fromCache: true };
        }

        try {
          const result = (await callTauri("get_tables", {
            conn_id: connectionId,
            schema,
          })) as Array<{ name: string; schema?: string; row_count?: number; size?: string }>;

          const tables: TableInfo[] = result.map((t) => ({
            name: t.name,
            schema: t.schema || schema,
            rowCount: t.row_count,
            size: t.size,
          }));

          // Cache the result
          metadataCache.set(connectionId, CacheTypes.TABLES, [schema], tables, CACHE_TTL.TABLES);

          return { success: true, tables };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    }),

    /**
     * Get detailed structure of a specific table
     */
    get_table_structure: tool({
      description:
        "Get columns, data types, and constraints for a table. Use this to understand table structure.",
      inputSchema: z.object({
        table: z.string().describe("The table name to inspect"),
      }),
      execute: async ({ table }) => {
        // Check cache first
        const cacheKey = `${schema}.${table}`;
        const cached = metadataCache.get<{ columns: ColumnInfo[]; constraints: ConstraintInfo[] }>(
          connectionId,
          CacheTypes.TABLE_STRUCTURE,
          cacheKey
        );
        if (cached) {
          console.log(`📋 [get_table_structure] Cache hit for ${cacheKey}`);
          return { success: true, table, ...cached, fromCache: true };
        }

        try {
          const [columns, constraints] = await Promise.all([
            callTauri("get_columns", { conn_id: connectionId, schema, table }) as Promise<
              Array<{
                name: string;
                db_type: string;
                nullable: boolean;
                primary_key?: boolean;
                default_value?: string;
              }>
            >,
            callTauri("get_constraints", { conn_id: connectionId, table }) as Promise<
              Array<{ name: string; constraint_type: string; definition?: string; foreign_table?: string }>
            >,
          ]);

          const result = {
            columns: columns.map((c) => ({
              name: c.name,
              dataType: c.db_type,
              nullable: c.nullable,
              primaryKey: c.primary_key,
              defaultValue: c.default_value,
            })),
            constraints: constraints.map((c) => ({
              name: c.name,
              type: c.constraint_type,
              definition: c.definition,
              foreignTable: c.foreign_table,
            })),
          };

          // Cache the result
          metadataCache.set(
            connectionId,
            CacheTypes.TABLE_STRUCTURE,
            [cacheKey],
            result,
            CACHE_TTL.STRUCTURE
          );

          return { success: true, table, ...result };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    }),

    /**
     * Get indexes for a table - useful for query optimization hints
     */
    get_indexes: tool({
      description:
        "Get all indexes for a table. Useful for understanding which columns are optimized for filtering.",
      inputSchema: z.object({
        table: z.string().describe("The table name to get indexes for"),
      }),
      execute: async ({ table }) => {
        // Check cache
        const cached = metadataCache.get<IndexInfo[]>(connectionId, CacheTypes.INDEXES, table);
        if (cached) {
          console.log(`📋 [get_indexes] Cache hit for ${table}`);
          return { success: true, indexes: cached, fromCache: true };
        }

        try {
          const result = (await callTauri("get_indexes", {
            conn_id: connectionId,
            table,
          })) as Array<{ name: string; columns: string[]; is_unique: boolean; is_primary: boolean }>;

          const indexes: IndexInfo[] = result.map((idx) => ({
            name: idx.name,
            columns: idx.columns,
            unique: idx.is_unique,
            primary: idx.is_primary,
          }));

          metadataCache.set(connectionId, CacheTypes.INDEXES, [table], indexes, CACHE_TTL.STRUCTURE);

          return { success: true, indexes };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    }),

    /**
     * Get foreign key relationships for a table
     */
    get_foreign_keys: tool({
      description: "Get foreign key relationships for a table. Shows which columns reference other tables.",
      inputSchema: z.object({
        table: z.string().describe("The table name to get FKs for"),
      }),
      execute: async ({ table }) => {
        // Check cache
        const cached = metadataCache.get<ForeignKeyInfo[]>(
          connectionId,
          CacheTypes.FOREIGN_KEYS,
          table
        );
        if (cached) {
          console.log(`📋 [get_foreign_keys] Cache hit for ${table}`);
          return { success: true, foreignKeys: cached, fromCache: true };
        }

        try {
          const constraints = (await callTauri("get_constraints", {
            conn_id: connectionId,
            table,
          })) as Array<{
            name: string;
            constraint_type: string;
            definition?: string;
            foreign_table?: string;
            column_name?: string;
            foreign_column?: string;
          }>;

          const foreignKeys: ForeignKeyInfo[] = constraints
            .filter((c) => c.constraint_type === "ForeignKey" || c.constraint_type === "FOREIGN KEY")
            .map((fk) => ({
              name: fk.name,
              column: fk.column_name || "",
              foreignTable: fk.foreign_table || "",
              foreignColumn: fk.foreign_column || "id",
              definition: fk.definition,
            }));

          metadataCache.set(
            connectionId,
            CacheTypes.FOREIGN_KEYS,
            [table],
            foreignKeys,
            CACHE_TTL.STRUCTURE
          );

          return { success: true, foreignKeys };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    }),

    /**
     * Search across multiple tables for a value
     * This is more efficient than calling execute_readonly_query multiple times
     */
    search_tables: tool({
      description:
        "Search for a value across multiple tables in searchable columns (name, email, title, etc.). " +
        "Returns matching IDs from each table. Use this to quickly find related records.",
      inputSchema: z.object({
        searchTerm: z.string().describe("The term to search for"),
        tables: z
          .array(z.string())
          .optional()
          .describe("Specific tables to search (default: infer from common patterns)"),
        searchColumns: z
          .array(z.string())
          .optional()
          .describe("Columns to search in (default: name, email, title, username)"),
      }),
      execute: async ({ searchTerm, tables, searchColumns }) => {
        const defaultSearchColumns = searchColumns || ["name", "email", "title", "username", "label"];

        try {
          // Get all tables if not specified
          let tablesToSearch = tables;
          if (!tablesToSearch || tablesToSearch.length === 0) {
            const tablesResult = (await callTauri("get_tables", {
              conn_id: connectionId,
              schema,
            })) as Array<{ name: string }>;
            // Search common reference tables
            const commonTables = ["users", "organizations", "categories", "projects", "teams", "tags"];
            tablesToSearch = tablesResult
              .map((t) => t.name)
              .filter((name) => commonTables.some((ct) => name.toLowerCase().includes(ct)));
          }

          const results: Array<{
            table: string;
            matchingIds: unknown[];
            matchedColumn: string;
          }> = [];

          // Search each table
          for (const table of tablesToSearch.slice(0, 5)) {
            // Limit to 5 tables
            try {
              // Get table structure to find searchable columns
              const columns = (await callTauri("get_columns", {
                conn_id: connectionId,
                schema,
                table,
              })) as Array<{ name: string; db_type: string }>;

              const columnNames = columns.map((c) => c.name.toLowerCase());
              const searchableColumn = defaultSearchColumns.find((sc) =>
                columnNames.includes(sc.toLowerCase())
              );

              if (!searchableColumn) continue;

              // Find the primary key column
              const pkColumn = columns.find((c) => c.name.toLowerCase() === "id") ? "id" : columns[0]?.name;
              if (!pkColumn) continue;

              // Search the table
              const sql = `SELECT ${pkColumn} FROM ${schema}.${table} WHERE ${searchableColumn} ILIKE '%${searchTerm.replace(/'/g, "''")}%' LIMIT 50`;
              const rows = (await callTauri("execute_query", {
                conn_id: connectionId,
                sql,
              })) as Array<Record<string, unknown>>;

              if (rows.length > 0) {
                results.push({
                  table,
                  matchingIds: rows.map((r) => r[pkColumn]),
                  matchedColumn: searchableColumn,
                });
              }
            } catch {
              // Skip tables that fail (might not have the column)
              continue;
            }
          }

          return {
            success: true,
            searchTerm,
            results,
            tablesSearched: tablesToSearch.length,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    }),

    /**
     * Execute a read-only SELECT query
     */
    execute_readonly_query: tool({
      description:
        "Execute a read-only SELECT query to find data. Use this to search for specific IDs or values.",
      inputSchema: z.object({
        sql: z.string().describe("The SELECT query to execute (must start with SELECT or WITH)"),
      }),
      execute: async ({ sql }) => {
        // Validate SELECT only
        const trimmed = sql.trim().toLowerCase();
        if (!trimmed.startsWith("select") && !trimmed.startsWith("with")) {
          return { success: false, error: "Only SELECT queries are allowed" };
        }

        // Block dangerous keywords
        const dangerous = ["insert", "update", "delete", "drop", "create", "alter", "truncate"];
        const found = dangerous.find((kw) => trimmed.includes(kw));
        if (found) {
          return { success: false, error: `Query contains forbidden keyword: ${found.toUpperCase()}` };
        }

        try {
          // Add LIMIT if not present
          const finalSql = trimmed.includes("limit") ? sql : `${sql} LIMIT 100`;
          const rows = (await callTauri("execute_query", {
            conn_id: connectionId,
            sql: finalSql,
          })) as unknown[];

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
          };
        }
      },
    }),

    /**
     * Submit the final WHERE clause - this is the "answer" tool
     * When the AI calls this, we know it has finished and has a result
     */
    submit_where_clause: tool({
      description:
        "Submit the final WHERE clause. Call this tool when you have determined the correct filter expression. " +
        "Do NOT include the 'WHERE' keyword - just the condition expression.",
      inputSchema: z.object({
        whereClause: z
          .string()
          .min(1)
          .describe("The WHERE clause expression WITHOUT the 'WHERE' keyword"),
        explanation: z
          .string()
          .optional()
          .describe("Brief explanation of what the filter does"),
        usedSubquery: z
          .boolean()
          .optional()
          .describe("Whether a subquery was used for cross-table filtering"),
        confidence: z
          .enum(["high", "medium", "low"])
          .optional()
          .describe("Confidence level in the generated clause"),
      }),
      execute: async (input) => {
        // This tool just returns the structured input
        // The calling code will detect this tool was called and extract the result
        return {
          success: true,
          ...input,
        };
      },
    }),
  };
}

/**
 * Clear cache for a connection (useful when schema changes)
 */
export function clearConnectionCache(connectionId: string): void {
  metadataCache.clearConnection(connectionId);
  console.log(`🗑️ [Cache] Cleared cache for connection: ${connectionId}`);
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return metadataCache.stats();
}
