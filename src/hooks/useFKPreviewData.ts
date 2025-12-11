import { useState, useEffect, useRef } from "react";
import { BackendAPI, type CellValue, type QueryColumnMeta } from "@/services/backend";
import { escapeSqlValue } from "@/utils/columnFilters";
import { logger } from "@/lib/logger";

interface FKPreviewDataParams {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  pkColumn: string;
  pkValue: unknown;
  enabled?: boolean;
}

interface FKPreviewDataResult {
  data: Record<string, CellValue> | null;
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

const fkPreviewCache = new LRUCache<string, { data: Record<string, CellValue>; columns: QueryColumnMeta[] }>(50);

function buildCacheKey(
  connectionId: string,
  schema: string,
  table: string,
  pkColumn: string,
  pkValue: unknown,
): string {
  return `${connectionId}:${schema}.${table}.${pkColumn}=${JSON.stringify(pkValue)}`;
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
  } = params;

  const [data, setData] = useState<Record<string, CellValue> | null>(null);
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

    const cacheKey = buildCacheKey(connectionId, schema, table, pkColumn, pkValue);

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
        const escapedValue = escapeSqlValue(pkValue);
        const sql = `SELECT * FROM "${schema}"."${table}" WHERE "${pkColumn}" = ${escapedValue} LIMIT 1`;

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

        const rowData: Record<string, CellValue> = {};
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
  }, [enabled, connectionId, database, schema, table, pkColumn, pkValue]);

  return {
    data,
    columns,
    isLoading,
    error,
  };
}

export function clearFKPreviewCache(): void {
  fkPreviewCache.clear();
}
