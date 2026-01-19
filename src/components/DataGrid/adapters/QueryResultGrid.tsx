/**
 * QueryResultGrid - Read-only grid for displaying query results
 *
 * This is a thin wrapper around BaseDataGrid optimized for query results:
 * - Read-only (no CRUD)
 * - Supports streaming results
 * - Shows query performance metrics
 * - Client-side filtering only
 */

import { memo, useMemo, useCallback, useRef } from 'react';
import type { Item, GridCell } from '@glideapps/glide-data-grid';
import { GridCellKind } from '@glideapps/glide-data-grid';
import { cn } from '@/lib/utils';
import { BaseDataGrid } from '../base/BaseDataGrid';
import type { GridColumnV2, GridRowModel } from '../types';
import { buildGridCellV2 } from '../utils/cellFactory';
import { computeBaseWidth } from './columnUtils';
import {
  DataGridEmptyState,
  DataGridErrorState,
} from '../components/DataGridStates';
import { DataGridSkeleton } from '../components/DataGridSkeleton';
import type { ColumnMeta, GridCellValue } from '@/types';
import {
  deriveValueType,
  normalizeBackendValue,
} from '@/services/tableDataTransform';
import type { CellValue as BackendCellValue } from '@/services/backend';

export interface QueryResultGridProps {
  gridId: string;
  /** Raw query result data */
  data?: {
    columns: string[];
    columnMeta?: ColumnMeta[];
    rows: unknown[][];
    rowCount?: number;
  };
  isLoading?: boolean;
  isStreaming?: boolean;
  error?: string | null;
  /** Query performance metrics */
  executionTime?: number;
  cursorSetupMs?: number;
  totalStreamingMs?: number;
  fetchCount?: number;
  networkMs?: number;
  conversionMs?: number;
  /** Actions to render in the toolbar (e.g., Pin, Export buttons) */
  toolbarActions?: React.ReactNode;
  className?: string;
}

export const QueryResultGrid = memo(function QueryResultGrid(props: QueryResultGridProps) {
  const {
    gridId,
    data,
    isLoading = false,
    isStreaming = false,
    error,
    executionTime,
    cursorSetupMs,
    totalStreamingMs,
    fetchCount,
    networkMs,
    conversionMs,
    toolbarActions,
    className,
  } = props;

  // Transform raw CellValue[][] to GridRowModel[] with incremental caching
  const transformedRowsCacheRef = useRef<{
    sourceRows: unknown[] | null;
    transformed: GridRowModel[];
    transformedCount: number;
  }>({ sourceRows: null, transformed: [], transformedCount: 0 });

  const rows = useMemo((): GridRowModel[] => {
    if (!data?.rows) {
      transformedRowsCacheRef.current = { sourceRows: null, transformed: [], transformedCount: 0 };
      return [];
    }

    const columnMeta = data.columnMeta;
    const columnNames = data.columns;
    if (!columnMeta && !columnNames) return [];

    const rawRows = data.rows;
    const cache = transformedRowsCacheRef.current;

    // Check if already transformed (first row is object, not array)
    const firstRow = rawRows[0];
    if (firstRow && typeof firstRow === 'object' && !Array.isArray(firstRow)) {
      return rawRows as unknown as GridRowModel[];
    }

    // Check if source changed (new query) - reset cache
    const sourceChanged = cache.sourceRows !== rawRows && (
      rawRows.length < cache.transformedCount ||
      cache.transformedCount === 0
    );

    if (sourceChanged) {
      cache.sourceRows = rawRows;
      cache.transformed = [];
      cache.transformedCount = 0;
    }

    if (cache.transformedCount >= rawRows.length) {
      return cache.transformed;
    }

    // Incremental transformation - only transform NEW rows
    const numColumns = columnMeta?.length ?? columnNames?.length ?? 0;
    const startIndex = cache.transformedCount;
    const newRows = (rawRows as BackendCellValue[][]).slice(startIndex);

    const newTransformed = newRows.map((row) => {
      const tableRow: GridRowModel = {};
      for (let index = 0; index < numColumns; index++) {
        const col = columnMeta?.[index];
        const rawValue = row[index];
        const normalizedValue = normalizeBackendValue(rawValue);
        tableRow[`col_${index}`] = {
          value: normalizedValue ?? null,
          db_type: col?.db_type ?? 'text',
          value_type: deriveValueType(rawValue, col?.db_type ?? 'text'),
          is_truncated: false,
        };
      }
      return tableRow;
    });

    cache.transformed = [...cache.transformed, ...newTransformed];
    cache.transformedCount = rawRows.length;
    cache.sourceRows = rawRows;

    return cache.transformed;
  }, [data?.rows, data?.columnMeta, data?.columns]);

  // Build columns from metadata
  const columns = useMemo<GridColumnV2[]>(() => {
    const columnMeta = data?.columnMeta;
    const columnNames = data?.columns;
    if (!columnMeta && !columnNames) return [];

    const metaList = columnMeta ?? columnNames?.map((name, idx): ColumnMeta => ({
      name,
      db_type: 'text',
      nullable: true,
      default: null,
      ordinal: idx,
      is_pk: false,
      is_fk: false,
    })) ?? [];

    return metaList.map((meta, index) => ({
      id: `col_${index}`,
      field: `col_${index}`,
      title: meta.name,
      name: meta.name,
      width: computeBaseWidth(meta.name, meta.db_type),
      type: meta.db_type,
      meta,
    }));
  }, [data?.columnMeta, data?.columns]);

  // Stable refs for getCellContent
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [colIndex, rowIndex] = cell;
      const column = columnsRef.current[colIndex];
      const row = rowsRef.current[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: '',
          displayData: '',
          allowOverlay: false,
          readonly: true,
        };
      }

      const cellValue = row[column.field] as GridCellValue | null | undefined;

      return buildGridCellV2({
        value: cellValue,
        column,
        readOnly: true,
      });
    },
    [rows] // Include rows to invalidate cache when data changes
  );

  // Loading state
  if (isLoading && rows.length === 0) {
    return <DataGridSkeleton />;
  }

  // Error state
  if (error) {
    return <DataGridErrorState error={error} />;
  }

  // Empty state
  if (!isLoading && !isStreaming && rows.length === 0) {
    return <DataGridEmptyState title="No results" description="Query returned no rows." />;
  }

  return (
    <BaseDataGrid
      gridId={gridId}
      rows={rows}
      columns={columns}
      connectionId=""
      paradigm="sql"
      readOnly={true}
      enableFiltering={true}
      enableSorting={true}
      enableExport={true}
      enableRowPinning={false}
      enableColumnManagement={true}
      enableClipboard={true}
      enableFillOperations={false}
      enableStagedChanges={false}
      isLoadingMore={isStreaming}
      estimatedTotal={data?.rowCount}
      getCellContent={getCellContent}
      toolbarActions={toolbarActions}
      // Performance metrics
      executionTime={executionTime}
      cursorSetupMs={cursorSetupMs}
      totalStreamingMs={totalStreamingMs}
      fetchCount={fetchCount}
      networkMs={networkMs}
      conversionMs={conversionMs}
      className={cn('flex-1', className)}
    />
  );
});
