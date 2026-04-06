/**
 * useTrinoMultiCatalogData.ts
 *
 * Returns React Query option factories for lazy per-catalog, per-schema
 * data fetching in the Trino sidebar tree.
 */
import { databaseService } from "@/services/databaseService";

export function useTrinoMultiCatalogData(connectionId: string) {
  function schemasQueryOptions(catalog: string) {
    return {
      queryKey: ["trino-schemas", connectionId, catalog] as const,
      queryFn: () => databaseService.listSchemasForCatalog(connectionId, catalog),
      staleTime: 60_000,
      retry: 1,
      enabled: !!connectionId && !!catalog,
    };
  }

  function tablesQueryOptions(catalog: string, schema: string) {
    return {
      queryKey: ["trino-tables", connectionId, catalog, schema] as const,
      queryFn: () =>
        databaseService.listTablesForCatalogSchema(connectionId, catalog, schema),
      staleTime: 60_000,
      retry: 1,
      enabled: !!connectionId && !!catalog && !!schema,
    };
  }

  return { schemasQueryOptions, tablesQueryOptions };
}
