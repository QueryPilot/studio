/**
 * Hook for fetching table partitions
 *
 * Partitions are supported in:
 * - MySQL/MariaDB: via information_schema.PARTITIONS
 * - PostgreSQL: via pg_inherits and pg_partitioned_table (PG 10+)
 * - SQL Server: via sys.partition_schemes and sys.partition_functions
 *
 * Returns empty array for other database types or non-partitioned tables.
 */

import { useQuery } from "@tanstack/react-query";
import { IntrospectionService } from "@/services/introspectionService";
import { databaseService } from "@/services/databaseService";
import { DbType, isMySQLCompatible } from "@/types/connection";
import type { Partition } from "@/services/backend";

interface UsePartitionsQueryParams {
  connectionId: string;
  schema: string;
  table: string;
  dbType: DbType;
  enabled?: boolean;
}

interface UsePartitionsQueryResult {
  partitions: Partition[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  hasPartitions: boolean;
}

/**
 * Check if the database type supports partition introspection
 */
function supportsPartitions(dbType: DbType): boolean {
  return isMySQLCompatible(dbType) || dbType === DbType.PostgreSQL || dbType === DbType.SQLServer;
}

export function usePartitionsQuery({
  connectionId,
  schema,
  table,
  dbType,
  enabled = true,
}: UsePartitionsQueryParams): UsePartitionsQueryResult {
  // Only fetch for databases that support partitions
  const shouldFetch = enabled && supportsPartitions(dbType) && !!connectionId && !!schema && !!table;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["partitions", connectionId, schema, table],
    queryFn: async () => {
      if (!databaseService.isConnectionActive(connectionId)) {
        await databaseService.connectById(connectionId);
      }
      return IntrospectionService.getPartitions(connectionId, schema, table);
    },
    enabled: shouldFetch,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const partitions = data ?? [];

  return {
    partitions,
    isLoading: shouldFetch && isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refetch,
    hasPartitions: partitions.length > 0,
  };
}
