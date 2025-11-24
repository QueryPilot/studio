import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridColumn } from "@glideapps/glide-data-grid";
import type { GridColumnV2 } from "../types";

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
  const pendingResizeRef = useRef<{ columnId: string; width: number } | null>(
    null,
  );
  const isDraggingRef = useRef(false);

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
      setWidthOverrides((prev) => {
        const nextWidth = clampWidth(width, minColumnWidth, maxColumnWidth);
        if (prev[columnId] === nextWidth) return prev;
        const next = {
          ...prev,
          [columnId]: nextWidth,
        };
        // Only call onChange when not dragging to avoid expensive updates during resize
        if (!isDraggingRef.current) {
          onChange?.(next);
        }
        return next;
      });
    },
    [maxColumnWidth, minColumnWidth, onChange],
  );

  // RAF-based resize for 60fps - coalesce multiple events per frame
  const resizeRafRef = useRef<number | null>(null);

  const handleColumnResize = useCallback<
    UseColumnSizingResult["handleColumnResize"]
  >(
    (column, newSize) => {
      if (!column.id || newSize <= 0 || Number.isNaN(newSize)) return;
      isDraggingRef.current = true;
      pendingResizeRef.current = { columnId: column.id, width: Math.round(newSize) };

      // Coalesce to single RAF per frame for 60fps
      if (resizeRafRef.current === null) {
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = null;
          const pending = pendingResizeRef.current;
          if (pending) {
            setColumnWidth(pending.columnId, pending.width);
          }
        });
      }
    },
    [setColumnWidth],
  );

  const handleColumnResizeEnd = useCallback<
    UseColumnSizingResult["handleColumnResizeEnd"]
  >(
    (column, newSize) => {
      if (!column.id) return;
      if (newSize <= 0) return;
      // Cancel pending RAF
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      // Clear dragging flag before final update so onChange fires
      isDraggingRef.current = false;
      pendingResizeRef.current = null;
      setColumnWidth(column.id, Math.round(newSize));
    },
    [setColumnWidth],
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
        if (cached.title === column.title &&
            cached.icon === column.icon &&
            cached.hasMenu === column.hasMenu) {
          return cached;
        }
      }

      const sized = override ? { ...column, width: override } : column;
      cache.set(column.id, sized);
      return sized;
    });

    // Clean up stale cache entries
    if (cache.size > columns.length) {
      const columnIds = new Set(columns.map(c => c.id));
      for (const key of cache.keys()) {
        if (!columnIds.has(key)) {
          cache.delete(key);
        }
      }
    }

    return result;
  }, [columns, widthOverrides]);

  return {
    sizedColumns,
    columnWidths: widthOverrides,
    handleColumnResize,
    handleColumnResizeEnd,
    setColumnWidth,
    autoSizeColumn,
    resetColumnWidths,
  };
}
