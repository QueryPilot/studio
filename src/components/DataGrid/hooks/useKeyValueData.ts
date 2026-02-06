/**
 * useKeyValueData - Redis data hook for the unified DataGrid
 *
 * Provides:
 * - Key selection and data fetching
 * - Type-aware column/row mapping for all Redis types
 * - TTL management
 * - CRUD command creation for the staging pipeline
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import type { GridCell, Item } from '@glideapps/glide-data-grid';
import { GridCellKind } from '@glideapps/glide-data-grid';
import { nanoid } from 'nanoid';
import type { GridColumnV2, GridRowModel, GridEditCommitEvent, CrudCommandFactory } from '../types';
import type { KeyValueDataHookResult, KeyMetadata } from '../sources/types';
import type { CrudCommand, DataUpdatePayload, DataInsertPayload, DataDeletePayload, JsonValue } from '@/types/crud';
import type { CellValue } from '@/types';
import { RedisAdapter } from '@/adapters/redis/RedisAdapter';
import {
  getColumnsForRedisType,
  mapRedisDataToRows,
  buildKeyValueCell,
  getRedisRowKey,
} from '../utils/keyvalueCellFactory';
import {
  type KeyValueFilter,
  applyKeyValueSearch,
  applyKeyValuePattern,
} from '@/utils/keyvalueFilterParser';
import { logger } from '@/lib/logger';

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
  { id: 'key', field: 'col_0', title: 'Key', name: 'key', width: 300, type: 'string' },
  { id: 'type', field: 'col_1', title: 'Type', name: 'type', width: 80, type: 'string' },
  { id: 'value', field: 'col_2', title: 'Value', name: 'value', width: 400, type: 'string' },
  { id: 'ttl', field: 'col_3', title: 'TTL', name: 'ttl', width: 100, type: 'string' },
];

// Helper to create CellValue for browser mode
function createBrowserCellValue(value: unknown, dbType: string, redisType?: string): CellValue {
  const isJson = ['hash', 'list', 'set', 'zset', 'stream'].includes(redisType || '');
  return {
    value,
    db_type: dbType,
    value_type: isJson ? 'Json' : 'Text',
    is_truncated: false,
    metadata: redisType ? { attributes: { redisType } } : undefined,
  };
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useKeyValueData(params: UseKeyValueDataParams): KeyValueDataHookResult {
  const {
    connectionId,
    database,
    initialKey,
    pattern: initialPattern = '*',
    enabled = true,
    filter,
  } = params;

  const adapterRef = useRef<RedisAdapter | null>(null);

  // State
  const [currentKey, setCurrentKey] = useState<KeyMetadata | null>(null);
  const [selectedKeyName, setSelectedKeyName] = useState<string | undefined>(initialKey);
  const [pattern, setPatternState] = useState<string>(initialPattern);
  const [totalKeyCount, setTotalKeyCount] = useState<number | undefined>(undefined);
  const [executionTime, setExecutionTime] = useState<number | undefined>(undefined);

  // Browser mode: when no initialKey, show list of keys
  const isBrowserMode = !initialKey && !selectedKeyName;

  // Pattern setter with refetch
  const setPattern = useCallback((newPattern: string) => {
    setPatternState(newPattern || '*');
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
    () => ['redis-keys-browser', connectionId, database, pattern],
    [connectionId, database, pattern]
  );

  // Type for browser page data
  type BrowserKeyInfo = { key: string; type: string; ttl: number; value: string };
  type BrowserPage = { keys: BrowserKeyInfo[]; nextCursor: string };

  const {
    data: browserData,
    isLoading: isLoadingBrowser,
    isFetchingNextPage: isFetchingNextBrowserPage,
    error: browserError,
    refetch: refetchBrowser,
    fetchNextPage: fetchNextBrowserPage,
    hasNextPage: hasNextBrowserPage,
  } = useInfiniteQuery<BrowserPage, Error>({
    queryKey: browserQueryKey,
    queryFn: async ({ pageParam }): Promise<BrowserPage> => {
      const cursor = pageParam as string;
      const startTime = performance.now();
      try {
        // Ensure database is selected before scanning
        const adapter = await getAdapterWithDb();

        // Get total key count for this database (only on first page)
        if (cursor === '0') {
          const dbSize = await adapter.getDatabaseSize();
          setTotalKeyCount(dbSize);
        }

        // Scan keys with pattern and fetch value previews in a single IPC call
        const result = await adapter.scanKeysWithPreviews(pattern, cursor, BROWSER_PAGE_SIZE);

        if (result.keys.length === 0) {
          return { keys: [], nextCursor: result.cursor };
        }

        logger.info('redis-browser', `Scanned ${result.keys.length} keys with previews (cursor: ${cursor} → ${result.cursor})`);

        const keysWithValues = result.keys.map((keyInfo) => ({
          key: keyInfo.key,
          type: keyInfo.keyType || 'unknown',
          ttl: keyInfo.ttl ?? -1,
          value: keyInfo.preview,
        }));

        return { keys: keysWithValues, nextCursor: result.cursor };
      } finally {
        const endTime = performance.now();
        setExecutionTime(Math.round(endTime - startTime));
      }
    },
    initialPageParam: '0',
    getNextPageParam: (lastPage) => {
      // Redis SCAN returns '0' when iteration is complete
      return lastPage.nextCursor !== '0' ? lastPage.nextCursor : undefined;
    },
    enabled: enabled && !!connectionId && isBrowserMode,
    staleTime: 10000, // 10 seconds
  });

  // Flatten browser pages into single array
  const browserKeys = useMemo(() => {
    if (!browserData?.pages) return undefined;
    return browserData.pages.flatMap(page => page.keys);
  }, [browserData]);

  // Query key for key metadata
  const metadataQueryKey = useMemo(
    () => ['redis-key-metadata', connectionId, database, selectedKeyName],
    [connectionId, database, selectedKeyName]
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
        if (type === 'string') {
          const value = await adapter.getKey(selectedKeyName);
          size = value && typeof value === 'object' && 'type' in value && value.type === 'string'
            ? (value.value as string).length
            : undefined;
        } else if (type === 'list') {
          size = await adapter.listLen(selectedKeyName);
        } else if (type === 'stream') {
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
    () => ['redis-key-data', connectionId, database, selectedKeyName, currentKey?.type],
    [connectionId, database, selectedKeyName, currentKey?.type]
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
          case 'string': {
            const value = await adapter.getKey(selectedKeyName);
            if (value && typeof value === 'object' && 'type' in value && value.type === 'string') {
              return value.value as string;
            }
            return null;
          }

          case 'hash':
            return adapter.hashGetAll(selectedKeyName);

          case 'list':
            // Fetch all list items (could paginate for large lists)
            return adapter.listRange(selectedKeyName, 0, -1);

          case 'set':
            return adapter.setMembers(selectedKeyName);

          case 'zset':
            // Fetch all zset members with scores
            return adapter.zsetRange(selectedKeyName, 0, -1, true);

          case 'stream':
            // Fetch stream entries
            return adapter.streamRange(selectedKeyName, '-', '+', 100);

          default:
            return null;
        }
      } finally {
        const endTime = performance.now();
        setExecutionTime(Math.round(endTime - startTime));
      }
    },
    enabled: enabled && !!connectionId && !!selectedKeyName && !!currentKey?.type,
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
      result = browserKeys.map((keyInfo) => ({
        col_0: createBrowserCellValue(keyInfo.key, 'text'),
        col_1: createBrowserCellValue(keyInfo.type, 'text'),
        col_2: createBrowserCellValue(keyInfo.value, 'json', keyInfo.type),
        col_3: createBrowserCellValue(
          keyInfo.ttl === -1 ? 'No TTL' : keyInfo.ttl === -2 ? 'N/A' : `${keyInfo.ttl}s`,
          'text'
        ),
      }));
    } else if (!currentKey || rawData === null || rawData === undefined) {
      return [];
    } else {
      result = mapRedisDataToRows(rawData, currentKey.type);
    }

    // Apply client-side filtering if filter is set (only in key view mode)
    if (filter && !isBrowserMode) {
      switch (filter.mode) {
        case 'search':
          if (filter.searchText) {
            result = applyKeyValueSearch(result, filter.searchText);
          }
          break;
        case 'pattern':
          if (filter.pattern) {
            // For pattern mode, filter by the first column (field/member name)
            result = applyKeyValuePattern(result, filter.pattern, 'col_0');
          }
          break;
      }
    }

    return result;
  }, [currentKey, rawData, isBrowserMode, browserKeys, filter]);

  // Get cell content for grid
  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [colIndex, rowIndex] = cell;
      const column = columns[colIndex];
      const row = rows[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: '',
          displayData: '',
          allowOverlay: false,
          readonly: true,
        };
      }

      const cellValue = row[column.field];

      // Browser mode: use custom cells with proper renderers
      if (isBrowserMode) {
        const rawValue = cellValue && typeof cellValue === 'object' && 'value' in cellValue
          ? (cellValue as { value: unknown }).value
          : cellValue;
        const strValue = rawValue === null || rawValue === undefined ? '' : String(rawValue);

        // Key column (col_0): text-single-cell
        if (column.field === 'col_0') {
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: 'text-single-cell',
              value: strValue,
              nullable: false,
              columnName: 'Key',
              dbType: 'text',
            },
            copyData: strValue,
            allowOverlay: true,
            readonly: true,
          };
        }

        // Type column (col_1): text-single-cell
        if (column.field === 'col_1') {
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: 'text-single-cell',
              value: strValue,
              nullable: false,
              columnName: 'Type',
              dbType: 'text',
            },
            copyData: strValue,
            allowOverlay: true,
            readonly: true,
          };
        }

        // Value column (col_2): json-cell for complex types, text for string
        if (column.field === 'col_2') {
          // Get redis type from metadata.attributes
          const cellMetadata = cellValue && typeof cellValue === 'object' && 'metadata' in cellValue
            ? (cellValue as { metadata?: { attributes?: { redisType?: string } } }).metadata
            : undefined;
          const redisType = cellMetadata?.attributes?.redisType || 'string';

          // Use json-cell for hash, list, set, zset, stream
          if (['hash', 'list', 'set', 'zset', 'stream'].includes(redisType)) {
            return {
              kind: GridCellKind.Custom,
              data: {
                kind: 'json-cell',
                value: strValue,
                nullable: false,
                isValid: true,
                columnName: 'Value',
                dbType: 'json',
              },
              copyData: strValue,
              allowOverlay: true,
              readonly: true,
            };
          }

          // Use text-multi-cell for long strings, text-single-cell for short
          const isLongText = strValue.length > 100 || strValue.includes('\n');
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: isLongText ? 'text-multi-cell' : 'text-single-cell',
              value: strValue,
              nullable: false,
              columnName: 'Value',
              dbType: 'text',
            },
            copyData: strValue,
            allowOverlay: true,
            readonly: true,
          };
        }

        // TTL column (col_3): text-single-cell
        if (column.field === 'col_3') {
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: 'text-single-cell',
              value: strValue,
              nullable: false,
              columnName: 'TTL',
              dbType: 'text',
            },
            copyData: strValue,
            allowOverlay: true,
            readonly: true,
          };
        }

        // Fallback to text cell
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: 'text-single-cell',
            value: strValue,
            nullable: false,
            columnName: column.title || column.id,
            dbType: 'text',
          },
          copyData: strValue,
          allowOverlay: true,
          readonly: true,
        };
      }

      // Debug logging for key view mode cell content
      logger.info('keyvalue-data', 'getCellContent (key view mode)', {
        cell: [colIndex, rowIndex],
        columnField: column.field,
        columnTitle: column.title,
        keyType: currentKey?.type,
        cellValueType: typeof cellValue,
        cellValueIsObject: typeof cellValue === 'object' && cellValue !== null,
        cellValueHasValue: cellValue && typeof cellValue === 'object' && 'value' in cellValue,
        actualValue: cellValue && typeof cellValue === 'object' && 'value' in cellValue
          ? String((cellValue as { value: unknown }).value).slice(0, 100)
          : String(cellValue).slice(0, 100),
      });

      return buildKeyValueCell({
        value: cellValue,
        column,
        readOnly: false,
        keyType: currentKey?.type,
      });
    },
    [columns, rows, currentKey, isBrowserMode]
  );

  // Key selection
  const selectKey = useCallback(
    async (key: string): Promise<void> => {
      setSelectedKeyName(key);
      logger.info('keyvalue-data', `Selected key: ${key}`);
    },
    []
  );

  const clearSelection = useCallback((): void => {
    setSelectedKeyName(undefined);
    setCurrentKey(null);
    logger.info('keyvalue-data', 'Cleared key selection');
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

      logger.info('keyvalue-data', `Set TTL for ${selectedKeyName}: ${seconds}s`);
    },
    [selectedKeyName, getAdapter, refetchMetadata]
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

    logger.info('keyvalue-data', `Deleted key: ${selectedKeyName}`);
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

  // CRUD helpers
  const createEditCommand = useCallback(
    (event: GridEditCommitEvent): CrudCommand | null => {
      logger.info('keyvalue-data', 'createEditCommand called', {
        hasCurrentKey: !!currentKey,
        currentKeyType: currentKey?.type,
        selectedKeyName,
        columnField: event.column?.field,
        hasRowData: !!event.row,
      });

      if (!currentKey || !selectedKeyName) {
        logger.warn('keyvalue-data', 'createEditCommand: missing currentKey or selectedKeyName', {
          currentKey,
          selectedKeyName,
        });
        return null;
      }

      const { column, row: rowData, newValue } = event;

      if (!rowData) {
        logger.warn('keyvalue-data', 'createEditCommand: missing rowData');
        return null;
      }

      if (currentKey.type === 'list' || currentKey.type === 'set' || currentKey.type === 'stream') {
        logger.info('keyvalue-data', 'createEditCommand: type not editable', { type: currentKey.type });
        return null;
      }

      if (currentKey.type === 'zset' && column.field !== 'score') {
        logger.info('keyvalue-data', 'createEditCommand: zset only score editable');
        return null;
      }

      const rowKey = getRedisRowKey(rowData, currentKey.type);
      const updateColumn = currentKey.type === 'hash'
        ? String((rowKey as { field?: unknown }).field ?? column.field)
        : column.field;

      // Extract old value
      const cellValue = rowData[column.field];
      const extractedOldValue = cellValue && typeof cellValue === 'object' && 'value' in cellValue
        ? cellValue.value
        : cellValue;
      const oldValueJson: JsonValue = extractedOldValue === undefined ? null :
        (extractedOldValue as JsonValue);

      // Extract new value from GridCell
      let newValueJson: JsonValue = null;
      if ('data' in newValue) {
        const data = newValue.data;
        if (typeof data === 'object' && data !== null && 'value' in data) {
          newValueJson = (data as { value: unknown }).value as JsonValue;
        } else if (
          typeof data === 'string' ||
          typeof data === 'number' ||
          typeof data === 'boolean' ||
          data === null
        ) {
          newValueJson = data;
        }
      }

      const payload: DataUpdatePayload = {
        column: updateColumn,
        redisType: currentKey.type,
        primaryKeys: { key: selectedKeyName, ...rowKey },
        oldValue: oldValueJson,
        newValue: newValueJson,
      };

      const command: CrudCommand = {
        id: nanoid(),
        type: 'data.update',
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
        state: 'staged',
      };

      logger.info('keyvalue-data', 'createEditCommand: created command', {
        id: command.id,
        type: command.type,
        column: payload.column,
        oldValue: payload.oldValue,
        newValue: payload.newValue,
      });

      return command;
    },
    [currentKey, selectedKeyName, connectionId, database]
  );

  const createInsertCommand = useCallback(
    (values: Record<string, unknown>): CrudCommand => {
      const keyType = currentKey?.type ?? 'string';
      const insertValues: Record<string, JsonValue> = {};

      switch (keyType) {
        case 'hash': {
          const field = values.field;
          if (field !== undefined && field !== null && field !== '') {
            insertValues[String(field)] = (values.value ?? null) as JsonValue;
          }
          break;
        }
        case 'list':
          insertValues.value = (values.value ?? null) as JsonValue;
          break;
        case 'set':
          insertValues.member = (values.member ?? null) as JsonValue;
          break;
        case 'zset':
          insertValues.member = (values.member ?? null) as JsonValue;
          insertValues.score = (values.score ?? null) as JsonValue;
          break;
        case 'stream':
          break;
        case 'string':
        case 'unknown':
        default:
          insertValues.value = (values.value ?? null) as JsonValue;
          break;
      }

      // Convert values to JsonValue record
      const payload: DataInsertPayload & { redisType?: string } = {
        values: insertValues,
        redisType: keyType,
      };

      return {
        id: nanoid(),
        type: 'data.insert',
        target: {
          connectionId,
          database: String(database),
          table: selectedKeyName || '',
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: `Insert ${currentKey?.type || 'key'} value`,
        },
        state: 'staged',
      };
    },
    [connectionId, database, selectedKeyName, currentKey]
  );

  const createDeleteCommand = useCallback(
    (row: GridRowModel): CrudCommand => {
      const rowKey = currentKey ? getRedisRowKey(row, currentKey.type) : {};

      const payload: DataDeletePayload & { redisType?: string } = {
        primaryKeys: { key: selectedKeyName || '', ...rowKey },
        redisType: currentKey?.type,
      };

      return {
        id: nanoid(),
        type: 'data.delete',
        target: {
          connectionId,
          database: String(database),
          table: selectedKeyName || '',
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: `Delete ${currentKey?.type || 'key'} value`,
        },
        state: 'staged',
      };
    },
    [connectionId, database, selectedKeyName, currentKey]
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
      if (currentKey.type === 'hash' && 'field' in rowKeyObj) {
        return `${selectedKeyName}:field:${rowKeyObj.field}`;
      }
      // For list: use index
      if (currentKey.type === 'list' && 'index' in rowKeyObj) {
        return `${selectedKeyName}:index:${rowKeyObj.index}`;
      }
      // For set: use member value
      if (currentKey.type === 'set' && 'member' in rowKeyObj) {
        return `${selectedKeyName}:member:${rowKeyObj.member}`;
      }
      // For zset: use member value
      if (currentKey.type === 'zset' && 'member' in rowKeyObj) {
        return `${selectedKeyName}:member:${rowKeyObj.member}`;
      }
      return `${selectedKeyName}:row-${index}`;
    },
    [currentKey, selectedKeyName]
  );

  // CrudCommandFactory for BaseDataGrid integration
  // Only available when viewing a key's contents (not browser mode)
  // and the key type supports row-level operations (hash, list, set, zset)
  const commandFactory = useMemo<CrudCommandFactory | undefined>(() => {
    // Disable in browser mode
    if (isBrowserMode) return undefined;
    // Disable if no key selected
    if (!currentKey || !selectedKeyName) return undefined;
    // Only support types that have row-level data
    // Streams are read-only, strings are single-value
    if (currentKey.type === 'string' || currentKey.type === 'stream' || currentKey.type === 'unknown') {
      return undefined;
    }

    // Determine primary key columns based on Redis type
    const primaryKeyColumns: string[] = [];
    if (currentKey.type === 'hash') {
      primaryKeyColumns.push('field');
    } else if (currentKey.type === 'list') {
      primaryKeyColumns.push('index');
    } else if (currentKey.type === 'set' || currentKey.type === 'zset') {
      primaryKeyColumns.push('member');
    }

    return {
      connectionId,
      database: String(database),
      schema: undefined, // Redis doesn't use schemas
      table: selectedKeyName,
      primaryKeyColumns,
      columnNameToFieldMap,
      columnByFieldMap,
      getRowKey: getRowKeyForFactory,

      createEditCommand: (event: GridEditCommitEvent) => {
        return createEditCommand(event);
      },

      createInsertCommand: (_data?: Record<string, unknown>) => {
        // Create empty row - user will fill in values
        return createInsertCommand({});
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
  ]);

  // Compute loading and error states based on mode
  // For browser mode, isLoading is true during initial load or when fetching next page
  const isLoading = isBrowserMode
    ? isLoadingBrowser || isFetchingNextBrowserPage
    : isLoadingMetadata || isLoadingData;
  const error = isBrowserMode
    ? (browserError as Error | null)
    : ((metadataError || dataError) as Error | null);

  return {
    paradigm: 'keyvalue',
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
    createInsertCommand,
    createDeleteCommand,
    commandFactory,
    isBrowserMode,
    pattern,
    setPattern,
    totalKeyCount,
  };
}
