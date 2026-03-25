import { useQuery } from "@tanstack/react-query";
import { IntrospectionService } from "@/services/introspectionService";
import { DbType } from "@/types/connection";
import {
  POSTGRES_STANDARD_TYPES,
  MYSQL_STANDARD_TYPES,
  SQLITE_STANDARD_TYPES,
  MSSQL_STANDARD_TYPES,
  ORACLE_STANDARD_TYPES,
} from "@/components/TableStructure/DataTypeCellRenderer";

interface UseSupportedColumnTypesParams {
  connectionId: string;
  dbType: DbType;
  enabled?: boolean;
}

interface UseSupportedColumnTypesReturn {
  columnTypes: string[];
  defaultType: string;
  isLoading: boolean;
  error: string | null;
}

/**
 * Default column types per database when query fails or as initial values.
 */
const DEFAULT_COLUMN_TYPES: Record<DbType, { types: string[]; default: string }> = {
  [DbType.PostgreSQL]: { types: POSTGRES_STANDARD_TYPES, default: "text" },
  [DbType.MySQL]: { types: MYSQL_STANDARD_TYPES, default: "varchar" },
  [DbType.MariaDB]: { types: MYSQL_STANDARD_TYPES, default: "varchar" },
  [DbType.SQLite]: { types: SQLITE_STANDARD_TYPES, default: "text" },
  [DbType.SQLServer]: { types: MSSQL_STANDARD_TYPES, default: "nvarchar" },
  [DbType.Oracle]: { types: ORACLE_STANDARD_TYPES, default: "number" },
  [DbType.MongoDB]: { types: [], default: "" },
  [DbType.Redis]: { types: [], default: "" },
};

/**
 * Hook for fetching supported column types for a database connection.
 *
 * Uses IntrospectionService to query available column types and falls back
 * to sensible defaults if the query fails.
 */
export function useSupportedColumnTypes({
  connectionId,
  dbType,
  enabled = true,
}: UseSupportedColumnTypesParams): UseSupportedColumnTypesReturn {
  const defaults = DEFAULT_COLUMN_TYPES[dbType];

  const { data, isPending, error } = useQuery({
    queryKey: ["columnTypes", connectionId, dbType],
    queryFn: async () => {
      try {
        const types =
          await IntrospectionService.getSupportedColumnTypes(connectionId);
        // Normalize to lowercase for consistent display
        const normalized = types.map((t) => t.toLowerCase());
        return normalized.length > 0 ? normalized : defaults.types;
      } catch {
        return defaults.types;
      }
    },
    enabled: enabled && Boolean(connectionId),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 2,
  });

  return {
    columnTypes: data ?? defaults.types,
    defaultType: defaults.default,
    isLoading: isPending,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}
