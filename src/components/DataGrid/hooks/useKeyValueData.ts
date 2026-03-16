/**
 * useKeyValueData - Redis data hook for the unified DataGrid
 *
 * Provides:
 * - Key selection and data fetching
 * - Type-aware column/row mapping for all Redis types
 * - TTL management
 * - CRUD command creation for the staging pipeline
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import type { GridCell, Item } from "@glideapps/glide-data-grid";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { nanoid } from "nanoid";
import type {
  GridColumnV2,
  GridRowModel,
  GridEditCommitEvent,
  CrudCommandFactory,
  GridCellContentContext,
} from "../types";
import type { KeyValueDataHookResult, KeyMetadata } from "../sources/types";
import type {
  CrudCommand,
  DataUpdatePayload,
  DataInsertPayload,
  DataDeletePayload,
  JsonValue,
} from "@/types/crud";
import type { CellValue } from "@/types";
import { RedisAdapter } from "@/adapters/redis/RedisAdapter";
import {
  getColumnsForRedisType,
  mapRedisDataToRows,
  buildKeyValueCell,
  getRedisRowKey,
} from "../utils/keyvalueCellFactory";
import {
  type KeyValueFilter,
  applyKeyValueSearch,
  applyKeyValuePattern,
} from "@/utils/keyvalueFilterParser";
import { logger } from "@/lib/logger";

// ============================================================================
// Types
// ============================================================================

export interface UseKeyValueDataParams {
  connectionId: string;
  database: number; // Redis DB index
  initialKey?: string;
  pattern?: string; // Pattern for browser mode (e.g., "prefix:*")
  enabled?: boolean;
  /** Filter for client-side filtering in key view mode */
  filter?: KeyValueFilter;
}

// Browser mode columns (when viewing list of keys): Key, Type, Value, TTL
const BROWSER_COLUMNS: GridColumnV2[] = [
  {
    id: "key",
    field: "col_0",
    title: "Key",
    name: "key",
    width: 300,
    type: "string",
  },
  {
    id: "type",
    field: "col_1",
    title: "Type",
    name: "type",
    width: 80,
    type: "string",
  },
  {
    id: "value",
    field: "col_2",
    title: "Value",
    name: "value",
    width: 400,
    type: "string",
  },
  {
    id: "ttl",
    field: "col_3",
    title: "TTL",
    name: "ttl",
    width: 100,
    type: "string",
  },
];

// Helper to create CellValue for browser mode
function createBrowserCellValue(
  value: unknown,
  dbType: string,
  redisType?: string,
): CellValue {
  const isJson = ["hash", "list", "set", "zset", "stream"].includes(
    redisType || "",
  );
  return {
    value,
    db_type: dbType,
    value_type: isJson ? "Json" : "Text",
    is_truncated: false,
    metadata: redisType ? { attributes: { redisType } } : undefined,
  };
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useKeyValueData(
  params: UseKeyValueDataParams,
): KeyValueDataHookResult {
  const {
    connectionId,
    database,
    initialKey,
    pattern: initialPattern = "*",
    enabled = true,
    filter,
  } = params;

  const adapterRef = useRef<RedisAdapter | null>(null);

  // State
  const [currentKey, setCurrentKey] = useState<KeyMetadata | null>(null);
  const [selectedKeyName, setSelectedKeyName] = useState<string | undefined>(
    initialKey,
  );
  const [pattern, setPatternState] = useState<string>(initialPattern);
  const [totalKeyCount, setTotalKeyCount] = useState<number | undefined>(
    undefined,
  );
  const [executionTime, setExecutionTime] = useState<number | undefined>(
    undefined,
  );

  // Browser mode: when no initialKey, show list of keys
  const isBrowserMode = !initialKey && !selectedKeyName;

  // Browser mode value search (client-side filter on loaded previews)
  const [valueFilter, setValueFilterState] = useState<string>("");

  // Pattern setter with refetch
  const setPattern = useCallback((newPattern: string) => {
    setPatternState(newPattern || "*");
  }, []);

  const setValueFilter = useCallback((filter: string) => {
    setValueFilterState(filter);
  }, []);

  // Get or create adapter
  const getAdapter = useCallback(() => {
    if (!adapterRef.current) {
      adapterRef.current = new RedisAdapter(connectionId);
    }
    return adapterRef.current;
  }, [connectionId]);

  const getAdapterWithDb = useCallback(async () => {
    const adapter = getAdapter();
    if (adapter.getCurrentDatabase() !== database) {
      await adapter.selectDatabase(database);
    }
    return adapter;
  }, [getAdapter, database]);

  // Browser mode page size for SCAN
  const BROWSER_PAGE_SIZE = 200;

  // Browser mode: fetch list of keys with infinite scroll
  const browserQueryKey = useMemo(
    () => ["redis-keys-browser", connectionId, database, pattern],
    [connectionId, database, pattern],
  );

  // Type for browser page data
  type BrowserKeyInfo = {
    key: string;
    type: string;
    ttl: number;
    value: string;
  };
  type BrowserPage = { keys: BrowserKeyInfo[]; nextCursor: string };

  const {
    data: browserData,
    isLoading: isLoadingBrowser,
    isFetchingNextPage: isFetchingNextBrowserPage,
    error: browserError,
    refetch: refetchBrowser,
    fetchNextPage: fetchNextBrowserPage,
    hasNextPage: hasNextBrowserPage,
  } = useInfiniteQuery<BrowserPage>({
    queryKey: browserQueryKey,
    queryFn: async ({ pageParam }): Promise<BrowserPage> => {
      const cursor = pageParam as string;
      const startTime = performance.now();
      try {
        // Ensure database is selected before scanning
        const adapter = await getAdapterWithDb();

        // Get total key count for this database (only on first page)
        if (cursor === "0") {
          const dbSize = await adapter.getDatabaseSize();
          setTotalKeyCount(dbSize);
        }

        // Scan keys with pattern and fetch value previews in a single IPC call
        const result = await adapter.scanKeysWithPreviews(
          pattern,
          cursor,
          BROWSER_PAGE_SIZE,
        );

        if (result.keys.length === 0) {
          return { keys: [], nextCursor: result.cursor };
        }

        logger.info(
          "redis-browser",
          `Scanned ${result.keys.length} keys with previews (cursor: ${cursor} → ${result.cursor})`,
        );

        const keysWithValues = result.keys.map((keyInfo) => ({
          key: keyInfo.key,
          type: keyInfo.keyType || "unknown",
          ttl: keyInfo.ttl ?? -1,
          value: keyInfo.preview,
        }));

        return { keys: keysWithValues, nextCursor: result.cursor };
      } finally {
        const endTime = performance.now();
        setExecutionTime(Math.round(endTime - startTime));
      }
    },
    initialPageParam: "0",
    getNextPageParam: (lastPage) => {
      // Redis SCAN returns '0' when iteration is complete
      return lastPage.nextCursor !== "0" ? lastPage.nextCursor : undefined;
    },
    enabled: enabled && !!connectionId && isBrowserMode,
    staleTime: 10000, // 10 seconds
    maxPages: 10000, // Cap retained pages to prevent unbounded memory growth
  });

  // Flatten browser pages into single array
  const browserKeys = useMemo(() => {
    if (!browserData?.pages) return undefined;
    return browserData.pages.flatMap((page) => page.keys);
  }, [browserData]);

  // Number of keys loaded from server (before client-side value filter)
  const loadedKeyCount = browserKeys?.length ?? 0;

  // Query key for key metadata
  const metadataQueryKey = useMemo(
    () => ["redis-key-metadata", connectionId, database, selectedKeyName],
    [connectionId, database, selectedKeyName],
  );

  // Fetch key metadata (type, TTL, size)
  const {
    data: keyMetadata,
    isLoading: isLoadingMetadata,
    error: metadataError,
    refetch: refetchMetadata,
  } = useQuery({
    queryKey: metadataQueryKey,
    queryFn: async (): Promise<KeyMetadata | null> => {
      if (!selectedKeyName) {
        return null;
      }

      const adapter = await getAdapterWithDb();

      const [type, ttl] = await Promise.all([
        adapter.getKeyType(selectedKeyName),
        adapter.getKeyTTL(selectedKeyName),
      ]);

      // Get size based on type
      let size: number | undefined;
      try {
        if (type === "string") {
          const value = await adapter.getKey(selectedKeyName);
          size =
            value &&
            typeof value === "object" &&
            "type" in value &&
            value.type === "string"
              ? value.value.length
              : undefined;
        } else if (type === "list") {
          size = await adapter.listLen(selectedKeyName);
        } else if (type === "stream") {
          size = await adapter.streamLen(selectedKeyName);
        }
      } catch {
        // Size is optional, ignore errors
      }

      return {
        key: selectedKeyName,
        type,
        ttl,
        size,
      };
    },
    enabled: enabled && !!connectionId && !!selectedKeyName,
    staleTime: 10000, // 10 seconds
  });

  // Update currentKey when metadata changes
  useEffect(() => {
    setCurrentKey(keyMetadata || null);
  }, [keyMetadata]);

  // Query key for key data
  const dataQueryKey = useMemo(
    () => [
      "redis-key-data",
      connectionId,
      database,
      selectedKeyName,
      currentKey?.type,
    ],
    [connectionId, database, selectedKeyName, currentKey?.type],
  );

  // Fetch key data based on type
  const {
    data: rawData,
    isLoading: isLoadingData,
    error: dataError,
    refetch: refetchData,
  } = useQuery({
    queryKey: dataQueryKey,
    queryFn: async () => {
      if (!selectedKeyName || !currentKey) {
        return null;
      }

      const startTime = performance.now();
      try {
        const adapter = await getAdapterWithDb();
        const type = currentKey.type;

        switch (type) {
          case "string": {
            const value = await adapter.getKey(selectedKeyName);
            if (
              value &&
              typeof value === "object" &&
              "type" in value &&
              value.type === "string"
            ) {
              return value.value;
            }
            return null;
          }

          case "hash":
            return adapter.hashGetAll(selectedKeyName);

          case "list":
            // Fetch all list items (could paginate for large lists)
            return adapter.listRange(selectedKeyName, 0, -1);

          case "set":
            return adapter.setMembers(selectedKeyName);

          case "zset":
            // Fetch all zset members with scores
            return adapter.zsetRange(selectedKeyName, 0, -1, true);

          case "stream":
            // Fetch stream entries
            return adapter.streamRange(selectedKeyName, "-", "+", 100);

          default:
            return null;
        }
      } finally {
        const endTime = performance.now();
        setExecutionTime(Math.round(endTime - startTime));
      }
    },
    enabled:
      enabled && !!connectionId && !!selectedKeyName && !!currentKey?.type,
    staleTime: 10000, // 10 seconds
  });

  // Get columns based on current key type or browser mode
  const columns = useMemo<GridColumnV2[]>(() => {
    if (isBrowserMode) {
      return BROWSER_COLUMNS;
    }
    if (!currentKey) {
      return [];
    }
    return getColumnsForRedisType(currentKey.type);
  }, [currentKey, isBrowserMode]);

  // Transform data to rows (with optional client-side filtering)
  const rows = useMemo<GridRowModel[]>(() => {
    let result: GridRowModel[];

    // Browser mode: show list of keys (Key, Type, Value, TTL)
    if (isBrowserMode && browserKeys) {
      // Apply client-side value filter before mapping to rows
      let filteredKeys = browserKeys;
      if (valueFilter) {
        const search = valueFilter.toLowerCase();
        filteredKeys = browserKeys.filter(
          (keyInfo) =>
            keyInfo.key.toLowerCase().includes(search) ||
            keyInfo.value.toLowerCase().includes(search),
        );
      }

      result = filteredKeys.map((keyInfo) => ({
        col_0: createBrowserCellValue(keyInfo.key, "text"),
        col_1: createBrowserCellValue(keyInfo.type, "text"),
        col_2: createBrowserCellValue(keyInfo.value, "json", keyInfo.type),
        col_3: createBrowserCellValue(keyInfo.ttl, "integer"),
      }));
    } else if (!currentKey || rawData === null || rawData === undefined) {
      return [];
    } else {
      result = mapRedisDataToRows(rawData, currentKey.type);
    }

    // Apply client-side filtering if filter is set (only in key view mode)
    if (filter && !isBrowserMode) {
      switch (filter.mode) {
        case "search":
          if (filter.searchText) {
            result = applyKeyValueSearch(result, filter.searchText);
          }
          break;
        case "pattern":
          if (filter.pattern) {
            // For pattern mode, filter by the first column (field/member name)
            result = applyKeyValuePattern(result, filter.pattern, "col_0");
          }
          break;
      }
    }

    return result;
  }, [currentKey, rawData, isBrowserMode, browserKeys, filter, valueFilter]);

  // Get cell content for grid
  const getCellContent = useCallback(
    (cell: Item, context?: GridCellContentContext): GridCell => {
      const [colIndex, rowIndex] = cell;
      const column = context?.column ?? columns[colIndex];
      const row = context?.row ?? rows[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: false,
          readonly: true,
        };
      }

      const cellValue = row[column.field];
      const isInsertedRow = Boolean(row["__insert_temp_id__"]);

      // Browser mode: use custom cells with proper renderers
      if (isBrowserMode) {
        const rawValue =
          cellValue && typeof cellValue === "object" && "value" in cellValue
            ? (cellValue as { value: unknown }).value
            : cellValue;
        const strValue =
          rawValue === null || rawValue === undefined ? "" : String(rawValue);

        // Get row type for editability decisions
        const typeCell = row["col_1"];
        const rowType =
          typeCell && typeof typeCell === "object" && "value" in typeCell
            ? String((typeCell as { value: unknown }).value)
            : "unknown";

        // Key column (col_0): text-single-cell
        if (column.field === "col_0") {
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "text-single-cell",
              value: strValue,
              nullable: false,
              columnName: "Key",
              dbType: "text",
            },
            copyData: strValue,
            allowOverlay: true,
            readonly: !isInsertedRow,
          };
        }

        // Type column (col_1): text-single-cell
        if (column.field === "col_1") {
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "text-single-cell",
              value: strValue,
              nullable: false,
              columnName: "Type",
              dbType: "text",
            },
            copyData: strValue,
            allowOverlay: true,
            readonly: true,
          };
        }

        // Value column (col_2): json-cell for complex types, text for string
        if (column.field === "col_2") {
          // Get redis type from metadata.attributes
          const cellMetadata =
            cellValue &&
            typeof cellValue === "object" &&
            "metadata" in cellValue
              ? (
                  cellValue as {
                    metadata?: { attributes?: { redisType?: string } };
                  }
                ).metadata
              : undefined;
          const redisType = cellMetadata?.attributes?.redisType || "string";

          // Use json-cell for hash, list, set, zset, stream
          if (["hash", "list", "set", "zset", "stream"].includes(redisType)) {
            return {
              kind: GridCellKind.Custom,
              data: {
                kind: "json-cell",
                value: strValue,
                nullable: false,
                isValid: true,
                columnName: "Value",
                dbType: "json",
              },
              copyData: strValue,
              allowOverlay: true,
              readonly: true,
            };
          }

          // Use text-multi-cell for long strings, text-single-cell for short
          const isLongText = strValue.length > 100 || strValue.includes("\n");
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: isLongText ? "text-multi-cell" : "text-single-cell",
              value: strValue,
              nullable: false,
              columnName: "Value",
              dbType: "text",
            },
            copyData: strValue,
            allowOverlay: true,
            readonly: rowType !== "string",
          };
        }

        // TTL column (col_3): editable, shows raw seconds (-1 = no expiry)
        if (column.field === "col_3") {
          const ttlNum =
            typeof rawValue === "number"
              ? rawValue
              : parseInt(String(rawValue), 10);
          const displayStr =
            ttlNum === -1 ? "-1" : ttlNum === -2 ? "N/A" : String(ttlNum);
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "text-single-cell",
              value: displayStr,
              nullable: false,
              columnName: "TTL (seconds)",
              dbType: "integer",
            },
            copyData: displayStr,
            allowOverlay: true,
            readonly: false,
          };
        }

        // Fallback to text cell
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "text-single-cell",
            value: strValue,
            nullable: false,
            columnName: column.title || column.id,
            dbType: "text",
          },
          copyData: strValue,
          allowOverlay: true,
          readonly: true,
        };
      }

      // Debug logging for key view mode cell content
      logger.info("keyvalue-data", "getCellContent (key view mode)", {
        cell: [colIndex, rowIndex],
        columnField: column.field,
        columnTitle: column.title,
        keyType: currentKey?.type,
        cellValueType: typeof cellValue,
        cellValueIsObject: typeof cellValue === "object" && cellValue !== null,
        cellValueHasValue:
          cellValue && typeof cellValue === "object" && "value" in cellValue,
        actualValue:
          cellValue && typeof cellValue === "object" && "value" in cellValue
            ? String((cellValue as { value: unknown }).value).slice(0, 100)
            : String(cellValue).slice(0, 100),
      });

      return buildKeyValueCell({
        value: cellValue,
        column,
        readOnly: false,
        allowPrimaryKeyEdit: isInsertedRow,
        keyType: currentKey?.type,
      });
    },
    [columns, rows, currentKey, isBrowserMode],
  );

  // Key selection
  const selectKey = useCallback(async (key: string): Promise<void> => {
    setSelectedKeyName(key);
    logger.info("keyvalue-data", `Selected key: ${key}`);
  }, []);

  const clearSelection = useCallback((): void => {
    setSelectedKeyName(undefined);
    setCurrentKey(null);
    logger.info("keyvalue-data", "Cleared key selection");
  }, []);

  // TTL management
  const setKeyTTL = useCallback(
    async (seconds: number): Promise<void> => {
      if (!selectedKeyName) {
        return;
      }

      const adapter = await getAdapterWithDb();
      await adapter.setKeyTTL(selectedKeyName, seconds);

      // Refresh metadata
      await refetchMetadata();

      logger.info(
        "keyvalue-data",
        `Set TTL for ${selectedKeyName}: ${seconds}s`,
      );
    },
    [selectedKeyName, getAdapter, refetchMetadata],
  );

  // Delete current key
  const deleteCurrentKey = useCallback(async (): Promise<void> => {
    if (!selectedKeyName) {
      return;
    }

    const adapter = await getAdapterWithDb();
    await adapter.deleteKeys([selectedKeyName]);

    // Clear selection
    clearSelection();

    logger.info("keyvalue-data", `Deleted key: ${selectedKeyName}`);
  }, [selectedKeyName, getAdapter, clearSelection]);

  // Pagination - browser mode uses cursor-based SCAN pagination
  const hasMore = isBrowserMode ? (hasNextBrowserPage ?? false) : false;

  const fetchNextPage = useCallback(async (): Promise<void> => {
    if (isBrowserMode && hasNextBrowserPage) {
      await fetchNextBrowserPage();
    }
    // Key view mode: Redis types are typically fetched all at once
    // Could implement cursor-based pagination for large lists/streams in future
  }, [isBrowserMode, hasNextBrowserPage, fetchNextBrowserPage]);

  const refetch = useCallback(async (): Promise<void> => {
    if (isBrowserMode) {
      await refetchBrowser();
    } else {
      await Promise.all([refetchMetadata(), refetchData()]);
    }
  }, [refetchMetadata, refetchData, refetchBrowser, isBrowserMode]);

  // Auto-load all keys when value filter is active
  // If totalKeyCount < 5000: auto-load remaining pages
  // If >= 5000: user must trigger loadAllKeys manually
  const AUTO_LOAD_THRESHOLD = 5000;
  const [loadAllRequested, setLoadAllRequested] = useState(false);

  const shouldAutoLoad =
    isBrowserMode &&
    !!valueFilter &&
    hasMore &&
    !isFetchingNextBrowserPage &&
    ((totalKeyCount !== undefined && totalKeyCount < AUTO_LOAD_THRESHOLD) ||
      loadAllRequested);

  // Whether all keys are loaded (no more pages to fetch)
  const allKeysLoaded = isBrowserMode && !hasMore;
  // Whether we should show "Search all" button
  const showLoadAll =
    isBrowserMode &&
    !!valueFilter &&
    hasMore &&
    !loadAllRequested &&
    totalKeyCount !== undefined &&
    totalKeyCount >= AUTO_LOAD_THRESHOLD;

  const loadAllKeys = useCallback(() => {
    setLoadAllRequested(true);
  }, []);

  // Reset loadAllRequested when value filter is cleared
  useEffect(() => {
    if (!valueFilter) {
      setLoadAllRequested(false);
    }
  }, [valueFilter]);

  // Stabilize fetchNextBrowserPage ref to avoid effect re-triggers
  const fetchNextBrowserPageRef = useRef(fetchNextBrowserPage);
  useEffect(() => {
    fetchNextBrowserPageRef.current = fetchNextBrowserPage;
  });

  // Progressive auto-load effect with cancellation
  useEffect(() => {
    let cancelled = false;

    const loadNext = async () => {
      if (shouldAutoLoad && !cancelled) {
        await fetchNextBrowserPageRef.current();
      }
    };

    void loadNext();

    return () => {
      cancelled = true;
    };
  }, [shouldAutoLoad]);

  // CRUD helpers
  const createEditCommand = useCallback(
    (event: GridEditCommitEvent): CrudCommand | null => {
      logger.info("keyvalue-data", "createEditCommand called", {
        hasCurrentKey: !!currentKey,
        currentKeyType: currentKey?.type,
        selectedKeyName,
        columnField: event.column?.field,
        hasRowData: !!event.row,
      });

      if (!currentKey || !selectedKeyName) {
        logger.warn(
          "keyvalue-data",
          "createEditCommand: missing currentKey or selectedKeyName",
          {
            currentKey,
            selectedKeyName,
          },
        );
        return null;
      }

      const { column, row: rowData, newValue } = event;

      if (!rowData) {
        logger.warn("keyvalue-data", "createEditCommand: missing rowData");
        return null;
      }

      const tempIdCell = rowData["__insert_temp_id__"] as
        | CellValue
        | null
        | undefined;
      const insertTempId = tempIdCell?.value
        ? String(tempIdCell.value)
        : undefined;
      const isInsertedRow = Boolean(insertTempId);

      if (currentKey.type === "stream") {
        logger.info("keyvalue-data", "createEditCommand: type not editable", {
          type: currentKey.type,
        });
        return null;
      }

      if (currentKey.type === "set" && !isInsertedRow) {
        // Existing set members are not editable (Redis has no in-place member update).
        logger.info("keyvalue-data", "createEditCommand: type not editable", {
          type: currentKey.type,
        });
        return null;
      }

      if (currentKey.type === "zset" && column.field !== "score" && !isInsertedRow) {
        logger.info(
          "keyvalue-data",
          "createEditCommand: zset only score editable",
        );
        return null;
      }

      const rowKey = getRedisRowKey(rowData, currentKey.type);
      const updateColumn =
        currentKey.type === "hash"
          ? isInsertedRow
            ? column.field
            : String((rowKey as { field?: unknown }).field ?? column.field)
          : column.field;

      // Extract old value
      const cellValue = rowData[column.field];
      const extractedOldValue =
        cellValue && typeof cellValue === "object" && "value" in cellValue
          ? cellValue.value
          : cellValue;
      const oldValueJson: JsonValue =
        extractedOldValue === undefined
          ? null
          : (extractedOldValue as JsonValue);

      // Extract new value from GridCell
      let newValueJson: JsonValue = null;
      if ("data" in newValue) {
        const data = newValue.data;
        if (typeof data === "object" && data !== null && "value" in data) {
          newValueJson = (data as { value: unknown }).value as JsonValue;
        } else if (
          typeof data === "string" ||
          typeof data === "number" ||
          typeof data === "boolean" ||
          data === null
        ) {
          newValueJson = data;
        }
      }

      const payload: DataUpdatePayload = {
        column: updateColumn,
        redisType: currentKey.type,
        primaryKeys: insertTempId ? {} : { key: selectedKeyName, ...rowKey },
        oldValue: oldValueJson,
        newValue: newValueJson,
        ...(insertTempId ? { tempId: insertTempId } : {}),
      };

      const command: CrudCommand = {
        id: nanoid(),
        type: "data.update",
        target: {
          connectionId,
          database: String(database),
          table: selectedKeyName,
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: `Update ${currentKey.type} field`,
        },
        state: "staged",
      };

      logger.info("keyvalue-data", "createEditCommand: created command", {
        id: command.id,
        type: command.type,
        column: payload.column,
        oldValue: payload.oldValue,
        newValue: payload.newValue,
      });

      return command;
    },
    [currentKey, selectedKeyName, connectionId, database],
  );

  const createInsertCommand = useCallback(
    (values: Record<string, unknown>): CrudCommand => {
      const keyType = currentKey?.type ?? "string";
      const insertValues: Record<string, JsonValue> = {};
      const tempId = nanoid();
      const readValue = (
        source: Record<string, unknown>,
        ...keys: string[]
      ): unknown => {
        for (const key of keys) {
          if (key in source) return source[key];
        }
        return undefined;
      };

      switch (keyType) {
        case "hash": {
          const field = readValue(values, "field", "Field");
          const value = readValue(values, "value", "Value");
          insertValues.field =
            field === undefined || field === null ? "" : String(field);
          insertValues.value = (value ?? "") as JsonValue;
          break;
        }
        case "list": {
          const value = readValue(values, "value", "Value");
          insertValues.value = (value ?? "") as JsonValue;
          break;
        }
        case "set": {
          const member = readValue(values, "member", "Member");
          insertValues.member =
            member === undefined || member === null ? "" : String(member);
          break;
        }
        case "zset": {
          const member = readValue(values, "member", "Member");
          const score = readValue(values, "score", "Score");
          insertValues.member =
            member === undefined || member === null ? "" : String(member);
          insertValues.score = (score ?? 0) as JsonValue;
          break;
        }
        case "stream":
          break;
        case "string":
        case "unknown":
        default:
          insertValues.value =
            (readValue(values, "value", "Value") ?? "") as JsonValue;
          break;
      }

      // Convert values to JsonValue record
      const payload: DataInsertPayload & {
        redisType?: string;
        tempId?: string;
      } = {
        values: insertValues,
        redisType: keyType,
        tempId,
      };

      return {
        id: nanoid(),
        type: "data.insert",
        target: {
          connectionId,
          database: String(database),
          table: selectedKeyName || "",
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: `Insert ${currentKey?.type || "key"} value`,
        },
        state: "staged",
      };
    },
    [connectionId, database, selectedKeyName, currentKey],
  );

  const createDeleteCommand = useCallback(
    (row: GridRowModel): CrudCommand => {
      const rowKey = currentKey ? getRedisRowKey(row, currentKey.type) : {};

      const payload: DataDeletePayload & { redisType?: string } = {
        primaryKeys: { key: selectedKeyName || "", ...rowKey },
        redisType: currentKey?.type,
      };

      return {
        id: nanoid(),
        type: "data.delete",
        target: {
          connectionId,
          database: String(database),
          table: selectedKeyName || "",
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: `Delete ${currentKey?.type || "key"} value`,
        },
        state: "staged",
      };
    },
    [connectionId, database, selectedKeyName, currentKey],
  );

  // Build column maps for CrudCommandFactory
  const columnNameToFieldMap = useMemo(() => {
    const map = new Map<string, string>();
    columns.forEach((col) => {
      map.set(col.name, col.field);
    });
    return map;
  }, [columns]);

  const columnByFieldMap = useMemo(() => {
    const map = new Map<string, GridColumnV2>();
    columns.forEach((col) => {
      map.set(col.field, col);
    });
    return map;
  }, [columns]);

  // Get row key for Redis data
  const getRowKeyForFactory = useCallback(
    (row: GridRowModel | undefined, index: number): string => {
      if (!row || !currentKey) return `row-${index}`;
      const rowKeyObj = getRedisRowKey(row, currentKey.type);

      // For hash: use field name
      if (currentKey.type === "hash" && "field" in rowKeyObj) {
        return `${selectedKeyName}:field:${rowKeyObj.field}`;
      }
      // For list: use index
      if (currentKey.type === "list" && "index" in rowKeyObj) {
        return `${selectedKeyName}:index:${rowKeyObj.index}`;
      }
      // For set: use member value
      if (currentKey.type === "set" && "member" in rowKeyObj) {
        return `${selectedKeyName}:member:${rowKeyObj.member}`;
      }
      // For zset: use member value
      if (currentKey.type === "zset" && "member" in rowKeyObj) {
        return `${selectedKeyName}:member:${rowKeyObj.member}`;
      }
      return `${selectedKeyName}:row-${index}`;
    },
    [currentKey, selectedKeyName],
  );

  // Helper to extract raw value from a CellValue wrapper
  const extractCellRaw = useCallback((cell: unknown): unknown => {
    return cell && typeof cell === "object" && "value" in cell
      ? (cell as { value: unknown }).value
      : cell;
  }, []);

  // CrudCommandFactory for BaseDataGrid integration
  const commandFactory = useMemo<CrudCommandFactory | undefined>(() => {
    // ===== Browser mode factory: edit string values, TTL, delete keys =====
    if (isBrowserMode) {
      const browserTable = `db${database}_keys`;
      return {
        connectionId,
        database: String(database),
        schema: "",
        table: browserTable,
        primaryKeyColumns: ["key"],
        columnNameToFieldMap,
        columnByFieldMap,
        getRowKey: (row: GridRowModel | undefined, index: number): string => {
          if (!row) return `browser-row-${index}`;
          const keyName = extractCellRaw(row["col_0"]);
          return keyName
            ? `browser:${String(keyName)}`
            : `browser-row-${index}`;
        },

        createEditCommand: (event: GridEditCommitEvent): CrudCommand | null => {
          const { column, row: rowData, newValue } = event;
          if (!rowData) return null;

          const keyNameRaw = extractCellRaw(rowData["col_0"]);
          const keyName =
            keyNameRaw === null || keyNameRaw === undefined
              ? ""
              : String(keyNameRaw);
          const rowType = String(extractCellRaw(rowData["col_1"]) ?? "unknown");
          const tempIdRaw = extractCellRaw(rowData["__insert_temp_id__"]);
          const insertTempId =
            tempIdRaw === null || tempIdRaw === undefined
              ? undefined
              : String(tempIdRaw);
          const isInsertedRow = Boolean(insertTempId);

          // Extract new value from GridCell
          let newValueRaw: unknown = null;
          if ("data" in newValue) {
            const d = newValue.data;
            if (typeof d === "object" && d !== null && "value" in d) {
              newValueRaw = (d as { value: unknown }).value;
            } else if (
              typeof d === "string" ||
              typeof d === "number" ||
              typeof d === "boolean" ||
              d === null
            ) {
              newValueRaw = d;
            }
          }

          // Key edit (col_0) — only for inserted rows
          if (column.field === "col_0") {
            if (!isInsertedRow) return null;
            return {
              id: nanoid(),
              type: "data.update",
              target: {
                connectionId,
                database: String(database),
                table: browserTable,
              },
              payload: {
                column: "key",
                primaryKeys: {},
                oldValue: (keyNameRaw ?? null) as JsonValue,
                newValue: (newValueRaw ?? null) as JsonValue,
                redisType: "string",
                tempId: insertTempId,
              },
              metadata: {
                timestamp: new Date().toISOString(),
                description: "Set key name",
              },
              state: "staged",
            };
          }

          // Value edit (col_2) — only for string-type keys
          if (column.field === "col_2") {
            if (rowType !== "string") return null;
            if (!isInsertedRow && !keyName) return null;
            const oldValue = extractCellRaw(rowData["col_2"]);
            return {
              id: nanoid(),
              type: "data.update",
              target: {
                connectionId,
                database: String(database),
                table: browserTable,
              },
              payload: {
                column: "value",
                primaryKeys: isInsertedRow ? {} : { key: keyName },
                oldValue: (oldValue ?? null) as JsonValue,
                newValue: (newValueRaw ?? null) as JsonValue,
                redisType: "string",
                ...(isInsertedRow ? { tempId: insertTempId } : {}),
              },
              metadata: {
                timestamp: new Date().toISOString(),
                description: `SET ${keyName}`,
              },
              state: "staged",
            };
          }

          // TTL edit (col_3)
          if (column.field === "col_3") {
            if (!isInsertedRow && !keyName) return null;
            const oldTtl = extractCellRaw(rowData["col_3"]);
            const ttlStr = String(newValueRaw ?? "");
            const seconds = parseInt(ttlStr, 10);
            return {
              id: nanoid(),
              type: "data.update",
              target: {
                connectionId,
                database: String(database),
                table: browserTable,
              },
              payload: {
                column: "ttl",
                primaryKeys: isInsertedRow ? {} : { key: keyName },
                oldValue: (oldTtl ?? null) as JsonValue,
                newValue: (Number.isFinite(seconds)
                  ? seconds
                  : -1) as JsonValue,
                redisType: rowType,
                ...(isInsertedRow ? { tempId: insertTempId } : {}),
              },
              metadata: {
                timestamp: new Date().toISOString(),
                description:
                  Number.isFinite(seconds) && seconds > 0
                    ? `EXPIRE ${keyName} ${seconds}`
                    : `PERSIST ${keyName}`,
              },
              state: "staged",
            };
          }

          return null;
        },

        createInsertCommand: (_data?: Record<string, unknown>): CrudCommand => {
          const tempId = nanoid();
          return {
            id: nanoid(),
            type: "data.insert",
            target: { connectionId, database: String(database), table: browserTable },
            payload: {
              values: {
                key: "",
                type: "string",
                value: "",
                ttl: -1,
              },
              redisType: "string",
              tempId,
            },
            metadata: {
              timestamp: new Date().toISOString(),
              description: "New key",
            },
            state: "staged",
          };
        },

        createDeleteCommand: (
          row: GridRowModel,
          _rowKey: string,
        ): CrudCommand => {
          const keyName = String(extractCellRaw(row["col_0"]) ?? "");
          return {
            id: nanoid(),
            type: "data.delete",
            target: {
              connectionId,
              database: String(database),
              table: browserTable,
            },
            payload: { primaryKeys: { key: keyName } },
            metadata: {
              timestamp: new Date().toISOString(),
              description: `DEL ${keyName}`,
            },
            state: "staged",
          };
        },
      };
    }

    // ===== Key view mode factory: hash, list, set, zset =====
    if (!currentKey || !selectedKeyName) return undefined;
    // Streams are read-only, strings are single-value (no row-level CRUD)
    if (
      currentKey.type === "string" ||
      currentKey.type === "stream" ||
      currentKey.type === "unknown"
    ) {
      return undefined;
    }

    // Determine primary key columns based on Redis type
    const primaryKeyColumns: string[] = [];
    if (currentKey.type === "hash") {
      primaryKeyColumns.push("field");
    } else if (currentKey.type === "list") {
      primaryKeyColumns.push("index");
    } else if (currentKey.type === "set" || currentKey.type === "zset") {
      primaryKeyColumns.push("member");
    }

    return {
      connectionId,
      database: String(database),
      schema: "",
      table: selectedKeyName,
      primaryKeyColumns,
      columnNameToFieldMap,
      columnByFieldMap,
      getRowKey: getRowKeyForFactory,

      createEditCommand: (event: GridEditCommitEvent) => {
        return createEditCommand(event);
      },

      createInsertCommand: (data?: Record<string, unknown>) => {
        return createInsertCommand(data ?? {});
      },

      createDeleteCommand: (row: GridRowModel, _rowKey: string) => {
        return createDeleteCommand(row);
      },
    };
  }, [
    isBrowserMode,
    currentKey,
    selectedKeyName,
    connectionId,
    database,
    columnNameToFieldMap,
    columnByFieldMap,
    getRowKeyForFactory,
    createEditCommand,
    createInsertCommand,
    createDeleteCommand,
    extractCellRaw,
  ]);

  // Compute loading and error states based on mode
  // For browser mode, isLoading is true during initial load or when fetching next page
  const isLoading = isBrowserMode
    ? isLoadingBrowser || isFetchingNextBrowserPage
    : isLoadingMetadata || isLoadingData;
  const error = isBrowserMode ? browserError : metadataError || dataError;

  return {
    paradigm: "keyvalue",
    rows,
    columns,
    getCellContent,
    isLoading,
    error,
    hasMore,
    fetchNextPage,
    refetch,
    executionTime,
    currentKey,
    selectKey,
    clearSelection,
    setKeyTTL,
    deleteCurrentKey,
    createEditCommand,
    createTreeEditCommand: () => null,
    createInsertCommand,
    createDeleteCommand,
    commandFactory,
    isBrowserMode,
    pattern,
    setPattern,
    totalKeyCount,
    loadedKeyCount,
    valueFilter,
    setValueFilter,
    allKeysLoaded,
    showLoadAll,
    loadAllKeys,
  };
}
