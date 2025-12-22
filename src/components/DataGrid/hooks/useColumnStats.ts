import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { GridRowModel } from "../types";
import type { ColumnStats } from "../utils/columnStats";
import { calculateColumnStats } from "../utils/columnStats";
import type { CellValue } from "@/types";

interface UseColumnStatsArgs {
  rows: GridRowModel[];
  columns: Array<{ field: string; name: string }>;
  enabled?: boolean;
}

interface ColumnStatsState {
  columnIndex: number;
  columnName: string;
  stats: ColumnStats;
  bounds: { x: number; y: number; width: number; height: number };
}

export function useColumnStats({
  rows,
  columns,
  enabled = true,
}: UseColumnStatsArgs) {
  const [statsState, setStatsState] = useState<ColumnStatsState | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Memoize column stats calculation - compute once per result set
  const columnStatsCache = useMemo(() => {
    if (!enabled || rows.length === 0) {
      return new Map<number, ColumnStats>();
    }

    // Convert rows to raw array format for stats calculation
    const rawRows = rows.map((row) =>
      columns.map((col) => {
        const cell = row[col.field] as CellValue | undefined;
        return cell?.value ?? null;
      }),
    );

    const cache = new Map<number, ColumnStats>();
    columns.forEach((_, index) => {
      cache.set(index, calculateColumnStats(rawRows, index));
    });

    return cache;
  }, [rows, columns, enabled]);

  const handleItemHovered = useCallback(
    (args: { kind: string; location: readonly [number, number]; bounds?: { x: number; y: number; width: number; height: number } }) => {
      // Clear existing timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }

      // Only handle header hover events
      if (args.kind !== "header" || !enabled || !args.bounds) {
        setStatsState(null);
        return;
      }

      const [colIndex] = args.location;

      // Debounce to avoid showing tooltip on quick passes
      hoverTimeoutRef.current = setTimeout(() => {
        const stats = columnStatsCache.get(colIndex);
        const column = columns[colIndex];

        if (stats && column && args.bounds) {
          setStatsState({
            columnIndex: colIndex,
            columnName: column.name,
            stats,
            bounds: args.bounds,
          });
        }
      }, 500); // 500ms delay before showing stats
    },
    [enabled, columnStatsCache, columns],
  );

  const clearStats = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setStatsState(null);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return {
    statsState,
    handleItemHovered,
    clearStats,
  };
}
