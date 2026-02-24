import { useState, useCallback, useEffect, useRef } from 'react';
import type { GridColumnV2 } from '../../types';

interface UseColumnPinningParams {
  columns: GridColumnV2[];
  initialPinned?: string[];
  onChange?: (pinned: string[]) => void;
}

interface UseColumnPinningResult {
  pinnedColumns: string[];
  pin: (columnId: string) => void;
  unpin: (columnId: string) => void;
  toggle: (columnId: string) => void;
  isPinned: (columnId: string) => boolean;
}

export function useColumnPinning({
  columns,
  initialPinned = [],
  onChange,
}: UseColumnPinningParams): UseColumnPinningResult {
  const [pinnedColumns, setPinnedColumns] = useState<string[]>(initialPinned);

  // Use ref pattern to avoid infinite loops with onChange
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const pin = useCallback(
    (columnId: string) => {
      // Validate column exists
      if (!columns.some((col) => col.id === columnId)) {
        console.warn(`Cannot pin non-existent column: ${columnId}`);
        return;
      }
      setPinnedColumns((prev) => {
        if (prev.includes(columnId)) return prev;
        const updated = [...prev, columnId];
        onChangeRef.current?.(updated);
        return updated;
      });
    },
    [columns]
  );

  const unpin = useCallback(
    (columnId: string) => {
      setPinnedColumns((prev) => {
        const updated = prev.filter((id) => id !== columnId);
        onChangeRef.current?.(updated);
        return updated;
      });
    },
    []
  );

  const toggle = useCallback(
    (columnId: string) => {
      setPinnedColumns((prev) => {
        const updated = prev.includes(columnId)
          ? prev.filter((id) => id !== columnId)
          : [...prev, columnId];
        onChangeRef.current?.(updated);
        return updated;
      });
    },
    []
  );

  const isPinned = useCallback(
    (columnId: string) => pinnedColumns.includes(columnId),
    [pinnedColumns]
  );

  return {
    pinnedColumns,
    pin,
    unpin,
    toggle,
    isPinned,
  };
}
