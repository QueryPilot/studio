import type { FilterConfig, SortConfig } from "@/types/filter";

export const tableStructureQueryKey = (params: {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  options?: Record<string, unknown>;
}) =>
  [
    "table-structure",
    params.connectionId,
    params.database,
    params.schema,
    params.table,
    params.options ?? null,
  ] as const;

export const tableDataQueryKey = (params: {
  connectionId: string;
  database: string;
  schema: string | null | undefined;
  entityType: "table" | "view" | "materialized_view";
  entityName: string;
  filters?: FilterConfig;
  sorts?: SortConfig[];
  limit?: number;
  pageSize?: number;
}) =>
  [
    "table-data",
    params.connectionId,
    params.database,
    params.schema ?? null,
    params.entityType,
    params.entityName,
    // Serialize objects to ensure stable query keys
    params.filters ? JSON.stringify(params.filters) : null,
    params.sorts ? JSON.stringify(params.sorts) : null,
    params.limit ?? null,
    params.pageSize ?? null,
  ] as const;
