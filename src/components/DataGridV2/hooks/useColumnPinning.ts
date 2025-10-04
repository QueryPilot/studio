import { useCallback, useEffect, useMemo, useState } from "react";
import type { GridColumnV2 } from "../types";

export interface UseColumnPinningOptions {
  columns: GridColumnV2[];
  initialPinned?: string[];
  maxPinned?: number;
  onChange?: (pinned: string[]) => void;
  /** Prevent pinning when max would be exceeded instead of trimming oldest. */
  enforceLimit?: boolean;
}

export interface UseColumnPinningResult {
  pinnedColumns: string[];
  canPinMore: boolean;
  isPinned: (columnId: string) => boolean;
  pinColumn: (columnId: string) => void;
  unpinColumn: (columnId: string) => void;
  toggleColumnPinned: (columnId: string) => void;
  setPinnedColumns: (next: string[]) => void;
}

const DEFAULT_MAX_PINNED = 5;

const sanitizePinned = (
  nextPinned: string[] | undefined,
  columns: GridColumnV2[],
  maxPinned: number,
): string[] => {
  if (!nextPinned || nextPinned.length === 0) return [];
  const validIds = new Set(columns.map((column) => column.id));
  const deduped: string[] = [];
  nextPinned.forEach((id) => {
    if (!validIds.has(id)) return;
    if (deduped.includes(id)) return;
    if (deduped.length >= maxPinned) return;
    deduped.push(id);
  });
  return deduped;
};

export function useColumnPinning(
  options: UseColumnPinningOptions,
): UseColumnPinningResult {
  const {
    columns,
    initialPinned,
    maxPinned = DEFAULT_MAX_PINNED,
    onChange,
    enforceLimit = true,
  } = options;

  const [pinnedColumns, setPinnedColumnsState] = useState<string[]>(() =>
    sanitizePinned(initialPinned, columns, maxPinned),
  );

  const arraysEqual = (a: string[], b: string[]): boolean => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  };

  useEffect(() => {
    setPinnedColumnsState((prev) => {
      const next = sanitizePinned(prev, columns, maxPinned);
      return arraysEqual(next, prev) ? prev : next;
    });
  }, [columns, maxPinned]);

  useEffect(() => {
    onChange?.(pinnedColumns);
  }, [onChange, pinnedColumns]);

  const setPinnedColumns = useCallback<
    UseColumnPinningResult["setPinnedColumns"]
  >(
    (next) => {
      setPinnedColumnsState((prev) => {
        const sanitized = sanitizePinned(next, columns, maxPinned);
        return arraysEqual(sanitized, prev) ? prev : sanitized;
      });
    },
    [columns, maxPinned],
  );

  const pinColumn = useCallback<UseColumnPinningResult["pinColumn"]>(
    (columnId) => {
      setPinnedColumnsState((prev) => {
        if (prev.includes(columnId)) return prev;
        const available = columns.some((column) => column.id === columnId);
        if (!available) return prev;
        if (prev.length >= maxPinned) {
          if (enforceLimit) {
            return prev;
          }
          const [, ...rest] = [...prev, columnId];
          return rest.slice(-maxPinned);
        }
        return [...prev, columnId];
      });
    },
    [columns, enforceLimit, maxPinned],
  );

  const unpinColumn = useCallback<UseColumnPinningResult["unpinColumn"]>(
    (columnId) => {
      setPinnedColumnsState((prev) => prev.filter((id) => id !== columnId));
    },
    [],
  );

  const toggleColumnPinned = useCallback<
    UseColumnPinningResult["toggleColumnPinned"]
  >(
    (columnId) => {
      setPinnedColumnsState((prev) => {
        if (prev.includes(columnId)) {
          return prev.filter((id) => id !== columnId);
        }
        const available = columns.some((column) => column.id === columnId);
        if (!available) return prev;
        if (prev.length >= maxPinned) {
          if (enforceLimit) {
            return prev;
          }
          const [, ...rest] = [...prev, columnId];
          return rest.slice(-maxPinned);
        }
        return [...prev, columnId];
      });
    },
    [columns, enforceLimit, maxPinned],
  );

  const isPinned = useCallback<UseColumnPinningResult["isPinned"]>(
    (columnId) => pinnedColumns.includes(columnId),
    [pinnedColumns],
  );

  const canPinMore = useMemo(
    () => pinnedColumns.length < maxPinned,
    [maxPinned, pinnedColumns.length],
  );

  return {
    pinnedColumns,
    canPinMore,
    isPinned,
    pinColumn,
    unpinColumn,
    toggleColumnPinned,
    setPinnedColumns,
  };
}
