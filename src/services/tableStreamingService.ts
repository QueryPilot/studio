import { queryStreamClient } from "./queryStreamClient";
import { isTauri } from "@/utils/tauri";
import type { TableDataRow } from "./tableDataTypes";
import type { ColumnMeta } from "@/types/database";
import type { FilterConfig, SortConfig } from "@/types/filter";
import {
  mapBackendColumnsToColumnMeta,
  mapRowsToTableData,
} from "./tableDataTransform";

export interface StreamProgress {
  rowsFetched: number;
  totalRows?: number;
  percentage?: number;
  executionTimeMs?: number;
  started?: boolean;
  completed?: boolean;
}

export interface StreamEntityPageParams {
  connectionId: string;
  database: string;
  schema?: string;
  entityType: "table" | "view" | "materialized_view";
  entityName: string;
  select?: string[];
  filters?: FilterConfig;
  sorts?: SortConfig[];
  limit?: number;
  offset?: number;
  pageSize?: number;
  rowLimit?: number;
  signal?: AbortSignal;
  columnsHint?: ColumnMeta[];
  estimatedTotalHint?: number;
  onProgress?: (progress: StreamProgress) => void;
  onBatch?: (batch: TableDataRow[], rowOffset: number) => void;
}

export interface StreamEntityPageResult {
  columns: ColumnMeta[];
  rows: TableDataRow[];
  hasMore: boolean;
  estimatedTotal?: number;
  executionTimeMs?: number;
}

const DEFAULT_PAGE_SIZE = 1000;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function buildQualifiedName(schema: string | undefined, name: string): string {
  if (!schema) {
    return quoteIdentifier(name);
  }
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function buildSelectClause(select?: string[]): string {
  if (!select || select.length === 0) {
    return "*";
  }

  return select.map((col) => quoteIdentifier(col)).join(", ");
}

function buildOrderBy(sorts?: SortConfig[]): string {
  if (!sorts || sorts.length === 0) {
    return "";
  }

  const clauses = sorts
    .filter((sort) => sort.column)
    .map(
      (sort) =>
        `${quoteIdentifier(sort.column)} ${sort.direction.toUpperCase() === "DESC" ? "DESC" : "ASC"}`,
    );

  if (clauses.length === 0) {
    return "";
  }

  return ` ORDER BY ${clauses.join(", ")}`;
}

function buildTableSql(params: StreamEntityPageParams, limit: number, offset: number): string {
  const { schema, entityName, select, sorts } = params;
  const base = buildQualifiedName(schema, entityName);
  const orderClause = buildOrderBy(sorts);

  return `SELECT ${buildSelectClause(select)} FROM ${base}${orderClause} LIMIT ${limit} OFFSET ${offset}`;
}

export async function streamEntityPage(
  params: StreamEntityPageParams,
): Promise<StreamEntityPageResult> {
  const {
    connectionId,
    schema = "public",
    entityName,
    limit,
    offset = 0,
    pageSize = DEFAULT_PAGE_SIZE,
    rowLimit,
    signal,
    onProgress,
    onBatch,
    columnsHint,
    estimatedTotalHint,
  } = params;

  const basePageSize = limit ?? pageSize ?? DEFAULT_PAGE_SIZE;
  const effectivePageSize = Math.max(1, basePageSize);
  const fetchLimit =
    rowLimit != null ? Math.max(1, Math.min(effectivePageSize, rowLimit)) : effectivePageSize;
  const limitReachedByRowCap =
    rowLimit != null && offset >= rowLimit ? true : undefined;

  if (!isTauri()) {
    throw new Error(
      "Table streaming requires the Tauri runtime. Run the desktop shell to stream table data.",
    );
  }

  if (signal?.aborted) {
    throw new DOMException("Streaming aborted", "AbortError");
  }

  const sql = buildTableSql(params, fetchLimit, offset);

  let resolvedColumns: ColumnMeta[] | null = columnsHint ?? null;
  const rows: TableDataRow[] = [];
  let executionTimeMs: number | undefined;

  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Streaming aborted", "AbortError"));
          },
          { once: true },
        );
      })
    : null;

  const streamPromise = queryStreamClient
    .streamWithCallbacks(
      {
        connId: connectionId,
        sql,
        batchSize: fetchLimit,
      },
      {
        onStarted: (columns, estimatedRows) => {
          if (!resolvedColumns) {
            const mapped = mapBackendColumnsToColumnMeta(columns);
            if (columnsHint?.length) {
              const hintByName = new Map(columnsHint.map((col) => [col.name, col]));
              resolvedColumns = mapped.map((col, index) => {
                const fromHint = hintByName.get(col.name);
                return fromHint
                  ? { ...fromHint, ordinal: index }
                  : { ...col, ordinal: index };
              });
            } else {
              resolvedColumns = mapped.map((col, index) => ({ ...col, ordinal: index }));
            }
          }

          if (onProgress) {
            onProgress({ rowsFetched: 0, totalRows: estimatedRows, started: true });
          }
        },
        onBatch: (batch, totalSoFar) => {
          if (!resolvedColumns) {
            return;
          }

          if (signal?.aborted) {
            return;
          }

          let rawRows = batch.rows;
          if (rowLimit !== undefined) {
            const remaining = rowLimit - rows.length;
            if (remaining <= 0) {
              return;
            }
            rawRows = rawRows.slice(0, remaining);
          }

          if (rawRows.length === 0) {
            return;
          }

      const mappedRows = mapRowsToTableData(resolvedColumns, rawRows);
      rows.push(...mappedRows);
      if (onBatch) {
        onBatch(mappedRows, rows.length - mappedRows.length);
      }

      if (onProgress) {
        onProgress({ rowsFetched: rows.length });
      }
        },
        onSuccess: (result) => {
          executionTimeMs = result.executionTimeMs;
          if (onProgress) {
            onProgress({
              rowsFetched: result.totalRows,
              totalRows: result.totalRows,
              executionTimeMs: result.executionTimeMs,
              completed: true,
            });
          }
        },
        onError: () => {
          if (signal?.aborted) {
            return;
          }
        },
      },
    )
    .then((result) => {
      executionTimeMs = executionTimeMs ?? result.executionTimeMs;
    });

  await (abortPromise ? Promise.race([streamPromise, abortPromise]) : streamPromise);

  if (!resolvedColumns) {
    resolvedColumns = columnsHint ?? [];
  }

  const limitReached =
    (rowLimit != null && offset + rows.length >= rowLimit) || limitReachedByRowCap === true;
  const hasMoreFromEstimate =
    estimatedTotalHint != null
      ? offset + rows.length < estimatedTotalHint
      : rows.length === fetchLimit;
  const hasMore = !limitReached && hasMoreFromEstimate;

  let estimatedTotal: number | undefined;
  if (offset === 0) {
    try {
      estimatedTotal = await BackendAPI.getTableCount(
        connectionId,
        schema,
        entityName,
      );
    } catch (error) {
      console.warn("Failed to fetch estimated total:", error);
    }
  }

  return {
    columns: resolvedColumns,
    rows,
    hasMore,
    estimatedTotal,
    executionTimeMs,
  };
}
