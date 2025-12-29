import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { databaseService } from "@/services/databaseService";
import { foreignKeyTargetsQueryKey } from "./queryKeys";

interface UseForeignKeyTargetsParams {
  connectionId: string;
  database: string;
  schema?: string;
  enabled?: boolean;
}

export interface ForeignKeyTarget {
  table: string;
  column: string;
  type: string;
}

async function fetchForeignKeyTargets(
  connectionId: string,
  database: string,
  schema: string,
): Promise<ForeignKeyTarget[]> {
  if (!connectionId || !database || !schema) {
    throw new Error("Connection, database, and schema are required");
  }

  await databaseService.connectById(connectionId);
  return databaseService.getForeignKeyTargets(connectionId, database, schema);
}

export function useForeignKeyTargets({
  connectionId,
  database,
  schema = "public",
  enabled = true,
}: UseForeignKeyTargetsParams) {
  const queryKey = useMemo(
    () =>
      foreignKeyTargetsQueryKey({
        connectionId,
        database,
        schema,
      }),
    [connectionId, database, schema],
  );

  const shouldEnable =
    enabled && Boolean(connectionId && database && schema);

  const { data, isPending, isFetching, error } = useQuery({
    queryKey,
    queryFn: () => fetchForeignKeyTargets(connectionId, database, schema),
    enabled: shouldEnable,
  });

  return {
    targets: data ?? [],
    isLoading: shouldEnable && (isPending || isFetching),
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  } as const;
}
