import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridColumn } from "@glideapps/glide-data-grid";
import type { GridColumnV2 } from "@/components/DataGrid/types";

export interface UseColumnSizingOptions {
  columns: GridColumnV2[];
  initialWidths?: Record<string, number>;
  minColumnWidth?: number;
  maxColumnWidth?: number;
  onChange?: (widths: Record<string, number>) => void;
}

export interface UseColumnSizingResult {
  sizedColumns: GridColumnV2[];
  columnWidths: Record<string, number>;
  handleColumnResize: (column: GridColumn, newSize: number) => void;
  handleColumnResizeEnd: (column: GridColumn, newSize: number) => void;
  setColumnWidth: (columnId: string, width: number) => void;
  autoSizeColumn: (
    columnId: string,
    measure: () => number | undefined | null,
  ) => void;
  resetColumnWidths: (next?: Record<string, number>) => void;
  isDragging: () => boolean;
}

const clampWidth = (
  width: number,
  minWidth?: number,
  maxWidth?: number,
): number => {
  const min = minWidth ?? 40;
  const max = maxWidth ?? 1200;
  return Math.min(Math.max(width, min), max);
};

const sanitizeWidths = (
  overrides: Record<string, number>,
  columns: GridColumnV2[],
  minColumnWidth?: number,
  maxColumnWidth?: number,
): Record<string, number> => {
  const columnIds = new Set(columns.map((col) => col.id));
  return Object.entries(overrides).reduce<Record<string, number>>(
    (acc, [columnId, width]) => {
      if (!columnIds.has(columnId)) return acc;
      acc[columnId] = clampWidth(width, minColumnWidth, maxColumnWidth);
      return acc;
    },
    {},
  );
};

export function useColumnSizing(
  options: UseColumnSizingOptions,
): UseColumnSizingResult {
  const { columns, initialWidths, minColumnWidth, maxColumnWidth, onChange } =
    options;

  const [widthOverrides, setWidthOverrides] = useState<Record<string, number>>(
    {},
  );

  // Track pending resize and drag state - no React state updates during drag for 60fps
  const pendingResizeRef = useRef<Record<string, number>>({});
  const isDraggingRef = useRef(false);
  const committedWidthsRef = useRef<Record<string, number>>({});

  // Initialize widths on mount, not during render
  useEffect(() => {
    if (initialWidths && Object.keys(widthOverrides).length === 0) {
      const sanitized = sanitizeWidths(
        initialWidths,
        columns,
        minColumnWidth,
        maxColumnWidth,
      );
      if (Object.keys(sanitized).length > 0) {
        setWidthOverrides(sanitized);
        committedWidthsRef.current = sanitized;
      }
      // Don't call onChange during initialization to prevent infinite loops
      // onChange will be called when user actually resizes columns
    }
  }, [initialWidths, columns, minColumnWidth, maxColumnWidth, widthOverrides]);

  useEffect(() => {
    setWidthOverrides((prev) => {
      const sanitized = sanitizeWidths(
        prev,
        columns,
        minColumnWidth,
        maxColumnWidth,
      );
      // Avoid state churn if nothing changes
      if (Object.keys(sanitized).length === Object.keys(prev).length) {
        let equal = true;
        for (const k of Object.keys(sanitized)) {
          if (sanitized[k] !== prev[k]) {
            equal = false;
            break;
          }
        }
        if (equal) return prev;
      }
      return sanitized;
    });
  }, [columns, maxColumnWidth, minColumnWidth]);

  // Removed useEffect to prevent circular updates - onChange is now called directly in setters

  const setColumnWidth = useCallback<UseColumnSizingResult["setColumnWidth"]>(
    (columnId, width) => {
      const nextWidth = clampWidth(width, minColumnWidth, maxColumnWidth);

      // Direct state update - our ref optimizations prevent expensive downstream work
      setWidthOverrides((prev) => {
        if (prev[columnId] === nextWidth) return prev;
        const next = {
          ...prev,
          [columnId]: nextWidth,
        };
        committedWidthsRef.current = next;
        // Only call onChange when not dragging (for persistence)
        if (!isDraggingRef.current) {
          onChange?.(next);
        }
        return next;
      });
    },
    [maxColumnWidth, minColumnWidth, onChange],
  );

  // Time-based throttle: update every 32ms (~30fps) for smooth animation with less overhead
  const lastUpdateTimeRef = useRef(0);
  const THROTTLE_MS = 32; // ~30fps (every 2 frames)

  const handleColumnResize = useCallback<
    UseColumnSizingResult["handleColumnResize"]
  >((column, newSize) => {
    if (!column.id || newSize <= 0 || Number.isNaN(newSize)) return;
    isDraggingRef.current = true;

    // Always store the latest value
    pendingResizeRef.current[column.id] = Math.round(newSize);

    // Time-based throttle: skip if updated recently
    const now = performance.now();
    if (now - lastUpdateTimeRef.current < THROTTLE_MS) return;
    lastUpdateTimeRef.current = now;

    // Batch update: apply all pending widths in single state update
    const pending = pendingResizeRef.current;
    if (Object.keys(pending).length === 0) return;

    setWidthOverrides((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const [columnId, width] of Object.entries(pending)) {
        if (prev[columnId] !== width) {
          next[columnId] = width;
          changed = true;
        }
      }

      if (!changed) return prev;
      committedWidthsRef.current = next;
      return next;
    });
  }, []);

  const handleColumnResizeEnd = useCallback<
    UseColumnSizingResult["handleColumnResizeEnd"]
  >(
    (column, newSize) => {
      if (!column.id) return;
      if (newSize <= 0) return;

      // Clear dragging flag FIRST
      isDraggingRef.current = false;

      // Reset throttle timer
      lastUpdateTimeRef.current = 0;

      // Get all pending width changes (including the final size)
      const pendingWidths = { ...pendingResizeRef.current };
      pendingWidths[column.id] = Math.round(newSize);

      // Clear pending ref
      pendingResizeRef.current = {};

      // Commit final widths with persistence
      if (Object.keys(pendingWidths).length > 0) {
        setWidthOverrides((prev) => {
          const next = { ...prev, ...pendingWidths };
          committedWidthsRef.current = next;
          // Call onChange for persistence
          onChange?.(next);
          return next;
        });
      }
    },
    [onChange],
  );

  const autoSizeColumn = useCallback<UseColumnSizingResult["autoSizeColumn"]>(
    (columnId, measure) => {
      const measured = measure();
      if (measured == null || Number.isNaN(measured) || measured <= 0) {
        return;
      }
      setColumnWidth(columnId, measured);
    },
    [setColumnWidth],
  );

  const resetColumnWidths = useCallback<
    UseColumnSizingResult["resetColumnWidths"]
  >(
    (next) => {
      if (next) {
        const sanitized = sanitizeWidths(
          next,
          columns,
          minColumnWidth,
          maxColumnWidth,
        );
        setWidthOverrides(sanitized);
        onChange?.(sanitized);
        return;
      }
      setWidthOverrides({});
      onChange?.({});
    },
    [columns, maxColumnWidth, minColumnWidth, onChange],
  );

  // Cache sized columns to avoid recreating unchanged column objects
  const sizedColumnsCache = useRef<Map<string, GridColumnV2>>(new Map());

  const sizedColumns = useMemo(() => {
    const cache = sizedColumnsCache.current;

    const result = columns.map((column) => {
      const override = widthOverrides[column.id];
      const targetWidth = override ?? column.width;
      const cached = cache.get(column.id);

      // Reuse cached column if width and base column haven't changed
      if (cached && cached.width === targetWidth && cached.id === column.id) {
        // Check if base column properties changed (other than width)
        if (
          cached.title === column.title &&
          cached.icon === column.icon &&
          cached.hasMenu === column.hasMenu
        ) {
          return cached;
        }
      }

      const sized = override ? { ...column, width: override } : column;
      cache.set(column.id, sized);
      return sized;
    });

    // Clean up stale cache entries
    if (cache.size > columns.length) {
      const columnIds = new Set(columns.map((c) => c.id));
      for (const key of cache.keys()) {
        if (!columnIds.has(key)) {
          cache.delete(key);
        }
      }
    }

    return result;
  }, [columns, widthOverrides]);

  const isDragging = useCallback(() => isDraggingRef.current, []);

  return {
    sizedColumns,
    columnWidths: widthOverrides,
    handleColumnResize,
    handleColumnResizeEnd,
    setColumnWidth,
    autoSizeColumn,
    resetColumnWidths,
    isDragging,
  };
}
