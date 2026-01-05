import type { FilterConfig, SortConfig } from "@/types/filter";
import type { EmbeddedFKConfig } from "@/adapters/types";

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
  embeddedFKs?: EmbeddedFKConfig[];
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
    params.embeddedFKs?.length ? JSON.stringify(params.embeddedFKs) : null,
  ] as const;

export const foreignKeyTargetsQueryKey = (params: {
  connectionId: string;
  database: string;
  schema: string;
}) =>
  [
    "foreign-key-targets",
    params.connectionId,
    params.database,
    params.schema,
  ] as const;
