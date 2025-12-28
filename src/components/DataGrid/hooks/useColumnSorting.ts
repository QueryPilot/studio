import { useMemo, useCallback } from "react";
import type { GridRowModel, SortColumn, GridColumnV2 } from "../types";
import { useGridPreferencesStore } from "../stores/gridPreferencesStore";

const EMPTY_SORT_COLUMNS: SortColumn[] = [];

interface UseColumnSortingOptions {
  gridId: string;
  columns: GridColumnV2[];
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
}: UseColumnSortingOptions): UseColumnSortingResult {
  const sortColumns = useGridPreferencesStore(
    (state) => state.preferences[gridId]?.sortColumns ?? EMPTY_SORT_COLUMNS
  );
  const toggleColumnSort = useGridPreferencesStore((state) => state.toggleColumnSort);
  const clearSortAction = useGridPreferencesStore((state) => state.clearSort);

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
          const aVal = a[field];
          const bVal = b[field];

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
    (columnId: string, multiSort) => {
      toggleColumnSort(gridId, columnId, multiSort);
    },
    [gridId, toggleColumnSort]
  );

  const clearSort = useCallback(() => {
    clearSortAction(gridId);
  }, [gridId, clearSortAction]);

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
