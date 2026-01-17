import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridRowModel } from "../types";

export interface UseRowPinningOptions {
  rows: GridRowModel[];
  initialPinned?: string[];
  maxPinnedRows?: number;
  getRowId?: (row: GridRowModel, index: number) => string;
  onChange?: (pinnedRowIds: string[]) => void;
}

export interface UseRowPinningResult {
  pinnedRows: GridRowModel[];
  unpinnedRows: GridRowModel[];
  pinnedRowIds: string[];
  isPinned: (rowId: string) => boolean;
  togglePinRow: (rowId: string) => void;
  pinRow: (rowId: string) => void;
  unpinRow: (rowId: string) => void;
  clearPinnedRows: () => void;
  canPinMore: boolean;
}

const DEFAULT_MAX_PINNED = 10;

export function useRowPinning(
  options: UseRowPinningOptions
): UseRowPinningResult {
  const {
    rows,
    initialPinned = [],
    maxPinnedRows = DEFAULT_MAX_PINNED,
    getRowId = (_row, index) => `row-${index}`,
    onChange,
  } = options;

  const [pinnedRowIds, setPinnedRowIds] = useState<string[]>(initialPinned);
  const isInitialMount = useRef(true);

  // Use ref to avoid infinite loops when onChange is not memoized
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Call onChange via useEffect to avoid setState-during-render
  useEffect(() => {
    // Skip the initial mount to avoid unnecessary onChange call
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    onChangeRef.current?.(pinnedRowIds);
  }, [pinnedRowIds]);

  const rowIdMap = useMemo(() => {
    const map = new Map<string, GridRowModel>();
    rows.forEach((row, index) => {
      const id = getRowId(row, index);
      map.set(id, row);
    });
    return map;
  }, [rows, getRowId]);

  const { pinnedRows, unpinnedRows } = useMemo(() => {
    const pinned: GridRowModel[] = [];
    const unpinned: GridRowModel[] = [];
    const pinnedSet = new Set(pinnedRowIds);

    // First add pinned rows in order
    pinnedRowIds.forEach(id => {
      const row = rowIdMap.get(id);
      if (row) {
        pinned.push(row);
      }
    });

    // Then add unpinned rows
    rows.forEach((row, index) => {
      const id = getRowId(row, index);
      if (!pinnedSet.has(id)) {
        unpinned.push(row);
      }
    });

    return { pinnedRows: pinned, unpinnedRows: unpinned };
  }, [rows, pinnedRowIds, rowIdMap, getRowId]);

  const isPinned = useCallback(
    (rowId: string) => pinnedRowIds.includes(rowId),
    [pinnedRowIds]
  );

  const pinRow = useCallback(
    (rowId: string) => {
      setPinnedRowIds(prev => {
        if (prev.includes(rowId) || prev.length >= maxPinnedRows) {
          return prev;
        }
        return [...prev, rowId];
      });
    },
    [maxPinnedRows]
  );

  const unpinRow = useCallback(
    (rowId: string) => {
      setPinnedRowIds(prev => {
        const next = prev.filter(id => id !== rowId);
        if (next.length === prev.length) return prev;
        return next;
      });
    },
    []
  );

  const togglePinRow = useCallback(
    (rowId: string) => {
      if (isPinned(rowId)) {
        unpinRow(rowId);
      } else {
        pinRow(rowId);
      }
    },
    [isPinned, pinRow, unpinRow]
  );

  const clearPinnedRows = useCallback(() => {
    setPinnedRowIds([]);
  }, []);

  const canPinMore = pinnedRowIds.length < maxPinnedRows;

  return {
    pinnedRows,
    unpinnedRows,
    pinnedRowIds,
    isPinned,
    togglePinRow,
    pinRow,
    unpinRow,
    clearPinnedRows,
    canPinMore,
  };
}