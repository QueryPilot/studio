/**
 * useDocumentData - MongoDB data hook for the unified DataGrid
 *
 * Provides:
 * - Document fetching with pagination
 * - Drill-down navigation for nested objects/arrays
 * - Column generation from document keys
 * - CRUD command creation for the staging pipeline
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GridCell, Item } from "@glideapps/glide-data-grid";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { nanoid } from "nanoid";
import type {
  GridColumnV2,
  GridRowModel,
  GridEditCommitEvent,
  CrudCommandFactory,
  SortColumn,
  GridActivationEvent,
  GridCellContentContext,
} from "../types";
import type { DocumentDataHookResult, PathSegment } from "../sources/types";
import type {
  CrudCommand,
  DataUpdatePayload,
  DataInsertPayload,
  DataDeletePayload,
  JsonValue,
} from "@/types/crud";
import type { GridCellValueType } from "@/types/cellValue";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import type { CursorToken } from "@/adapters/types/mongodb";
import {
  buildDocumentCell,
  generateColumnsFromDocuments,
  generateColumnsForTypedValueMode,
  generateColumnsForTableMode,
  detectDocumentValueType,
  mapDocumentValueTypeToGrid,
} from "../utils/documentCellFactory";
import { useNestedArrayLayout } from "./useNestedArrayLayout";
import {
  type DocumentFilter,
  applyDocumentColumnSearch,
} from "@/utils/documentFilterParser";
import { logger } from "@/lib/logger";
import { useGridPreferencesStore } from "../stores/gridPreferencesStore";

// ============================================================================
// Constants
// ============================================================================

// Stable empty array to prevent infinite re-renders when sortColumns is undefined
const EMPTY_SORT_COLUMNS: SortColumn[] = [];

// Column field names for key-value (single object) display mode
export const KV_KEY_FIELD = "__kv_key";
export const KV_VALUE_FIELD = "__kv_value";
// Synthetic row identity for array-level views (table + typed-value).
export const ARRAY_INDEX_FIELD = "__index";

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
  flattenMode?: boolean;
  flattenDepth?: number;
}

interface DocumentWithId extends Record<string, unknown> {
  _id: unknown;
}

type DocumentId = string | number | Record<string, unknown>;

const DEFAULT_PAGE_SIZE = 50;
const MAX_ROOT_BUFFER_DOCS = 10000;

function flattenDocumentRecord(
  value: unknown,
  prefix: string,
  depth: number,
  maxDepth: number,
  out: Record<string, unknown>,
): void {
  if (depth >= maxDepth || value === null || value === undefined) {
    if (prefix) {
      out[prefix] = value;
    }
    return;
  }

  if (Array.isArray(value)) {
    if (prefix) {
      out[prefix] = value;
    }
    return;
  }

  if (typeof value !== "object") {
    if (prefix) {
      out[prefix] = value;
    }
    return;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    if (prefix) {
      out[prefix] = value;
    }
    return;
  }

  for (const [key, child] of entries) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    flattenDocumentRecord(child, nextPrefix, depth + 1, maxDepth, out);
  }
}

function flattenDocumentForGrid(
  doc: Record<string, unknown>,
  maxDepth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // Always preserve _id at the top level so edit/delete commands can
  // reliably resolve the document primary key even in flattened mode.
  if (Object.prototype.hasOwnProperty.call(doc, "_id")) {
    out._id = doc._id;
  }

  for (const [key, value] of Object.entries(doc)) {
    if (key === "_id") {
      continue;
    }
    flattenDocumentRecord(value, key, 1, maxDepth, out);
  }

  return out;
}

function projectionPathFromSamplePath(path: string): string | null {
  if (!path || path.includes("[]")) {
    return null;
  }
  return path;
}

function splitDocumentFieldPath(field: string): string[] {
  return field
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function filterDocumentsForCurrentLevel(
  documents: Record<string, unknown>[],
  filter: DocumentFilter | undefined,
  isRootLevel: boolean,
): Record<string, unknown>[] {
  if (!isRootLevel || filter?.mode !== "search" || !filter.searchText) {
    return documents;
  }
  return applyDocumentColumnSearch(documents, filter.searchText);
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useDocumentData(
  params: UseDocumentDataParams,
): DocumentDataHookResult {
  const {
    gridId,
    connectionId,
    database,
    collection,
    pageSize = DEFAULT_PAGE_SIZE,
    enabled = true,
    filter,
    flattenMode = false,
    flattenDepth = 3,
  } = params;

  // Get sort state from grid preferences
  const sortColumns = useGridPreferencesStore(
    (state) => state.preferences[gridId]?.sortColumns ?? EMPTY_SORT_COLUMNS,
  );

  // Convert sort columns to MongoDB sort format: { field: 1 | -1 }
  const mongoSort = useMemo(() => {
    if (sortColumns.length === 0) return undefined;

    const sort: Record<string, 1 | -1> = {};
    for (const { columnId, direction } of sortColumns) {
      // MongoDB uses field name (like "name", "age") not column IDs
      // Column ID format is typically the field name for document grids
      sort[columnId] = direction === "asc" ? 1 : -1;
    }
    return sort;
  }, [sortColumns]);

  // Compute the MongoDB query for server-side filtering
  const serverQuery = useMemo(() => {
    if (!filter || filter.mode !== "query" || !filter.mongoQuery) {
      return {};
    }
    return filter.mongoQuery;
  }, [filter]);

  const adapterRef = useRef<MongoDBAdapter | null>(null);

  // Navigation state
  const [currentPath, setCurrentPath] = useState<PathSegment[]>([]);
  const [currentDocumentId, setCurrentDocumentId] = useState<DocumentId | null>(
    null,
  );
  const [rootDocuments, setRootDocuments] = useState<DocumentWithId[]>([]);
  const [nextCursor, setNextCursor] = useState<CursorToken | null>(null);
  const [rootHasMore, setRootHasMore] = useState(true);
  const [rootError, setRootError] = useState<Error | null>(null);
  const [isRootLoading, setIsRootLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [executionTime, setExecutionTime] = useState<number | undefined>(
    undefined,
  );
  const rootRequestVersionRef = useRef(0);
  const nextCursorRef = useRef<CursorToken | null>(null);
  const rootHasMoreRef = useRef(true);
  const isLoadingMoreRef = useRef(false);
  const schemaProjectionRef = useRef<Record<string, 0 | 1> | undefined>(
    undefined,
  );
  const projectionSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  useEffect(() => {
    rootHasMoreRef.current = rootHasMore;
  }, [rootHasMore]);

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  // Get or create adapter
  const getAdapter = useCallback(() => {
    if (!adapterRef.current) {
      adapterRef.current = new MongoDBAdapter(connectionId);
    }
    return adapterRef.current;
  }, [connectionId]);

  const fetchRootPage = useCallback(
    async (reset: boolean): Promise<void> => {
      if (currentPath.length > 0 || !enabled || !connectionId || !collection) {
        return;
      }
      if (!reset && (!rootHasMoreRef.current || isLoadingMoreRef.current)) {
        return;
      }

      const adapter = getAdapter();
      const requestVersion = ++rootRequestVersionRef.current;

      if (reset) {
        setIsRootLoading(true);
        setIsLoadingMore(false);
        setRootError(null);
      } else {
        setIsLoadingMore(true);
      }

      const startTime = performance.now();
      try {
        const page = await adapter.findDocumentsPage(collection, serverQuery, {
          limit: pageSize,
          sort: mongoSort,
          projection: schemaProjectionRef.current,
          cursor: reset ? null : nextCursorRef.current,
        });

        if (requestVersion !== rootRequestVersionRef.current) {
          return;
        }

        const incomingDocs = page.documents as DocumentWithId[];
        setRootDocuments((prev) => {
          const merged = reset ? incomingDocs : [...prev, ...incomingDocs];
          if (merged.length <= MAX_ROOT_BUFFER_DOCS) {
            return merged;
          }
          return merged.slice(merged.length - MAX_ROOT_BUFFER_DOCS);
        });
        setNextCursor(page.nextCursor ?? null);
        setRootHasMore(page.hasMore);
      } catch (err) {
        if (requestVersion !== rootRequestVersionRef.current) {
          return;
        }
        const normalized = err instanceof Error ? err : new Error(String(err));
        setRootError(normalized);
        logger.error("document-data", "Failed to fetch root page", normalized);
      } finally {
        if (requestVersion === rootRequestVersionRef.current) {
          const endTime = performance.now();
          setExecutionTime(Math.round(endTime - startTime));
          setIsRootLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [
      collection,
      currentPath.length,
      enabled,
      connectionId,
      getAdapter,
      mongoSort,
      pageSize,
      serverQuery,
    ],
  );

  // Fetch drilled-in (nested) data
  const nestedQueryKey = useMemo(
    () => [
      "document-nested-data",
      connectionId,
      database,
      collection,
      currentPath,
      currentDocumentId,
    ],
    [connectionId, database, collection, currentPath, currentDocumentId],
  );

  const {
    data: nestedDocuments,
    isLoading: isNestedLoading,
    error: nestedError,
    refetch: refetchNestedQuery,
  } = useQuery({
    queryKey: nestedQueryKey,
    queryFn: async () => {
      const startTime = performance.now();
      const adapter = getAdapter();
      try {
        const docId = currentDocumentId;
        if (!docId) {
          return [];
        }

        const docs = await adapter.findDocuments(
          collection,
          { _id: docId },
          { limit: 1 },
        );
        if (docs.length === 0) {
          return [];
        }

        let current: unknown = docs[0];
        for (const segment of currentPath) {
          if (current === null || current === undefined) {
            return [];
          }
          if (Array.isArray(current)) {
            current = current[segment.key as number];
          } else if (typeof current === "object") {
            current = (current as Record<string, unknown>)[
              segment.key as string
            ];
          } else {
            return [];
          }
        }

        if (Array.isArray(current)) {
          return current.map((item, index) => ({
            __index: index,
            __value: item,
          }));
        }
        if (typeof current === "object" && current !== null) {
          return [current as DocumentWithId];
        }
        return [];
      } finally {
        const endTime = performance.now();
        setExecutionTime(Math.round(endTime - startTime));
      }
    },
    enabled:
      enabled && !!connectionId && !!collection && currentPath.length > 0,
    staleTime: 30000,
  });

  // Query key for total count (includes filter for accurate counts)
  const countQueryKey = useMemo(
    () => ["document-count", connectionId, database, collection, serverQuery],
    [connectionId, database, collection, serverQuery],
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
    enabled:
      enabled && !!connectionId && !!collection && currentPath.length === 0,
    staleTime: 60000, // 1 minute (counts change less frequently)
  });

  const { data: schemaSample } = useQuery({
    queryKey: [
      "document-schema-sample",
      connectionId,
      database,
      collection,
      serverQuery,
      flattenDepth,
    ],
    queryFn: async () => {
      const adapter = getAdapter();
      return adapter.sampleCollectionSchema(collection, serverQuery, {
        sampleSize: 600,
        maxDepth: flattenDepth,
      });
    },
    enabled:
      enabled &&
      !!connectionId &&
      !!collection &&
      currentPath.length === 0 &&
      flattenMode,
    staleTime: 120000,
  });

  const flattenProjection = useMemo<Record<string, 0 | 1> | undefined>(() => {
    if (!flattenMode || !schemaSample || schemaSample.fields.length === 0) {
      return undefined;
    }

    const candidatePaths = schemaSample.fields
      .map((field) => projectionPathFromSamplePath(field.path))
      .filter((path): path is string => Boolean(path))
      .slice(0, 120);

    // Sort so children come before parents (longer paths first).
    // Then skip any path that is a prefix of an already-included path,
    // because MongoDB rejects projections with both "a" and "a.b".
    const sorted = [...candidatePaths].sort((a, b) => b.length - a.length);
    const kept = new Set<string>();

    for (const path of sorted) {
      // Check if any already-kept path starts with this path + "."
      let isParentOfKept = false;
      for (const existing of kept) {
        if (existing.startsWith(path + ".")) {
          isParentOfKept = true;
          break;
        }
      }
      if (!isParentOfKept) {
        kept.add(path);
      }
    }

    const projection: Record<string, 0 | 1> = { _id: 1 };
    for (const path of kept) {
      projection[path] = 1;
    }

    return projection;
  }, [flattenMode, schemaSample]);
  const flattenProjectionSignature = useMemo(
    () => (flattenProjection ? JSON.stringify(flattenProjection) : "__none__"),
    [flattenProjection],
  );

  useEffect(() => {
    schemaProjectionRef.current = flattenProjection;
  }, [flattenProjection]);

  useEffect(() => {
    if (currentPath.length > 0 || !enabled || !connectionId || !collection) {
      return;
    }

    if (projectionSignatureRef.current === null) {
      projectionSignatureRef.current = flattenProjectionSignature;
      return;
    }

    if (projectionSignatureRef.current === flattenProjectionSignature) {
      return;
    }

    projectionSignatureRef.current = flattenProjectionSignature;
    rootRequestVersionRef.current += 1;
    setRootDocuments([]);
    setNextCursor(null);
    setRootHasMore(true);
    setRootError(null);

    void fetchRootPage(true);
  }, [
    currentPath.length,
    enabled,
    connectionId,
    collection,
    flattenProjectionSignature,
    fetchRootPage,
  ]);

  useEffect(() => {
    if (currentPath.length > 0 || !enabled || !connectionId || !collection) {
      return;
    }

    rootRequestVersionRef.current += 1;
    setRootDocuments([]);
    setNextCursor(null);
    setRootHasMore(true);
    setRootError(null);

    void fetchRootPage(true);
  }, [
    connectionId,
    database,
    collection,
    enabled,
    currentPath.length,
    pageSize,
    serverQuery,
    mongoSort,
    fetchRootPage,
  ]);

  useEffect(() => {
    if (currentPath.length > 0) {
      rootRequestVersionRef.current += 1;
      setIsRootLoading(false);
      setIsLoadingMore(false);
    }
  }, [currentPath.length]);

  // Transform documents to rows
  const documents = useMemo(
    () => (currentPath.length > 0 ? (nestedDocuments ?? []) : rootDocuments),
    [currentPath.length, nestedDocuments, rootDocuments],
  );
  const displayDocuments = useMemo(() => {
    if (currentPath.length > 0 || !flattenMode) {
      return documents;
    }
    return (documents as Record<string, unknown>[]).map((doc) =>
      flattenDocumentForGrid(doc, flattenDepth),
    );
  }, [currentPath.length, documents, flattenMode, flattenDepth]);

  const isNestedSingleObject = useMemo(() => {
    if (currentPath.length === 0) return false;
    const lastSegment = currentPath[currentPath.length - 1];
    return lastSegment?.type === "object";
  }, [currentPath]);

  // Determine array display layout (table vs typed-value)
  const isArrayLevel = useMemo(() => {
    if (currentPath.length === 0) return false;
    const lastSegment = currentPath[currentPath.length - 1];
    return lastSegment?.type === "array";
  }, [currentPath]);

  // Extract raw array items for schema analysis
  // nestedDocuments has shape [{ __index, __value }, ...] for arrays
  const arrayItems = useMemo(() => {
    if (!isArrayLevel || !nestedDocuments) return undefined;
    return nestedDocuments.map((doc: Record<string, unknown>) => doc.__value);
  }, [isArrayLevel, nestedDocuments]);

  const arrayLayout = useNestedArrayLayout(arrayItems, isArrayLevel);

  // Generate columns based on current level
  const columns = useMemo<GridColumnV2[]>(() => {
    // Key-value mode for single nested objects
    if (isNestedSingleObject && displayDocuments.length === 1) {
      return [
        {
          id: KV_KEY_FIELD,
          field: KV_KEY_FIELD,
          title: "Key",
          name: "Key",
          width: 200,
        },
        {
          id: KV_VALUE_FIELD,
          field: KV_VALUE_FIELD,
          title: "Value",
          name: "Value",
          width: 400,
        },
      ];
    }

    if (isArrayLevel) {
      if (arrayLayout.mode === "table") {
        return generateColumnsForTableMode(arrayLayout.columns);
      }
      return generateColumnsForTypedValueMode();
    }

    if (displayDocuments.length === 0) {
      // Default columns when no documents
      return [
        { id: "_id", field: "_id", title: "_id", name: "_id", width: 220 },
      ];
    }

    return generateColumnsFromDocuments(
      displayDocuments as Record<string, unknown>[],
    );
  }, [displayDocuments, isNestedSingleObject, isArrayLevel, arrayLayout]);

  // Transform documents to GridRowModel (with optional client-side search filtering)
  const rows = useMemo<GridRowModel[]>(() => {
    const filteredDocs = filterDocumentsForCurrentLevel(
      displayDocuments as Record<string, unknown>[],
      filter,
      currentPath.length === 0,
    ) as typeof documents;

    // Key-value mode: transform single object entries to rows
    if (isNestedSingleObject && filteredDocs.length === 1) {
      const obj = filteredDocs[0] as Record<string, unknown>;
      return Object.entries(obj).map(([key, value]) => {
        const valueType = detectDocumentValueType(value);
        return {
          [KV_KEY_FIELD]: {
            value: key,
            db_type: "string",
            value_type: "Text" as GridCellValueType,
            is_truncated: false,
          },
          [KV_VALUE_FIELD]: {
            value,
            db_type: valueType,
            value_type: mapDocumentValueTypeToGrid(valueType),
            is_truncated: false,
          },
        } as GridRowModel;
      });
    }

    // Array table mode: each object item becomes a row with field columns
    if (
      isArrayLevel &&
      arrayLayout.mode === "table" &&
      filteredDocs.length > 0
    ) {
      return filteredDocs.map((doc) => {
        const d = doc as Record<string, unknown>;
        const item = d.__value;
        const obj =
          typeof item === "object" && item !== null && !Array.isArray(item)
            ? (item as Record<string, unknown>)
            : {};
        const row: GridRowModel = {};
        // Preserve original array index for correct drill-down after filtering
        row.__index = {
          value: d.__index,
          db_type: "number",
          value_type: "Integer" as GridCellValueType,
          is_truncated: false,
        };
        for (const col of columns) {
          const value = obj[col.field];
          const valueType = detectDocumentValueType(value);
          row[col.field] = {
            value: value === undefined ? undefined : value,
            db_type: valueType,
            value_type: mapDocumentValueTypeToGrid(valueType),
            is_truncated: false,
          };
        }
        return row;
      });
    }

    // Array typed-value mode: Index | Type | Value
    if (
      isArrayLevel &&
      arrayLayout.mode === "typed-value" &&
      filteredDocs.length > 0
    ) {
      return filteredDocs.map((doc) => {
        const d = doc as Record<string, unknown>;
        const rawValue = d.__value;
        const valueType = detectDocumentValueType(rawValue);
        return {
          __index: {
            value: d.__index,
            db_type: "number",
            value_type: "Integer" as GridCellValueType,
            is_truncated: false,
          },
          __type: {
            value: valueType,
            db_type: "string",
            value_type: "Text" as GridCellValueType,
            is_truncated: false,
          },
          __value: {
            value: rawValue,
            db_type: valueType,
            value_type: mapDocumentValueTypeToGrid(valueType),
            is_truncated: false,
          },
        } as GridRowModel;
      });
    }

    return filteredDocs.map((doc) => {
      const row: GridRowModel = {};
      for (const col of columns) {
        const value = (doc as Record<string, unknown>)[col.field];
        const valueType = detectDocumentValueType(value);

        row[col.field] = {
          value,
          db_type: valueType,
          value_type: mapDocumentValueTypeToGrid(valueType),
          is_truncated: false,
        };
      }
      return row;
    });
  }, [
    displayDocuments,
    columns,
    filter,
    currentPath.length,
    isNestedSingleObject,
    isArrayLevel,
    arrayLayout,
  ]);

  const nullTypeHintsByField = useMemo(() => {
    const hints = new Map<string, ReturnType<typeof detectDocumentValueType>>();
    for (const column of columns) {
      for (const doc of displayDocuments as Record<string, unknown>[]) {
        const candidate = doc[column.field];
        if (candidate === null || candidate === undefined) {
          continue;
        }
        hints.set(column.field, detectDocumentValueType(candidate));
        break;
      }
    }
    return hints;
  }, [columns, displayDocuments]);

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

      // Key-value mode cells
      if (isNestedSingleObject && column.field === KV_KEY_FIELD) {
        const keyValue = (row[KV_KEY_FIELD]?.value as string | undefined) ?? "";
        return {
          kind: GridCellKind.Text,
          data: keyValue,
          displayData: keyValue,
          allowOverlay: true,
          readonly: true,
        };
      }

      if (isNestedSingleObject && column.field === KV_VALUE_FIELD) {
        const rawValue = row[KV_VALUE_FIELD]?.value;
        return buildDocumentCell({
          value: rawValue,
          column,
          readOnly: false,
          canDrillDown: true,
        });
      }

      const cellValue = row[column.field];
      const rawValue = cellValue?.value;

      return buildDocumentCell({
        value: rawValue,
        column,
        nullTypeHint: nullTypeHintsByField.get(column.field),
        readOnly: false,
        canDrillDown: true,
      });
    },
    [columns, rows, nullTypeHintsByField, isNestedSingleObject],
  );

  const getRawValueFromRow = useCallback(
    (rowData: GridRowModel | undefined, column: GridColumnV2): unknown => {
      if (!rowData) return undefined;
      const cellValue = rowData[column.field];
      if (cellValue && typeof cellValue === "object" && "value" in cellValue) {
        return (cellValue as { value?: unknown }).value;
      }
      return cellValue;
    },
    [],
  );

  // Check if a cell can be drilled into
  const canStepInto = useCallback(
    (event: GridActivationEvent): boolean => {
      const { row, column } = event;
      if (!row) {
        return false;
      }

      // In KV mode, check the __kv_value column
      if (isNestedSingleObject && column.field === KV_VALUE_FIELD) {
        const rawValue = row[KV_VALUE_FIELD]?.value;
        const valueType = detectDocumentValueType(rawValue);
        return valueType === "object" || valueType === "array";
      }

      // Table mode: check raw value in the cell
      if (isArrayLevel && arrayLayout.mode === "table") {
        const cellValue = row[column.field];
        const rawValue =
          cellValue && typeof cellValue === "object" && "value" in cellValue
            ? (cellValue as { value?: unknown }).value
            : cellValue;
        const cellValueType = detectDocumentValueType(rawValue);
        return cellValueType === "object" || cellValueType === "array";
      }

      const rawValue = getRawValueFromRow(row, column);
      const valueType = detectDocumentValueType(rawValue);
      return valueType === "object" || valueType === "array";
    },
    [getRawValueFromRow, isNestedSingleObject, isArrayLevel, arrayLayout],
  );

  // Step into a nested object/array
  const stepInto = useCallback(
    (event: GridActivationEvent): void => {
      const { row: rowData, column } = event;
      if (!rowData || !canStepInto(event)) {
        return;
      }

      // Key-value mode: use the key column as the path segment
      if (isNestedSingleObject && column.field === KV_VALUE_FIELD) {
        const keyValue = rowData[KV_KEY_FIELD]?.value as string | undefined;
        if (keyValue === undefined) return;

        const rawValue = rowData[KV_VALUE_FIELD]?.value;
        const valueType = detectDocumentValueType(rawValue);
        const segmentType: PathSegment["type"] =
          valueType === "array" ? "array" : "object";

        setCurrentPath((prev) => [
          ...prev,
          { key: keyValue, label: keyValue, type: segmentType },
        ]);
        return;
      }

      // Table mode: drill into a cell's nested object/array value
      if (isArrayLevel && arrayLayout.mode === "table") {
        // Use stored __index (original array position), not visual row index
        const arrayIndex =
          ((rowData.__index as { value?: unknown } | undefined)?.value as
            | number
            | undefined) ?? event.rowIndex;
        const rawFieldValue = getRawValueFromRow(rowData, column);
        const fieldValueType = detectDocumentValueType(rawFieldValue);
        const fieldType: PathSegment["type"] =
          fieldValueType === "array" ? "array" : "object";

        setCurrentPath((prev) => [
          ...prev,
          { key: arrayIndex, label: `[${arrayIndex}]`, type: "array" },
          { key: column.field, label: column.field, type: fieldType },
        ]);
        return;
      }

      const rawValue = getRawValueFromRow(rowData, column);
      const valueType = detectDocumentValueType(rawValue);

      // Resolve and set document ID using row data (safe across sorting/pinning)
      if (currentPath.length === 0) {
        const idCell = rowData._id;
        const idValue =
          idCell && typeof idCell === "object" && "value" in idCell
            ? (idCell as { value?: unknown }).value
            : idCell;
        if (idValue !== undefined && idValue !== null) {
          setCurrentDocumentId(idValue as DocumentId);
        }
      }

      const arrayIndex = isArrayLevel
        ? (rowData.__index as { value?: unknown } | undefined)?.value
        : undefined;
      const terminalType: PathSegment["type"] =
        valueType === "array" ? "array" : "object";

      const nextSegments: PathSegment[] = [];
      if (isArrayLevel && typeof arrayIndex === "number") {
        nextSegments.push({
          key: arrayIndex,
          label: `[${arrayIndex}]`,
          type: terminalType,
        });
      } else {
        const pathParts = splitDocumentFieldPath(column.field);
        if (pathParts.length === 0) {
          return;
        }

        for (let i = 0; i < pathParts.length; i++) {
          const part = pathParts[i];
          if (!part) continue;
          const isTerminal = i === pathParts.length - 1;
          nextSegments.push({
            key: part,
            label:
              isTerminal && pathParts.length === 1
                ? column.title || column.field
                : part,
            type: isTerminal ? terminalType : "object",
          });
        }
      }

      if (nextSegments.length === 0) {
        return;
      }

      setCurrentPath((prev) => {
        const nextPath = [...prev, ...nextSegments];
        logger.info("document-data", `Stepped into ${column.field}`, {
          path: nextPath,
        });
        return nextPath;
      });
    },
    [
      canStepInto,
      currentPath,
      getRawValueFromRow,
      isNestedSingleObject,
      arrayLayout,
      isArrayLevel,
    ],
  );

  // Step out one level
  const stepOut = useCallback((): void => {
    if (currentPath.length === 0) {
      return;
    }

    setCurrentPath((prev) => prev.slice(0, -1));

    // Clear document ID if returning to root
    if (currentPath.length === 1) {
      setCurrentDocumentId(null);
    }

    logger.info("document-data", "Stepped out", {
      newPath: currentPath.slice(0, -1),
    });
  }, [currentPath]);

  // Navigate to a specific path index (breadcrumb click)
  const navigateToPath = useCallback(
    (pathIndex: number): void => {
      if (pathIndex < 0) {
        // Navigate to root
        setCurrentPath([]);
        setCurrentDocumentId(null);
        return;
      }

      if (pathIndex >= currentPath.length) {
        return;
      }

      setCurrentPath((prev) => prev.slice(0, pathIndex + 1));

      logger.info("document-data", `Navigated to path index ${pathIndex}`);
    },
    [currentPath],
  );

  // Get current document ID
  const getCurrentDocumentId = useCallback((): JsonValue | null => {
    return (currentDocumentId ?? null) as JsonValue | null;
  }, [currentDocumentId]);

  // Pagination
  const hasMore = currentPath.length === 0 && rootHasMore;

  const fetchNextPage = useCallback(async (): Promise<void> => {
    if (currentPath.length > 0) {
      return;
    }
    await fetchRootPage(false);
  }, [currentPath.length, fetchRootPage]);

  const refetchRootDocumentsPreservingWindow =
    useCallback(async (): Promise<void> => {
      if (currentPath.length > 0 || !enabled || !connectionId || !collection) {
        return;
      }

      // Preserve the currently loaded viewport depth so save/refetch doesn't collapse
      // back to a single page and reset the user's scroll position.
      const targetCount = Math.max(rootDocuments.length, pageSize);
      if (targetCount <= 0) {
        await fetchRootPage(true);
        return;
      }

      const adapter = getAdapter();
      const requestVersion = ++rootRequestVersionRef.current;
      setRootError(null);
      setIsLoadingMore(false);
      if (rootDocuments.length === 0) {
        setIsRootLoading(true);
      }

      const startTime = performance.now();
      let cursor: CursorToken | null = null;
      let hasMore = true;
      const refreshedDocuments: DocumentWithId[] = [];

      try {
        while (hasMore && refreshedDocuments.length < targetCount) {
          const remaining = targetCount - refreshedDocuments.length;
          const page = await adapter.findDocumentsPage(
            collection,
            serverQuery,
            {
              limit: Math.max(1, Math.min(pageSize, remaining)),
              sort: mongoSort,
              projection: schemaProjectionRef.current,
              cursor,
            },
          );

          if (requestVersion !== rootRequestVersionRef.current) {
            return;
          }

          const pageDocuments = page.documents as DocumentWithId[];
          if (pageDocuments.length === 0) {
            hasMore = false;
            cursor = null;
            break;
          }

          refreshedDocuments.push(...pageDocuments);
          cursor = page.nextCursor ?? null;
          hasMore = page.hasMore;
        }

        if (requestVersion !== rootRequestVersionRef.current) {
          return;
        }

        setRootDocuments(refreshedDocuments);
        setNextCursor(cursor);
        setRootHasMore(hasMore);
      } catch (err) {
        if (requestVersion !== rootRequestVersionRef.current) {
          return;
        }
        const normalized = err instanceof Error ? err : new Error(String(err));
        setRootError(normalized);
        logger.error(
          "document-data",
          "Failed to refetch root documents",
          normalized,
        );
      } finally {
        if (requestVersion === rootRequestVersionRef.current) {
          const endTime = performance.now();
          setExecutionTime(Math.round(endTime - startTime));
          setIsRootLoading(false);
          setIsLoadingMore(false);
        }
      }
    }, [
      collection,
      connectionId,
      currentPath.length,
      enabled,
      fetchRootPage,
      getAdapter,
      mongoSort,
      pageSize,
      rootDocuments.length,
      serverQuery,
    ]);

  const refetch = useCallback(async (): Promise<void> => {
    if (currentPath.length === 0) {
      await refetchRootDocumentsPreservingWindow();
      return;
    }
    await refetchNestedQuery();
  }, [
    currentPath.length,
    refetchNestedQuery,
    refetchRootDocumentsPreservingWindow,
  ]);

  const isLoading =
    (currentPath.length === 0 ? isRootLoading : isNestedLoading) ||
    arrayLayout.isAnalyzing;
  const activeError = currentPath.length === 0 ? rootError : nestedError;
  const error = activeError instanceof Error ? activeError : null;

  // CRUD helpers
  const createEditCommand = useCallback(
    (event: GridEditCommitEvent): CrudCommand | null => {
      const { column, row: rowData, newValue } = event;

      if (!rowData) {
        return null;
      }

      // Check if this row is from an INSERT command (by checking for tempId metadata)
      const tempIdCell = rowData["__insert_temp_id__"] as
        | { value?: string | number }
        | undefined;
      const insertTempId =
        tempIdCell?.value != null ? String(tempIdCell.value) : undefined;

      // Get document ID for the update filter (not needed for inserted rows)
      let docId: DocumentId | undefined;
      if (!insertTempId) {
        if (currentPath.length === 0) {
          const idCell = rowData._id;
          const id =
            idCell && typeof idCell === "object" && "value" in idCell
              ? (idCell as { value?: unknown }).value
              : idCell;
          if (id !== undefined && id !== null) {
            docId = id as DocumentId;
          }
        } else {
          docId = currentDocumentId || undefined;
        }

        if (!docId) {
          logger.warn(
            "document-data",
            "Cannot create edit command: no document ID",
          );
          return null;
        }
      }

      // Build the field path for nested updates
      const isArrayLevelEdit =
        currentPath.length > 0 &&
        currentPath[currentPath.length - 1]?.type === "array";
      const arrayIndex = isArrayLevelEdit
        ? (rowData.__index as { value?: unknown } | undefined)?.value
        : undefined;

      // In KV mode (nested single object), resolve the actual key from the row
      const kvKeyValue =
        isNestedSingleObject && column.field === KV_VALUE_FIELD
          ? (rowData[KV_KEY_FIELD] as { value?: unknown } | undefined)?.value
          : undefined;
      const resolvedField =
        typeof kvKeyValue === "string" ? kvKeyValue : column.field;

      const fieldPath =
        currentPath.length > 0
          ? [
              ...currentPath.map((s) => s.key),
              ...(isArrayLevelEdit && typeof arrayIndex === "number"
                ? [arrayIndex, resolvedField]
                : [resolvedField]),
            ].join(".")
          : resolvedField;

      // Extract the actual value from the cell (convert to JsonValue)
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

      const primaryKeys: Record<string, JsonValue> = insertTempId
        ? {}
        : { _id: docId as JsonValue };
      if (isArrayLevelEdit && typeof arrayIndex === "number" && !insertTempId) {
        primaryKeys[ARRAY_INDEX_FIELD] = arrayIndex;
      }
      // In KV mode, add __kv_key so useStagedChangesIndicator can uniquely
      // identify each row (all KV rows share the same _id).
      if (isNestedSingleObject && !insertTempId) {
        primaryKeys[KV_KEY_FIELD] = resolvedField as JsonValue;
      }

      const payload: DataUpdatePayload = {
        column: fieldPath,
        primaryKeys,
        oldValue: oldValueJson,
        newValue: newValueJson,
        ...(insertTempId ? { tempId: insertTempId } : {}),
      };

      return {
        id: nanoid(),
        type: "data.update",
        target: {
          connectionId,
          database,
          table: collection,
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: `Update ${fieldPath}`,
          // Grid column field for staged change display (may differ from
          // fieldPath when in KV mode, e.g. "__kv_value" vs "address.city")
          gridColumn: column.field,
        },
        state: "staged",
      };
    },
    [
      currentPath,
      currentDocumentId,
      connectionId,
      database,
      collection,
      isNestedSingleObject,
    ],
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
        type: "data.insert",
        target: {
          connectionId,
          database,
          table: collection,
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: "Insert document",
        },
        state: "staged",
      };
    },
    [connectionId, database, collection],
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
        type: "data.delete",
        target: {
          connectionId,
          database,
          table: collection,
        },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: "Delete document",
        },
        state: "staged",
      };
    },
    [connectionId, database, collection],
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
        const idText =
          typeof idValue === "string" || typeof idValue === "number"
            ? String(idValue)
            : JSON.stringify(idValue);
        return `${collection}:${idText}`;
      }
      return `${collection}:row-${index}`;
    },
    [collection],
  );

  const commandPrimaryKeyColumns = useMemo<string[]>(() => {
    if (isNestedSingleObject) {
      return [KV_KEY_FIELD];
    }
    if (isArrayLevel) {
      return [ARRAY_INDEX_FIELD];
    }
    return ["_id"];
  }, [isNestedSingleObject, isArrayLevel]);

  // Tree view edit: build a data.update command from docIndex + fieldPath + newValue
  const createTreeEditCommand = useCallback(
    (docIndex: number, fieldPath: string, newValue: unknown): CrudCommand | null => {
      const doc = documents[docIndex];
      if (!doc) return null;

      // Get the document _id
      const idRaw = (doc as Record<string, unknown>)._id;
      if (idRaw === undefined || idRaw === null) {
        logger.warn("document-data", "Cannot create tree edit command: no document _id");
        return null;
      }
      const docId = idRaw as JsonValue;

      // Resolve old value by walking the field path
      const pathParts = fieldPath.split(".");
      let oldVal: unknown = doc;
      for (const part of pathParts) {
        if (oldVal && typeof oldVal === "object") {
          oldVal = (oldVal as Record<string, unknown>)[part];
        } else {
          oldVal = undefined;
          break;
        }
      }

      const payload: DataUpdatePayload = {
        column: fieldPath,
        primaryKeys: { _id: docId },
        oldValue: (oldVal === undefined ? null : oldVal) as JsonValue,
        newValue: newValue as JsonValue,
      };

      return {
        id: nanoid(),
        type: "data.update",
        target: { connectionId, database, table: collection },
        payload,
        metadata: {
          timestamp: new Date().toISOString(),
          description: `Update ${fieldPath}`,
        },
        state: "staged",
      };
    },
    [documents, connectionId, database, collection],
  );

  // CrudCommandFactory for BaseDataGrid integration
  // Available at all depths — edit commands build correct nested field paths.
  // Insert/delete are only meaningful at root level.
  const commandFactory = useMemo<CrudCommandFactory | undefined>(() => {
    return {
      connectionId,
      database,
      schema: undefined, // MongoDB doesn't use schemas
      table: collection,
      primaryKeyColumns: commandPrimaryKeyColumns,
      columnNameToFieldMap,
      columnByFieldMap,
      getRowKey,

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
    connectionId,
    database,
    collection,
    commandPrimaryKeyColumns,
    columnNameToFieldMap,
    columnByFieldMap,
    getRowKey,
    createEditCommand,
    createInsertCommand,
    createDeleteCommand,
  ]);

  return {
    paradigm: "document",
    rows,
    columns,
    getCellContent,
    isLoading,
    isLoadingMore: currentPath.length === 0 ? isLoadingMore : false,
    error,
    hasMore,
    fetchNextPage,
    refetch,
    executionTime,
    currentPath,
    isNestedSingleObject,
    canStepInto,
    stepInto,
    stepOut,
    navigateToPath,
    getCurrentDocumentId,
    totalCount,
    schemaSample,
    rawDocuments: documents as Record<string, unknown>[],
    createEditCommand,
    createTreeEditCommand,
    createInsertCommand,
    createDeleteCommand,
    commandFactory,
  };
}
