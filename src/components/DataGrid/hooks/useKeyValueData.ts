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
import { useQuery } from '@tanstack/react-query';
import type { GridCell, Item } from '@glideapps/glide-data-grid';
import { GridCellKind } from '@glideapps/glide-data-grid';
import { nanoid } from 'nanoid';
import type { GridColumnV2, GridRowModel, GridEditCommitEvent } from '../types';
import type { KeyValueDataHookResult, KeyMetadata } from '../sources/types';
import type { CrudCommand, DataUpdatePayload, DataInsertPayload, DataDeletePayload, JsonValue } from '@/types/crud';
import { RedisAdapter } from '@/adapters/redis/RedisAdapter';
import {
  getColumnsForRedisType,
  mapRedisDataToRows,
  buildKeyValueCell,
  getRedisRowKey,
} from '../utils/keyvalueCellFactory';
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

export interface UseKeyValueDataParams {
  connectionId: string;
  database: number; // Redis DB index
  initialKey?: string;
  enabled?: boolean;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useKeyValueData(params: UseKeyValueDataParams): KeyValueDataHookResult {
  const {
    connectionId,
    database,
    initialKey,
    enabled = true,
  } = params;

  const adapterRef = useRef<RedisAdapter | null>(null);

  // State
  const [currentKey, setCurrentKey] = useState<KeyMetadata | null>(null);
  const [selectedKeyName, setSelectedKeyName] = useState<string | undefined>(initialKey);

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
    },
    enabled: enabled && !!connectionId && !!selectedKeyName && !!currentKey?.type,
    staleTime: 10000, // 10 seconds
  });

  // Get columns based on current key type
  const columns = useMemo<GridColumnV2[]>(() => {
    if (!currentKey) {
      return [];
    }
    return getColumnsForRedisType(currentKey.type);
  }, [currentKey]);

  // Transform data to rows
  const rows = useMemo<GridRowModel[]>(() => {
    if (!currentKey || rawData === null || rawData === undefined) {
      return [];
    }
    return mapRedisDataToRows(rawData, currentKey.type);
  }, [currentKey, rawData]);

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

      return buildKeyValueCell({
        value: cellValue,
        column,
        readOnly: false,
        keyType: currentKey?.type,
      });
    },
    [columns, rows, currentKey]
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

  // Pagination (not applicable for most Redis types, but included for interface)
  const hasMore = false;

  const fetchNextPage = useCallback(async (): Promise<void> => {
    // Redis types are typically fetched all at once
    // Could implement cursor-based pagination for large lists/streams
  }, []);

  const refetch = useCallback(async (): Promise<void> => {
    await Promise.all([refetchMetadata(), refetchData()]);
  }, [refetchMetadata, refetchData]);

  // CRUD helpers
  const createEditCommand = useCallback(
    (event: GridEditCommitEvent): CrudCommand | null => {
      if (!currentKey || !selectedKeyName) {
        return null;
      }

      const { column, row: rowData, newValue } = event;

      if (!rowData) {
        return null;
      }

      if (currentKey.type === 'list' || currentKey.type === 'set' || currentKey.type === 'stream') {
        return null;
      }

      if (currentKey.type === 'zset' && column.field !== 'score') {
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

      return {
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

  return {
    paradigm: 'keyvalue',
    rows,
    columns,
    getCellContent,
    isLoading: isLoadingMetadata || isLoadingData,
    error: (metadataError || dataError) as Error | null,
    hasMore,
    fetchNextPage,
    refetch,
    currentKey,
    selectKey,
    clearSelection,
    setKeyTTL,
    deleteCurrentKey,
    createEditCommand,
    createInsertCommand,
    createDeleteCommand,
  };
}
