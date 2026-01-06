/**
 * Hook for fetching MySQL/MariaDB events (Event Scheduler)
 *
 * Events are only available in MySQL/MariaDB databases.
 * Returns empty array for other database types.
 */

import { useQuery } from "@tanstack/react-query";
import { IntrospectionService } from "@/services/introspectionService";
import { DbType, isMySQLCompatible } from "@/types/connection";
import type { Event } from "@/services/backend";

interface UseEventsQueryParams {
  connectionId: string;
  schema: string;
  dbType: DbType;
  enabled?: boolean;
}

interface UseEventsQueryResult {
  events: Event[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useEventsQuery({
  connectionId,
  schema,
  dbType,
  enabled = true,
}: UseEventsQueryParams): UseEventsQueryResult {
  // Only fetch for MySQL/MariaDB
  const shouldFetch = enabled && isMySQLCompatible(dbType) && !!connectionId && !!schema;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["events", connectionId, schema],
    queryFn: async () => {
      return IntrospectionService.getEvents(connectionId, schema);
    },
    enabled: shouldFetch,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    events: data ?? [],
    isLoading: shouldFetch && isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refetch,
  };
}
