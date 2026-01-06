/**
 * Hook for fetching MySQL/MariaDB table partitions
 *
 * Partitions are only available in MySQL/MariaDB databases.
 * Returns empty array for other database types or non-partitioned tables.
 */

import { useQuery } from "@tanstack/react-query";
import { IntrospectionService } from "@/services/introspectionService";
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

export function usePartitionsQuery({
  connectionId,
  schema,
  table,
  dbType,
  enabled = true,
}: UsePartitionsQueryParams): UsePartitionsQueryResult {
  // Only fetch for MySQL/MariaDB
  const shouldFetch = enabled && isMySQLCompatible(dbType) && !!connectionId && !!schema && !!table;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["partitions", connectionId, schema, table],
    queryFn: async () => {
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
