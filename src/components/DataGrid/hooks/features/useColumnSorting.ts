import { useCallback, useMemo } from 'react';
import { useGridPreferencesStore } from '../../stores';
import type { GridColumnV2 } from '../../types';
import type { DrawHeaderCallback } from '@glideapps/glide-data-grid';
import { createDrawHeader } from '../../utils/headerUtils';

export interface SortColumn {
  columnId: string;
  direction: 'asc' | 'desc';
}

interface UseColumnSortingParams {
  gridId: string;
  columns: GridColumnV2[];
}

interface UseColumnSortingResult {
  sortColumns: SortColumn[];
  getSortIndex: (columnId: string) => number | undefined;
  getSortDirection: (columnId: string) => 'asc' | 'desc' | null;
  toggleSort: (columnId: string, multiSort: boolean) => void;
  handleHeaderClick: (colIndex: number, event: { shiftKey: boolean }) => void;
  drawHeader: DrawHeaderCallback;
}

const EMPTY_SORT_COLUMNS: SortColumn[] = [];

export function useColumnSorting({
  gridId,
  columns,
}: UseColumnSortingParams): UseColumnSortingResult {
  // Get sort columns from preferences store
  // Use a stable empty array to prevent unnecessary re-renders
  const sortColumns = useGridPreferencesStore(
    (state) => state.preferences[gridId]?.sortColumns ?? EMPTY_SORT_COLUMNS
  );

  const getSortIndex = useCallback(
    (columnId: string): number | undefined => {
      const index = sortColumns.findIndex((s) => s.columnId === columnId);
      return index >= 0 ? index + 1 : undefined;
    },
    [sortColumns]
  );

  const getSortDirection = useCallback(
    (columnId: string): 'asc' | 'desc' | null => {
      const sortCol = sortColumns.find((s) => s.columnId === columnId);
      return sortCol?.direction ?? null;
    },
    [sortColumns]
  );

  const toggleSort = useCallback(
    (columnId: string, multiSort: boolean) => {
      const store = useGridPreferencesStore.getState();
      store.toggleColumnSort(gridId, columnId, multiSort);
    },
    [gridId]
  );

  const handleHeaderClick = useCallback(
    (colIndex: number, event: { shiftKey: boolean }) => {
      const column = columns[colIndex];
      if (!column) return;
      toggleSort(column.id, event.shiftKey);
    },
    [columns, toggleSort]
  );

  // Custom header draw function for sort indicators and column type icons
  const drawHeader: DrawHeaderCallback = useMemo(
    () =>
      createDrawHeader({
        getSortDirection,
        getSortIndex: (columnId: string) => getSortIndex(columnId) ?? -1,
        columns,
        sortedColumnCount: sortColumns.length,
      }),
    [getSortDirection, getSortIndex, columns, sortColumns.length],
  );

  return {
    sortColumns,
    getSortIndex,
    getSortDirection,
    toggleSort,
    handleHeaderClick,
    drawHeader,
  };
}
