/**
 * useDocumentData - MongoDB data hook for the unified DataGrid
 *
 * Provides:
 * - Document fetching with pagination
 * - Drill-down navigation for nested objects/arrays
 * - Column generation from document keys
 * - CRUD command creation for the staging pipeline
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GridCell, Item } from '@glideapps/glide-data-grid';
import { GridCellKind } from '@glideapps/glide-data-grid';
import { nanoid } from 'nanoid';
import type { GridColumnV2, GridRowModel, GridEditCommitEvent, CrudCommandFactory, SortColumn } from '../types';
import type { DocumentDataHookResult, PathSegment } from '../sources/types';
import type { CrudCommand, DataUpdatePayload, DataInsertPayload, DataDeletePayload, JsonValue } from '@/types/crud';
import type { GridCellValueType } from '@/types/cellValue';
import { MongoDBAdapter } from '@/adapters/mongodb/MongoDBAdapter';
import {
  buildDocumentCell,
  generateColumnsFromDocuments,
  generateColumnsForArrayItems,
  detectDocumentValueType,
} from '../utils/documentCellFactory';
import {
  type DocumentFilter,
  applyDocumentColumnSearch,
} from '@/utils/documentFilterParser';
import { logger } from '@/lib/logger';
import { useGridPreferencesStore } from '../stores/gridPreferencesStore';

// ============================================================================
// Constants
// ============================================================================

// Stable empty array to prevent infinite re-renders when sortColumns is undefined
const EMPTY_SORT_COLUMNS: SortColumn[] = [];

// ============================================================================
// Types
// ============================================================================

export interface UseDocumentDataParams {
  gridId: string;
  connectionId: string;
  database: string;
  collection: string;
  pageSize?: number;
  enabled?: boolean;
  /** Filter for server-side (query mode) or client-side (search mode) filtering */
  filter?: DocumentFilter;
}

interface DocumentWithId extends Record<string, unknown> {
  _id: unknown;
}

type DocumentId = string | number | Record<string, unknown>;

const DEFAULT_PAGE_SIZE = 50;

// ============================================================================
// Hook Implementation
// ============================================================================

export function useDocumentData(params: UseDocumentDataParams): DocumentDataHookResult {
  const {
    gridId,
    connectionId,
    database,
    collection,
    pageSize = DEFAULT_PAGE_SIZE,
    enabled = true,
    filter,
  } = params;

  // Get sort state from grid preferences
  const sortColumns = useGridPreferencesStore(
    (state) => state.preferences[gridId]?.sortColumns ?? EMPTY_SORT_COLUMNS
  );

  // Convert sort columns to MongoDB sort format: { field: 1 | -1 }
  const mongoSort = useMemo(() => {
    if (sortColumns.length === 0) return undefined;
    
    const sort: Record<string, 1 | -1> = {};
    for (const { columnId, direction } of sortColumns) {
      // MongoDB uses field name (like "name", "age") not column IDs
      // Column ID format is typically the field name for document grids
      sort[columnId] = direction === 'asc' ? 1 : -1;
    }
    return sort;
  }, [sortColumns]);

  // Compute the MongoDB query for server-side filtering
  const serverQuery = useMemo(() => {
    if (!filter || filter.mode !== 'query' || !filter.mongoQuery) {
      return {};
    }
    return filter.mongoQuery;
  }, [filter]);

  const adapterRef = useRef<MongoDBAdapter | null>(null);

  // Navigation state
  const [currentPath, setCurrentPath] = useState<PathSegment[]>([]);
  const [currentDocumentId, setCurrentDocumentId] = useState<DocumentId | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pagedDocuments, setPagedDocuments] = useState<DocumentWithId[]>([]);
  const [executionTime, setExecutionTime] = useState<number | undefined>(undefined);

  // Get or create adapter
  const getAdapter = useCallback(() => {
    if (!adapterRef.current) {
      adapterRef.current = new MongoDBAdapter(connectionId);
    }
    return adapterRef.current;
  }, [connectionId]);

  // Query key for document fetching (includes filter and sort for server-side queries)
  const queryKey = useMemo(
    () => ['document-data', connectionId, database, collection, currentPath, currentDocumentId, currentPage, serverQuery, mongoSort],
    [connectionId, database, collection, currentPath, currentDocumentId, currentPage, serverQuery, mongoSort]
  );

  // Fetch documents
  const {
    data: rawDocuments,
    isLoading,
    error,
    refetch: refetchQuery,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      const startTime = performance.now();
      const adapter = getAdapter();

      try {
        // If we're at root level, fetch collection documents (with optional server-side filter and sort)
        if (currentPath.length === 0) {
          const docs = await adapter.findDocuments(collection, serverQuery, {
            skip: currentPage * pageSize,
            limit: pageSize,
            sort: mongoSort,
          });
          return docs as DocumentWithId[];
        }

        // If we're drilled into a document, we need to get the nested data
        // First, fetch the document
        const docId = currentDocumentId;
        if (!docId) {
          return [];
        }

        const docs = await adapter.findDocuments(collection, { _id: docId }, { limit: 1 });
        if (docs.length === 0) {
          return [];
        }

        // Navigate the path to get the nested data
        let current: unknown = docs[0];
        for (const segment of currentPath) {
          if (current === null || current === undefined) {
            return [];
          }
          if (Array.isArray(current)) {
            current = current[segment.key as number];
          } else if (typeof current === 'object') {
            current = (current as Record<string, unknown>)[segment.key as string];
          } else {
            return [];
          }
        }

        // Return the nested data as array for grid display
        if (Array.isArray(current)) {
          // For arrays, wrap each item with index
          return current.map((item, index) => ({ __index: index, __value: item }));
        } else if (typeof current === 'object' && current !== null) {
          // For objects at nested level, return as single-item array
          return [current as DocumentWithId];
        }

        return [];
      } finally {
        const endTime = performance.now();
        setExecutionTime(Math.round(endTime - startTime));
      }
    },
    enabled: enabled && !!connectionId && !!collection,
    staleTime: 30000, // 30 seconds
  });

  // Query key for total count (includes filter for accurate counts)
  const countQueryKey = useMemo(
    () => ['document-count', connectionId, database, collection, serverQuery],
    [connectionId, database, collection, serverQuery]
  );

  // Fetch total document count (only at root level, respects server-side filter)
  const { data: totalCount } = useQuery({
    queryKey: countQueryKey,
    queryFn: async () => {
      const adapter = getAdapter();
      try {
        const count = await adapter.countDocuments(collection, serverQuery);
        return count;
      } catch {
        // Count is optional, return undefined on error
        return undefined;
      }
    },
    enabled: enabled && !!connectionId && !!collection && currentPath.length === 0,
    staleTime: 60000, // 1 minute (counts change less frequently)
  });

  useEffect(() => {
    if (!rawDocuments) {
      setPagedDocuments([]);
      return;
    }

    if (currentPath.length > 0) {
      return;
    }

    setPagedDocuments((prev) => {
      const nextPage = rawDocuments as DocumentWithId[];
      if (currentPage === 0) {
        return nextPage;
      }
      if (nextPage.length === 0) {
        return prev;
      }
      return [...prev, ...nextPage];
    });
  }, [rawDocuments, currentPage, currentPath.length]);

  // Transform documents to rows
  const documents = currentPath.length > 0 ? (rawDocuments || []) : pagedDocuments;

  // Generate columns based on current level
  const columns = useMemo<GridColumnV2[]>(() => {
    if (currentPath.length > 0) {
      const lastSegment = currentPath[currentPath.length - 1];
      if (lastSegment && lastSegment.type === 'array') {
        return generateColumnsForArrayItems();
      }
    }

    if (documents.length === 0) {
      // Default columns when no documents
      return [
        { id: '_id', field: '_id', title: '_id', name: '_id', width: 220 },
      ];
    }

    return generateColumnsFromDocuments(documents as Record<string, unknown>[]);
  }, [documents, currentPath]);

  // Map document value type to GridCellValueType
  const mapToGridCellValueType = (docType: ReturnType<typeof detectDocumentValueType>): GridCellValueType => {
    switch (docType) {
      case 'number':
        return 'Integer';
      case 'boolean':
        return 'Boolean';
      case 'date':
        return 'DateTime';
      case 'null':
        return 'Null';
      case 'object':
      case 'array':
        return 'Json';
      case 'binary':
        return 'Binary';
      case 'string':
      case 'objectId':
      default:
        return 'Text';
    }
  };

  // Transform documents to GridRowModel (with optional client-side search filtering)
  const rows = useMemo<GridRowModel[]>(() => {
    // Apply client-side search filter if in search mode
    let filteredDocs = documents;
    if (filter?.mode === 'search' && filter.searchText) {
      filteredDocs = applyDocumentColumnSearch(
        documents as Record<string, unknown>[],
        filter.searchText
      ) as typeof documents;
    }

    return filteredDocs.map((doc) => {
      const row: GridRowModel = {};
      for (const col of columns) {
        const value = (doc as Record<string, unknown>)[col.field];
        const valueType = detectDocumentValueType(value);

        row[col.field] = {
          value,
          db_type: valueType,
          value_type: mapToGridCellValueType(valueType),
          is_truncated: false,
        };
      }
      return row;
    });
  }, [documents, columns, filter]);

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
      const rawValue = cellValue?.value;

      return buildDocumentCell({
        value: rawValue,
        column,
        readOnly: false,
        canDrillDown: true,
      });
    },
    [columns, rows]
  );

  // Check if a cell can be drilled into
  const canStepInto = useCallback(
    (row: number, col: number): boolean => {
      const column = columns[col];
      const rowData = rows[row];

      if (!column || !rowData) {
        return false;
      }

      const cellValue = rowData[column.field];
      const rawValue = cellValue?.value;
      const valueType = detectDocumentValueType(rawValue);

      return valueType === 'object' || valueType === 'array';
    },
    [columns, rows]
  );

  // Step into a nested object/array
  const stepInto = useCallback(
    (row: number, col: number): void => {
      const column = columns[col];
      const rowData = rows[row];

      if (!column || !rowData || !canStepInto(row, col)) {
        return;
      }

      const cellValue = rowData[column.field];
      const rawValue = cellValue?.value;
      const valueType = detectDocumentValueType(rawValue);

      // Set the document ID if we're at root level
      if (currentPath.length === 0) {
        const doc = documents[row] as DocumentWithId;
        const docId = doc?._id;
        if (docId !== undefined) {
          setCurrentDocumentId(docId as DocumentId);
        }
      }

      const isArrayLevel = currentPath.length > 0 && currentPath[currentPath.length - 1]?.type === 'array';
      const arrayIndex = isArrayLevel ? (rowData.__index as { value?: unknown } | undefined)?.value : undefined;
      const segmentKey = isArrayLevel && typeof arrayIndex === 'number'
        ? arrayIndex
        : column.field;
      const segmentLabel = isArrayLevel && typeof arrayIndex === 'number'
        ? `[${arrayIndex}]`
        : (column.title || column.field);

      // Add new path segment
      const newSegment: PathSegment = {
        key: segmentKey,
        label: segmentLabel,
        type: valueType === 'array' ? 'array' : 'object',
      };

      setCurrentPath((prev) => [...prev, newSegment]);
      setCurrentPage(0);

      logger.info('document-data', `Stepped into ${column.field}`, { path: [...currentPath, newSegment] });
    },
    [columns, rows, canStepInto, documents, currentPath]
  );

  // Step out one level
  const stepOut = useCallback((): void => {
    if (currentPath.length === 0) {
      return;
    }

    setCurrentPath((prev) => prev.slice(0, -1));
    setCurrentPage(0);

    // Clear document ID if returning to root
    if (currentPath.length === 1) {
      setCurrentDocumentId(null);
    }

    logger.info('document-data', 'Stepped out', { newPath: currentPath.slice(0, -1) });
  }, [currentPath]);

  // Navigate to a specific path index (breadcrumb click)
  const navigateToPath = useCallback(
    (pathIndex: number): void => {
      if (pathIndex < 0) {
        // Navigate to root
        setCurrentPath([]);
        setCurrentDocumentId(null);
        setCurrentPage(0);
        return;
      }

      if (pathIndex >= currentPath.length) {
        return;
      }

      setCurrentPath((prev) => prev.slice(0, pathIndex + 1));
      setCurrentPage(0);

      logger.info('document-data', `Navigated to path index ${pathIndex}`);
    },
    [currentPath]
  );

  // Get current document ID
  const getCurrentDocumentId = useCallback((): JsonValue | null => {
    return (currentDocumentId ?? null) as JsonValue | null;
  }, [currentDocumentId]);

  // Pagination
  // hasMore is true when the last fetch returned a FULL page (pageSize documents)
  // If it returned less, we've reached the end
  const hasMore = currentPath.length === 0 && (rawDocuments?.length ?? 0) === pageSize;

  const fetchNextPage = useCallback(async (): Promise<void> => {
    if (currentPath.length > 0) {
      return;
    }
    if ((rawDocuments?.length ?? 0) < pageSize) {
      // Don't fetch next page if the last one was incomplete
      return;
    }
    setCurrentPage((prev) => prev + 1);
  }, [currentPath.length, rawDocuments?.length, pageSize]);

  const refetch = useCallback(async (): Promise<void> => {
    if (currentPage !== 0) {
      setPagedDocuments([]);
      setCurrentPage(0);
      return;
    }
    await refetchQuery();
  }, [currentPage, refetchQuery]);

  // CRUD helpers
  const createEditCommand = useCallback(
    (event: GridEditCommitEvent): CrudCommand | null => {
      const { column, row: rowData, rowIndex, newValue } = event;

      if (!rowData) {
        return null;
      }

      // Get document ID for the update filter
      let docId: DocumentId | undefined;
      if (currentPath.length === 0) {
        const doc = documents[rowIndex] as DocumentWithId | undefined;
        const id = doc?._id;
        if (id !== undefined) {
          docId = id as DocumentId;
        }
      } else {
        docId = currentDocumentId || undefined;
      }

      if (!docId) {
        logger.warn('document-data', 'Cannot create edit command: no document ID');
        return null;
      }

      // Build the field path for nested updates
      const isArrayLevel = currentPath.length > 0 && currentPath[currentPath.length - 1]?.type === 'array';
      const arrayIndex = isArrayLevel
        ? (rowData.__index as { value?: unknown } | undefined)?.value
        : undefined;
      const fieldPath = currentPath.length > 0
        ? [
            ...currentPath.map((s) => s.key),
            ...(isArrayLevel && typeof arrayIndex === 'number' ? [arrayIndex] : [column.field]),
          ].join('.')
        : column.field;

      // Extract the actual value from the cell (convert to JsonValue)
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
        column: fieldPath,
        primaryKeys: { _id: docId as JsonValue },
        oldValue: oldValueJson,
        newValue: newValueJson,
      };

      return {
        id: nanoid(),
        type: 'data.update',
        target: {
          connectionId,
          database,
          table: collection,
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: `Update ${fieldPath}`,
        },
        state: 'staged',
      };
    },
    [rows, documents, currentPath, currentDocumentId, connectionId, database, collection]
  );

  const createInsertCommand = useCallback(
    (values: Record<string, unknown>): CrudCommand => {
      // Convert values to JsonValue record
      const jsonValues: Record<string, JsonValue> = {};
      for (const [key, val] of Object.entries(values)) {
        jsonValues[key] = val as JsonValue;
      }

      const payload: DataInsertPayload = {
        values: jsonValues,
      };

      return {
        id: nanoid(),
        type: 'data.insert',
        target: {
          connectionId,
          database,
          table: collection,
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: 'Insert document',
        },
        state: 'staged',
      };
    },
    [connectionId, database, collection]
  );

  const createDeleteCommand = useCallback(
    (row: GridRowModel): CrudCommand => {
      // Get document ID from row
      const idValue = row._id?.value as DocumentId | undefined;
      const docId = idValue;

      const payload: DataDeletePayload = {
        primaryKeys: { _id: (docId ?? null) as JsonValue },
      };

      return {
        id: nanoid(),
        type: 'data.delete',
        target: {
          connectionId,
          database,
          table: collection,
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: 'Delete document',
        },
        state: 'staged',
      };
    },
    [connectionId, database, collection]
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

  // Get row key for a document (using _id)
  const getRowKey = useCallback(
    (row: GridRowModel | undefined, index: number): string => {
      if (!row) return `row-${index}`;
      const idValue = row._id?.value;
      if (idValue !== undefined && idValue !== null) {
        return `${collection}:${String(idValue)}`;
      }
      return `${collection}:row-${index}`;
    },
    [collection]
  );

  // CrudCommandFactory for BaseDataGrid integration
  // Only available at root level (not when drilled into nested objects)
  const commandFactory = useMemo<CrudCommandFactory | undefined>(() => {
    // Disable CRUD when drilled into nested paths (can't insert/delete nested items directly)
    if (currentPath.length > 0) return undefined;

    return {
      connectionId,
      database,
      schema: undefined, // MongoDB doesn't use schemas
      table: collection,
      primaryKeyColumns: ['_id'],
      columnNameToFieldMap,
      columnByFieldMap,
      getRowKey,

      createEditCommand: (event: GridEditCommitEvent) => {
        return createEditCommand(event);
      },

      createInsertCommand: (_data?: Record<string, unknown>) => {
        // Create empty document - user will fill in values
        return createInsertCommand({});
      },

      createDeleteCommand: (row: GridRowModel, _rowKey: string) => {
        return createDeleteCommand(row);
      },
    };
  }, [
    currentPath.length,
    connectionId,
    database,
    collection,
    columnNameToFieldMap,
    columnByFieldMap,
    getRowKey,
    createEditCommand,
    createInsertCommand,
    createDeleteCommand,
  ]);

  return {
    paradigm: 'document',
    rows,
    columns,
    getCellContent,
    isLoading,
    error: error as Error | null,
    hasMore,
    fetchNextPage,
    refetch,
    executionTime,
    currentPath,
    canStepInto,
    stepInto,
    stepOut,
    navigateToPath,
    getCurrentDocumentId,
    totalCount,
    createEditCommand,
    createInsertCommand,
    createDeleteCommand,
    commandFactory,
  };
}
