import { useQuery } from "@tanstack/react-query";
import { BackendAPI } from "@/services/backend";

export interface ColumnStats {
  /** Column name */
  column: string;
  /** Minimum value (for numeric/date columns) */
  min: unknown;
  /** Maximum value (for numeric/date columns) */
  max: unknown;
  /** Count of NULL values */
  nullCount: number;
  /** Count of distinct non-null values */
  distinctCount: number;
  /** Average length for text columns */
  avgLength?: number;
  /** Most common value (mode) */
  mostCommon?: unknown;
}

export interface UseColumnStatisticsOptions {
  /** Connection ID */
  connectionId: string;
  /** Database name */
  database: string;
  /** Schema name */
  schema: string;
  /** Table name */
  table: string;
  /** Column names to get statistics for */
  columns: string[];
  /** Whether to enable the query */
  enabled?: boolean;
}

/**
 * Build SQL to compute column statistics
 * Uses a single query with multiple aggregations for efficiency
 */
function buildStatsQuery(
  schema: string,
  table: string,
  columns: string[]
): string {
  if (columns.length === 0) return "";

  const schemaPrefix = schema ? `"${schema}".` : "";
  const tableName = `${schemaPrefix}"${table}"`;

  // Build stats for each column
  // Use SUM(CASE WHEN ... THEN 1 ELSE 0 END) instead of COUNT(*) FILTER (WHERE ...)
  // because FILTER clause is PostgreSQL-specific and not supported by SQLite
  const statsCtes = columns.map((col, idx) => {
    const colQuoted = `"${col}"`;
    return `
      stats_${idx} AS (
        SELECT
          '${col.replace(/'/g, "''")}' AS column_name,
          MIN(${colQuoted}) AS min_val,
          MAX(${colQuoted}) AS max_val,
          SUM(CASE WHEN ${colQuoted} IS NULL THEN 1 ELSE 0 END) AS null_count,
          COUNT(DISTINCT ${colQuoted}) AS distinct_count
        FROM ${tableName}
      )
    `;
  });

  // Union all stats together
  const unionParts = columns.map(
    (_, idx) => `SELECT * FROM stats_${idx}`
  );

  return `
    WITH ${statsCtes.join(",\n")}
    ${unionParts.join("\n    UNION ALL\n    ")}
  `.trim();
}

/**
 * Hook for fetching column statistics (min, max, null count, distinct count).
 *
 * Features:
 * - Computes stats in a single query for efficiency
 * - Caches results with React Query (30 min stale time)
 * - Returns stats keyed by column name
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useColumnStatistics({
 *   connectionId: "conn-123",
 *   database: "mydb",
 *   schema: "public",
 *   table: "users",
 *   columns: ["id", "name", "email"]
 * });
 *
 * // data = { id: { min: 1, max: 1000, ... }, name: { ... } }
 * ```
 */
export function useColumnStatistics({
  connectionId,
  database,
  schema,
  table,
  columns,
  enabled = true,
}: UseColumnStatisticsOptions) {
  return useQuery<Record<string, ColumnStats>>({
    queryKey: [
      "column-stats",
      connectionId,
      database,
      schema,
      table,
      columns.join(","),
    ],
    queryFn: async () => {
      if (columns.length === 0) {
        return {};
      }

      try {
        const sql = buildStatsQuery(schema, table, columns);
        const result = await BackendAPI.query(connectionId, sql);

        // Map results to ColumnStats record
        const stats: Record<string, ColumnStats> = {};

        for (const row of result.rows) {
          const columnName = String(row[0]);
          stats[columnName] = {
            column: columnName,
            min: row[1],
            max: row[2],
            nullCount: Number(row[3]) || 0,
            distinctCount: Number(row[4]) || 0,
          };
        }

        return stats;
      } catch (error) {
        console.error("Column statistics query failed:", error);
        return {};
      }
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
    enabled: enabled && columns.length > 0 && !!connectionId && !!table,
    refetchOnWindowFocus: false,
  });
}

/**
 * Format column stats for display in tooltip
 */
export function formatColumnStatsTooltip(stats: ColumnStats | undefined): string {
  if (!stats) return "";

  const lines: string[] = [];

  if (stats.min !== null && stats.min !== undefined) {
    lines.push(`Min: ${stats.min}`);
  }
  if (stats.max !== null && stats.max !== undefined) {
    lines.push(`Max: ${stats.max}`);
  }
  if (stats.nullCount > 0) {
    lines.push(`Nulls: ${stats.nullCount.toLocaleString()}`);
  }
  if (stats.distinctCount > 0) {
    lines.push(`Distinct: ${stats.distinctCount.toLocaleString()}`);
  }

  return lines.join("\n");
}
