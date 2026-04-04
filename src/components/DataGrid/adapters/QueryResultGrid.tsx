/**
 * QueryResultGrid - Read-only grid for displaying query results
 *
 * This is a thin wrapper around BaseDataGrid optimized for query results:
 * - Read-only (no CRUD)
 * - Supports streaming results
 * - Shows query performance metrics
 * - Client-side filtering only
 */
import { memo, startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { BaseDataGrid } from '../base/BaseDataGrid';
import type { GridColumnV2, GridRowModel } from '../types';
import { computeBaseWidth } from './columnUtils';
import { DataGridErrorState } from '../components/DataGridStates';
import { DataGridSkeleton } from '../components/DataGridSkeleton';
import type { ColumnMeta } from '@/types/database';
import {
  deriveValueType,
} from '@/services/tableDataTransform';
import type { RawCellValue } from '@/services/backend';

export interface QueryResultGridProps {
  gridId: string;
  /** Raw query result data */
  data?: {
    columns: string[];
    columnMeta?: ColumnMeta[];
    rows: unknown[][];
    rowCount?: number;
  };
  /** Database paradigm (defaults to 'sql' for backward compatibility) */
  paradigm?: 'sql' | 'document' | 'keyvalue';
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

type TransformedRowsCacheEntry = {
  transformed: GridRowModel[];
  transformedCount: number;
};

const transformedRowsCache = new WeakMap<readonly unknown[], TransformedRowsCacheEntry>();

export const QueryResultGrid = memo(function QueryResultGrid(props: QueryResultGridProps) {
  const {
    gridId,
    data,
    paradigm = 'sql', // Default to SQL for backward compatibility
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

  // Defer data so React can interrupt re-renders for large result sets
  const deferredData = useDeferredValue(data);
  const [, setDrainTick] = useState(0);

  const rows = (() => {
    if (!deferredData?.rows) {
      return [];
    }

    const columnMeta = deferredData.columnMeta;
    const columnNames = deferredData.columns;

    const rawRows = deferredData.rows;
    let cache = transformedRowsCache.get(rawRows);
    if (!cache || rawRows.length < cache.transformedCount) {
      cache = { transformed: [], transformedCount: 0 };
      transformedRowsCache.set(rawRows, cache);
    }

    // Check if already transformed (first row is object, not array)
    const firstRow = rawRows[0];
    if (firstRow && typeof firstRow === 'object' && !Array.isArray(firstRow)) {
      return rawRows as unknown as GridRowModel[];
    }

    if (cache.transformedCount >= rawRows.length) {
      return cache.transformed;
    }

    // Incremental transformation - only transform NEW rows
    // Cap per-render work to avoid long main-thread blocks
    const MAX_ROWS_PER_RENDER = 5000;
    const numColumns = columnMeta?.length ?? columnNames.length;
    const startIndex = cache.transformedCount;
    const endIndex = Math.min(rawRows.length, startIndex + MAX_ROWS_PER_RENDER);
    const newRows = (rawRows as RawCellValue[][]).slice(startIndex, endIndex);

    const newTransformed = newRows.map((row) => {
      const tableRow: GridRowModel = {};
      for (let index = 0; index < numColumns; index++) {
        const col = columnMeta?.[index];
        const rawValue = row[index];
        // BigInt→string normalization happens in the Web Worker (streamDecode.worker.ts).
        // Skip redundant normalizeBackendValue — structured clone already deep-copies.
        tableRow[`col_${index}`] = {
          value: rawValue ?? null,
          db_type: col?.db_type ?? 'text',
          value_type: deriveValueType(rawValue, col?.db_type ?? 'text'),
          is_truncated: false,
        };
      }
      return tableRow;
    });

    // Mutate in place to avoid O(n) copy on each progressive render
    cache.transformed.push(...newTransformed);
    cache.transformedCount = endIndex;

    return cache.transformed;
  })();

  const needsMoreTransforms = (() => {
    const rawRows = deferredData?.rows;
    if (!rawRows?.length) {
      return false;
    }

    const firstRow = rawRows[0];
    if (firstRow && typeof firstRow === 'object' && !Array.isArray(firstRow)) {
      return false;
    }

    return rows.length < rawRows.length;
  })();

  const estimatedTotalRows = deferredData?.rowCount ?? deferredData?.rows.length;
  const hasPendingRows =
    needsMoreTransforms ||
    (isStreaming &&
      typeof estimatedTotalRows === 'number' &&
      estimatedTotalRows > rows.length);
  const rowCountLoadingState = isStreaming
    ? 'streaming'
    : hasPendingRows
      ? 'rendering'
      : undefined;

  useEffect(() => {
    if (!needsMoreTransforms) {
      return;
    }

    const timer = window.setTimeout(() => {
      startTransition(() => {
        setDrainTick((tick) => tick + 1);
      });
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [needsMoreTransforms, deferredData, rows.length]);

  // Build columns from metadata
  const columns = useMemo<GridColumnV2[]>(() => {
    const columnMeta = deferredData?.columnMeta;
    const columnNames = deferredData?.columns;
    if (!columnNames) return [];

    const metaList = columnMeta ?? columnNames.map((name, idx): ColumnMeta => ({
      name,
      db_type: 'text',
      nullable: true,
      default: null,
      ordinal: idx,
      is_pk: false,
      is_fk: false,
    }));

    return metaList.map((meta, index) => ({
      id: `col_${index}`,
      field: `col_${index}`,
      title: meta.name,
      name: meta.name,
      width: computeBaseWidth(meta.name, meta.db_type),
      type: meta.db_type,
      meta,
    }));
  }, [deferredData?.columnMeta, deferredData?.columns]);

  // Loading state
  if (isLoading && rows.length === 0) {
    return <DataGridSkeleton />;
  }

  // Error state
  if (error) {
    return <DataGridErrorState error={error} />;
  }

  // Don't hide grid when empty - keep structure visible with overlay message

  return (
    <div className="relative h-full w-full">
      <BaseDataGrid
      gridId={gridId}
      rows={rows}
      columns={columns}
      connectionId=""
      paradigm={paradigm}
      readOnly={true}
      enableFiltering={true}
      enableSorting={true}
      enableExport={true}
      enableRowPinning={false}
      enableColumnManagement={true}
      enableClipboard={true}
      enableFillOperations={false}
      enableStagedChanges={false}
      isLoadingMore={isStreaming || hasPendingRows}
      hasMore={hasPendingRows}
      estimatedTotal={estimatedTotalRows}
      rowCountLoadingState={rowCountLoadingState}
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

    {/* Empty state overlay - shown when no rows but grid/filters remain visible */}
    {!isLoading && !isStreaming && rows.length === 0 && (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center space-y-2 p-8">
          <div className="text-muted-foreground text-sm font-medium">
            No results
          </div>
          <div className="text-muted-foreground/70 text-xs">
            Query returned no rows
          </div>
        </div>
      </div>
    )}
    </div>
  );
});
