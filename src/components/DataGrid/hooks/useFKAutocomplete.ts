import { useQuery } from "@tanstack/react-query";
import { BackendAPI } from "@/services/backend";
import { useConnectionStore } from "@/stores/connectionStoreNew";

export interface FKReference {
  /** Referenced table name */
  table: string;
  /** Referenced column name */
  column: string;
  /** Referenced schema (optional, defaults to current) */
  schema?: string;
  /** Display column - column to show in dropdown (defaults to referenced column) */
  displayColumn?: string;
}

export interface FKLookupValue {
  /** The actual value to store in FK column */
  value: unknown;
  /** Display text shown in dropdown */
  display: string;
}

export interface FKLookupResult {
  values: FKLookupValue[];
  hasMore: boolean;
  total?: number;
}

export interface UseFKAutocompleteOptions {
  /** Connection ID */
  connectionId: string;
  /** Current database */
  database: string;
  /** FK reference info */
  fkReference: FKReference | null | undefined;
  /** Search term to filter results */
  searchTerm?: string;
  /** Max results to return (default 100) */
  limit?: number;
  /** Whether to enable the query */
  enabled?: boolean;
}

/**
 * Build SQL query to fetch FK lookup values
 */
function buildFKLookupQuery(
  fkRef: FKReference,
  searchTerm: string | undefined,
  limit: number,
  dbType: string
): string {
  const schema = fkRef.schema ? `"${fkRef.schema}".` : "";
  const table = `${schema}"${fkRef.table}"`;
  const valueCol = `"${fkRef.column}"`;
  const displayCol = fkRef.displayColumn
    ? `"${fkRef.displayColumn}"`
    : valueCol;

  // Build WHERE clause for search (searches both PK and display column)
  let whereClause = "";
  if (searchTerm && searchTerm.trim()) {
    const escaped = searchTerm.replace(/'/g, "''");
    // Use ILIKE for PostgreSQL, LIKE for others
    const likeOp = dbType === "PostgreSQL" ? "ILIKE" : "LIKE";
    // Search both PK column and display column
    if (valueCol === displayCol) {
      whereClause = `WHERE CAST(${valueCol} AS TEXT) ${likeOp} '%${escaped}%'`;
    } else {
      whereClause = `WHERE CAST(${valueCol} AS TEXT) ${likeOp} '%${escaped}%' OR CAST(${displayCol} AS TEXT) ${likeOp} '%${escaped}%'`;
    }
  }

  // Select distinct values with display text
  // Use COALESCE to handle NULL display values
  const selectPart =
    valueCol === displayCol
      ? `DISTINCT ${valueCol} AS value, CAST(${valueCol} AS TEXT) AS display`
      : `DISTINCT ${valueCol} AS value, COALESCE(CAST(${displayCol} AS TEXT), CAST(${valueCol} AS TEXT)) AS display`;

  return `
    SELECT ${selectPart}
    FROM ${table}
    ${whereClause}
    ORDER BY display
    LIMIT ${limit + 1}
  `.trim();
}

/**
 * Hook for fetching foreign key lookup values with autocomplete support.
 *
 * Features:
 * - Fetches distinct values from referenced table
 * - Supports search/filter by display text
 * - Caches results with React Query (5 min stale time)
 * - Returns display text alongside values
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useFKAutocomplete({
 *   connectionId: "conn-123",
 *   database: "mydb",
 *   fkReference: {
 *     table: "users",
 *     column: "id",
 *     displayColumn: "name"
 *   },
 *   searchTerm: "john"
 * });
 * ```
 */
export function useFKAutocomplete({
  connectionId,
  database,
  fkReference,
  searchTerm,
  limit = 100,
  enabled = true,
}: UseFKAutocompleteOptions) {
  // Get connection info to determine DB type
  const connection = useConnectionStore((s) =>
    s.connections.find((c) => c.profile.id === connectionId)
  );
  const dbType = connection?.profile.db_type ?? "PostgreSQL";

  return useQuery<FKLookupResult>({
    queryKey: [
      "fk-lookup",
      connectionId,
      database,
      fkReference?.schema,
      fkReference?.table,
      fkReference?.column,
      fkReference?.displayColumn,
      searchTerm,
      limit,
    ],
    queryFn: async () => {
      if (!fkReference) {
        return { values: [], hasMore: false };
      }

      try {
        const sql = buildFKLookupQuery(fkReference, searchTerm, limit, dbType);
        const result = await BackendAPI.query(connectionId, sql);

        // Map results to FKLookupValue format
        const values: FKLookupValue[] = result.rows
          .slice(0, limit)
          .map((row) => {
            const displayVal = row[1] ?? row[0];
            let displayStr: string;
            if (displayVal === null || displayVal === undefined) {
              displayStr = "";
            } else if (typeof displayVal === "object") {
              displayStr = JSON.stringify(displayVal);
            } else {
              displayStr = String(displayVal);
            }
            return {
              value: row[0],
              display: displayStr,
            };
          });

        return {
          values,
          hasMore: result.rows.length > limit,
          total: result.rows.length,
        };
      } catch (error) {
        console.error("FK lookup failed:", error);
        return { values: [], hasMore: false };
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    enabled: enabled && !!fkReference && !!connectionId,
    refetchOnWindowFocus: false,
  });
}

/**
 * Pre-fetch FK lookup values for a column (call on cell focus)
 */
export function usePrefetchFKLookup() {
  // This could be used to pre-warm the cache when a cell is focused
  // For now, we rely on the main hook's caching
  return null;
}
