/**
 * useDocumentData - MongoDB data hook for the unified DataGrid
 *
 * Provides:
 * - Document fetching with pagination
 * - Drill-down navigation for nested objects/arrays
 * - Column generation from document keys
 * - CRUD command creation for the staging pipeline
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GridCell, Item } from '@glideapps/glide-data-grid';
import { GridCellKind } from '@glideapps/glide-data-grid';
import { nanoid } from 'nanoid';
import type { GridColumnV2, GridRowModel, GridEditCommitEvent } from '../types';
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
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

export interface UseDocumentDataParams {
  connectionId: string;
  database: string;
  collection: string;
  pageSize?: number;
  enabled?: boolean;
}

interface DocumentWithId extends Record<string, unknown> {
  _id: unknown;
}

const DEFAULT_PAGE_SIZE = 50;

// ============================================================================
// Hook Implementation
// ============================================================================

export function useDocumentData(params: UseDocumentDataParams): DocumentDataHookResult {
  const {
    connectionId,
    database,
    collection,
    pageSize = DEFAULT_PAGE_SIZE,
    enabled = true,
  } = params;

  const adapterRef = useRef<MongoDBAdapter | null>(null);

  // Navigation state
  const [currentPath, setCurrentPath] = useState<PathSegment[]>([]);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);

  // Get or create adapter
  const getAdapter = useCallback(() => {
    if (!adapterRef.current) {
      adapterRef.current = new MongoDBAdapter(connectionId);
    }
    return adapterRef.current;
  }, [connectionId]);

  // Query key for document fetching
  const queryKey = useMemo(
    () => ['document-data', connectionId, database, collection, currentPath, currentPage],
    [connectionId, database, collection, currentPath, currentPage]
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
      const adapter = getAdapter();

      // If we're at root level, fetch collection documents
      if (currentPath.length === 0) {
        const docs = await adapter.findDocuments(collection, {}, {
          skip: currentPage * pageSize,
          limit: pageSize,
        });
        return docs as DocumentWithId[];
      }

      // If we're drilled into a document, we need to get the nested data
      // First, fetch the document
      const docId = currentDocumentId;
      if (!docId) {
        return [];
      }

      const docs = await adapter.findDocuments(collection, { _id: { $oid: docId } }, { limit: 1 });
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
    },
    enabled: enabled && !!connectionId && !!collection,
    staleTime: 30000, // 30 seconds
  });

  // Transform documents to rows
  const documents = rawDocuments || [];

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

  // Transform documents to GridRowModel
  const rows = useMemo<GridRowModel[]>(() => {
    return documents.map((doc) => {
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
  }, [documents, columns]);

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
        const docId = doc._id;
        if (docId && typeof docId === 'object' && '$oid' in docId) {
          setCurrentDocumentId((docId as { $oid: string }).$oid);
        } else if (typeof docId === 'string') {
          setCurrentDocumentId(docId);
        }
      }

      // Add new path segment
      const newSegment: PathSegment = {
        key: column.field,
        label: column.title || column.field,
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
  const getCurrentDocumentId = useCallback((): string | null => {
    return currentDocumentId;
  }, [currentDocumentId]);

  // Pagination
  const hasMore = documents.length >= pageSize;

  const fetchNextPage = useCallback(async (): Promise<void> => {
    setCurrentPage((prev) => prev + 1);
  }, []);

  const refetch = useCallback(async (): Promise<void> => {
    await refetchQuery();
  }, [refetchQuery]);

  // CRUD helpers
  const createEditCommand = useCallback(
    (event: GridEditCommitEvent): CrudCommand | null => {
      const { column, row: rowData, rowIndex, newValue } = event;

      if (!rowData) {
        return null;
      }

      // Get document ID for the update filter
      let docId: string | undefined;
      if (currentPath.length === 0) {
        const doc = documents[rowIndex] as DocumentWithId | undefined;
        const id = doc?._id;
        if (id && typeof id === 'object' && '$oid' in id) {
          docId = (id as { $oid: string }).$oid;
        } else if (typeof id === 'string') {
          docId = id;
        }
      } else {
        docId = currentDocumentId || undefined;
      }

      if (!docId) {
        logger.warn('document-data', 'Cannot create edit command: no document ID');
        return null;
      }

      // Build the field path for nested updates
      const fieldPath = currentPath.length > 0
        ? [...currentPath.map((s) => s.key), column.field].join('.')
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
        primaryKeys: { _id: docId },
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
      const idValue = row._id?.value;
      let docId: string | undefined;

      if (idValue && typeof idValue === 'object' && '$oid' in idValue) {
        docId = (idValue as { $oid: string }).$oid;
      } else if (typeof idValue === 'string') {
        docId = idValue;
      }

      const payload: DataDeletePayload = {
        primaryKeys: { _id: docId || '' },
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
    currentPath,
    canStepInto,
    stepInto,
    stepOut,
    navigateToPath,
    getCurrentDocumentId,
    totalCount: undefined, // TODO: Implement count query
    createEditCommand,
    createInsertCommand,
    createDeleteCommand,
  };
}
