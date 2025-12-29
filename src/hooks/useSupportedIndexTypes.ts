import { useQuery } from "@tanstack/react-query";
import { IntrospectionService } from "@/services/introspectionService";
import { DbType } from "@/types/connection";

interface UseSupportedIndexTypesParams {
  connectionId: string;
  dbType: DbType;
  enabled?: boolean;
}

interface UseSupportedIndexTypesReturn {
  indexTypes: string[];
  defaultType: string;
  isLoading: boolean;
  error: string | null;
}

/**
 * Default index types per database when query fails or as initial values.
 * These match what each database adapter returns from getSupportedIndexTypesQuery.
 */
const DEFAULT_INDEX_TYPES: Record<DbType, { types: string[]; default: string }> = {
  [DbType.PostgreSQL]: {
    types: ["btree", "hash", "gist", "gin", "spgist", "brin"],
    default: "btree",
  },
  [DbType.MySQL]: {
    types: ["btree", "hash", "fulltext", "spatial"],
    default: "btree",
  },
  [DbType.SQLite]: {
    types: ["btree"],
    default: "btree",
  },
  [DbType.SQLServer]: {
    types: ["clustered", "nonclustered", "columnstore"],
    default: "nonclustered",
  },
};

/**
 * Hook for fetching supported index types for a database connection.
 *
 * Uses IntrospectionService to query available index types and falls back
 * to sensible defaults if the query fails.
 *
 * @param connectionId - The active connection ID
 * @param dbType - The database type (PostgreSQL, MySQL, SQLite, SQLServer)
 * @param enabled - Whether to enable the query (default: true)
 *
 * @returns indexTypes - Array of supported index type names (lowercase)
 * @returns defaultType - The default index type for this database
 * @returns isLoading - Whether the query is in progress
 * @returns error - Error message if the query failed, null otherwise
 */
export function useSupportedIndexTypes({
  connectionId,
  dbType,
  enabled = true,
}: UseSupportedIndexTypesParams): UseSupportedIndexTypesReturn {
  const defaults = DEFAULT_INDEX_TYPES[dbType] ?? DEFAULT_INDEX_TYPES[DbType.PostgreSQL];

  const { data, isPending, error } = useQuery({
    queryKey: ["indexTypes", connectionId, dbType],
    queryFn: async () => {
      try {
        const types = await IntrospectionService.getSupportedIndexTypes(connectionId);

        // Normalize to lowercase for consistent comparison
        const normalizedTypes = types.map((t) => t.toLowerCase());

        // Return defaults if query returned empty
        return normalizedTypes.length > 0 ? normalizedTypes : defaults.types;
      } catch {
        // Fall back to defaults on any error
        return defaults.types;
      }
    },
    enabled: enabled && Boolean(connectionId),
    // Index types rarely change, cache for 1 hour
    staleTime: 1000 * 60 * 60,
    // Keep cached data while refetching
    gcTime: 1000 * 60 * 60 * 2,
  });

  return {
    indexTypes: data ?? defaults.types,
    defaultType: defaults.default,
    isLoading: isPending,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}
