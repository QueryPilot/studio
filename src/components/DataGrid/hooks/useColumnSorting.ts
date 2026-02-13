import { useMemo, useCallback, useEffect } from "react";
import type { GridRowModel, SortColumn, GridColumnV2 } from "../types";
import { useGridPreferencesStore } from "../stores/gridPreferencesStore";

const EMPTY_SORT_COLUMNS: SortColumn[] = [];

interface UseColumnSortingOptions {
  gridId: string;
  columns: GridColumnV2[];
  /** When set, sort changes are also written to this key (write-through for per-tab sort isolation). */
  writeThroughGridId?: string;
}

interface UseColumnSortingResult {
  sortColumns: SortColumn[];
  sortedData: <T extends GridRowModel>(data: T[]) => T[];
  toggleSort: (columnId: string, multiSort?: boolean) => void;
  clearSort: () => void;
  getSortIndex: (columnId: string) => number;
  getSortDirection: (columnId: string) => 'asc' | 'desc' | null;
}

export function useColumnSorting({
  gridId,
  columns,
  writeThroughGridId,
}: UseColumnSortingOptions): UseColumnSortingResult {
  const sortColumns = useGridPreferencesStore(
    (state) => state.preferences[gridId]?.sortColumns ?? EMPTY_SORT_COLUMNS
  );
  const toggleColumnSort = useGridPreferencesStore((state) => state.toggleColumnSort);
  const clearSortAction = useGridPreferencesStore((state) => state.clearSort);

  // Initialize per-tab sort from shared key when the tab has no sort state yet
  const sharedSortColumns = useGridPreferencesStore(
    (state) => writeThroughGridId
      ? state.preferences[writeThroughGridId]?.sortColumns ?? EMPTY_SORT_COLUMNS
      : EMPTY_SORT_COLUMNS
  );

  useEffect(() => {
    if (!writeThroughGridId || writeThroughGridId === gridId) return;
    if (sortColumns.length > 0) return; // Already has sort state
    if (sharedSortColumns.length === 0) return; // Nothing to copy
    useGridPreferencesStore.getState().upsert(gridId, (draft) => {
      draft.sortColumns = [...sharedSortColumns];
    });
  }, [gridId, writeThroughGridId, sortColumns.length, sharedSortColumns]);

  const columnMap = useMemo(() => {
    const map = new Map<string, GridColumnV2>();
    for (const col of columns) {
      map.set(col.id, col);
    }
    return map;
  }, [columns]);

  const sortedData = useCallback(
    <T extends GridRowModel>(data: T[]): T[] => {
      if (sortColumns.length === 0) {
        return data;
      }

      return [...data].sort((a, b) => {
        for (const { columnId, direction } of sortColumns) {
          const column = columnMap.get(columnId);
          if (!column) continue;

          const field = column.field;
          const aCell = a[field];
          const bCell = b[field];

          // Extract actual values from GridCellValue objects
          const aVal = aCell && typeof aCell === 'object' && 'value' in aCell
            ? aCell.value
            : aCell;
          const bVal = bCell && typeof bCell === 'object' && 'value' in bCell
            ? bCell.value
            : bCell;

          let comparison = 0;

          if (aVal == null && bVal == null) {
            comparison = 0;
          } else if (aVal == null) {
            comparison = 1;
          } else if (bVal == null) {
            comparison = -1;
          } else if (typeof aVal === 'number' && typeof bVal === 'number') {
            comparison = aVal - bVal;
          } else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
            comparison = aVal === bVal ? 0 : aVal ? 1 : -1;
          } else if (aVal instanceof Date && bVal instanceof Date) {
            comparison = aVal.getTime() - bVal.getTime();
          } else {
            comparison = String(aVal).localeCompare(String(bVal));
          }

          if (comparison !== 0) {
            return direction === 'desc' ? -comparison : comparison;
          }
        }
        return 0;
      });
    },
    [sortColumns, columnMap]
  );

  const toggleSort = useCallback(
    (columnId: string, multiSort?: boolean) => {
      toggleColumnSort(gridId, columnId, multiSort ?? false);
      // Write-through: also update the shared key so new tabs inherit the latest sort
      if (writeThroughGridId && writeThroughGridId !== gridId) {
        toggleColumnSort(writeThroughGridId, columnId, multiSort ?? false);
      }
    },
    [gridId, writeThroughGridId, toggleColumnSort]
  );

  const clearSort = useCallback(() => {
    clearSortAction(gridId);
    if (writeThroughGridId && writeThroughGridId !== gridId) {
      clearSortAction(writeThroughGridId);
    }
  }, [gridId, writeThroughGridId, clearSortAction]);

  const getSortIndex = useCallback(
    (columnId: string): number => {
      const index = sortColumns.findIndex((s) => s.columnId === columnId);
      return index === -1 ? -1 : index + 1;
    },
    [sortColumns]
  );

  const getSortDirection = useCallback(
    (columnId: string): 'asc' | 'desc' | null => {
      const sort = sortColumns.find((s) => s.columnId === columnId);
      return sort?.direction ?? null;
    },
    [sortColumns]
  );

  return {
    sortColumns,
    sortedData,
    toggleSort,
    clearSort,
    getSortIndex,
    getSortDirection,
  };
}
