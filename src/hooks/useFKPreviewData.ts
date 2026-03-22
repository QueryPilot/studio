import { useState, useEffect, useRef } from "react";
import {
  BackendAPI,
  type QueryColumnMeta,
  type RawCellValue,
} from "@/services/backend";
import { logger } from "@/lib/logger";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { formatTableName, quoteIdentifier, formatValue } from "@/adapters/formatting";
import { DbType } from "@/types/connection";
import type { EmbeddedFKConfig } from "@/adapters/types";

interface FKPreviewDataParams {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  pkColumn: string;
  pkValue: unknown;
  enabled?: boolean;
  embeddedFKs?: EmbeddedFKConfig[];
}

interface FKPreviewDataResult {
  data: Record<string, RawCellValue> | null;
  columns: QueryColumnMeta[];
  isLoading: boolean;
  error: string | null;
}

class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

const fkPreviewCache = new LRUCache<
  string,
  { data: Record<string, RawCellValue>; columns: QueryColumnMeta[] }
>(50);

function buildCacheKey(
  connectionId: string,
  schema: string,
  table: string,
  pkColumn: string,
  pkValue: unknown,
  embeddedFKs?: EmbeddedFKConfig[],
): string {
  const base = `${connectionId}:${schema}.${table}.${pkColumn}=${JSON.stringify(pkValue)}`;
  if (!embeddedFKs || embeddedFKs.length === 0) return base;
  const fkSuffix = embeddedFKs
    .map((fk) => `${fk.fkColumn}:${fk.refDisplayColumns.join(",")}`)
    .join("|");
  return `${base}[${fkSuffix}]`;
}

function buildEmbeddedFKSql(
  tableName: string,
  pkColumn: string,
  pkValue: string,
  embeddedFKs: EmbeddedFKConfig[],
  dbType: DbType,
): string {
  // Build SELECT columns: main_table.*, t1.col AS "__qp_fk__fk_col__ref_col", ...
  const selectParts = [`${tableName}.*`];
  const joinParts: string[] = [];

  embeddedFKs.forEach((fk, i) => {
    const alias = `t${i + 1}`;
    const refTable = formatTableName(fk.refSchema, fk.refTable, dbType);

    for (const displayCol of fk.refDisplayColumns) {
      const aliasName = `__qp_fk__${fk.fkColumn}__${displayCol}`;
      selectParts.push(
        `${alias}.${quoteIdentifier(displayCol, dbType)} AS ${quoteIdentifier(aliasName, dbType)}`,
      );
    }

    joinParts.push(
      `LEFT JOIN ${refTable} AS ${alias} ON ${tableName}.${quoteIdentifier(fk.fkColumn, dbType)} = ${alias}.${quoteIdentifier(fk.refPkColumn, dbType)}`,
    );
  });

  const colName = quoteIdentifier(pkColumn, dbType);
  const selectKeyword = dbType === DbType.SQLServer ? `SELECT TOP 1` : `SELECT`;
  const limitSuffix = dbType === DbType.SQLServer ? '' : ' LIMIT 1';
  return `${selectKeyword} ${selectParts.join(", ")} FROM ${tableName} ${joinParts.join(" ")} WHERE ${tableName}.${colName} = ${pkValue}${limitSuffix}`;
}

export function useFKPreviewData(params: FKPreviewDataParams): FKPreviewDataResult {
  const {
    connectionId,
    database,
    schema,
    table,
    pkColumn,
    pkValue,
    enabled = true,
    embeddedFKs,
  } = params;

  const [data, setData] = useState<Record<string, RawCellValue> | null>(null);
  const [columns, setColumns] = useState<QueryColumnMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !connectionId || !table || !pkColumn || pkValue === undefined) {
      setData(null);
      setColumns([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const cacheKey = buildCacheKey(connectionId, schema, table, pkColumn, pkValue, embeddedFKs);

    if (fkPreviewCache.has(cacheKey)) {
      const cached = fkPreviewCache.get(cacheKey);
      if (cached) {
        setData(cached.data);
        setColumns(cached.columns);
        setIsLoading(false);
        setError(null);
        return;
      }
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Get connection to determine DB dialect
        const connection = useConnectionStore.getState().getConnection(connectionId);
        const dbType = connection?.profile.db_type || DbType.PostgreSQL;

        const tableName = formatTableName(schema, table, dbType);
        const val = formatValue(pkValue, dbType);

        let sql: string;
        if (embeddedFKs && embeddedFKs.length > 0) {
          sql = buildEmbeddedFKSql(tableName, pkColumn, val, embeddedFKs, dbType);
        } else {
          const colName = quoteIdentifier(pkColumn, dbType);
          if (dbType === DbType.SQLServer) {
            sql = `SELECT TOP 1 * FROM ${tableName} WHERE ${colName} = ${val}`;
          } else {
            sql = `SELECT * FROM ${tableName} WHERE ${colName} = ${val} LIMIT 1`;
          }
        }

        logger.debug(`[useFKPreviewData] Fetching FK preview:`, { schema, table, pkColumn, pkValue, sql });

        const result = await BackendAPI.query(connectionId, sql);

        if (abortControllerRef.current?.signal.aborted) {
          return;
        }

        if (result.rows.length === 0) {
          setData(null);
          setColumns([]);
          setError("Record not found");
          setIsLoading(false);
          return;
        }

        const row = result.rows[0];
        if (!row) {
          setData(null);
          setColumns([]);
          setError("No data returned");
          setIsLoading(false);
          return;
        }

        const rowData: Record<string, RawCellValue> = {};
        result.columns.forEach((col, index) => {
          rowData[col.name] = row[index] ?? null;
        });

        fkPreviewCache.set(cacheKey, { data: rowData, columns: result.columns });

        setData(rowData);
        setColumns(result.columns);
        setError(null);
      } catch (err) {
        if (abortControllerRef.current?.signal.aborted) {
          return;
        }

        const message = err instanceof Error ? err.message : String(err);
        logger.error("[useFKPreviewData] Failed to fetch FK preview:", err);
        setError(message);
        setData(null);
        setColumns([]);
      } finally {
        if (!abortControllerRef.current?.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void fetchData();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [enabled, connectionId, database, schema, table, pkColumn, pkValue, embeddedFKs]);

  return {
    data,
    columns,
    isLoading,
    error,
  };
}
