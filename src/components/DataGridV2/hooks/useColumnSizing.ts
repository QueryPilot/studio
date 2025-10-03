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

  // Coalesce rapid drag events into a single state write per animation frame
  const resizeRafIdRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ columnId: string; width: number } | null>(
    null,
  );

  // Initialize widths on mount, not during render

  useEffect(() => {
    if (initialWidths && Object.keys(widthOverrides).length === 0) {
      const sanitized = sanitizeWidths(
        initialWidths,
        columns,
        minColumnWidth,
        maxColumnWidth,
      );
      setWidthOverrides(sanitized);
      // Don't call onChange during initialization to prevent infinite loops
      // onChange will be called when user actually resizes columns
    }
  }, [initialWidths, columns, minColumnWidth, maxColumnWidth, widthOverrides]);

  useEffect(() => {
    setWidthOverrides((prev) =>
      sanitizeWidths(prev, columns, minColumnWidth, maxColumnWidth),
    );
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
        onChange?.(next);
        return next;
      });
    },
    [maxColumnWidth, minColumnWidth, onChange],
  );

  const handleColumnResize = useCallback<
    UseColumnSizingResult["handleColumnResize"]
  >(
    (column, newSize) => {
      if (!column.id || newSize <= 0 || Number.isNaN(newSize)) return;
      const next = Math.round(newSize);
      if (widthOverrides[column.id] === next) return;
      pendingResizeRef.current = { columnId: column.id, width: next };
      if (resizeRafIdRef.current == null) {
        resizeRafIdRef.current = window.requestAnimationFrame(() => {
          const pending = pendingResizeRef.current;
          resizeRafIdRef.current = null;
          if (pending) {
            setColumnWidth(pending.columnId, pending.width);
          }
        });
      }
    },
    [setColumnWidth, widthOverrides],
  );

  const handleColumnResizeEnd = useCallback<
    UseColumnSizingResult["handleColumnResizeEnd"]
  >(
    (column, newSize) => {
      if (!column.id) return;
      if (newSize <= 0) return;
      if (resizeRafIdRef.current != null) {
        cancelAnimationFrame(resizeRafIdRef.current);
        resizeRafIdRef.current = null;
      }
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

  const sizedColumns = useMemo(
    () =>
      columns.map((column) => {
        const override = widthOverrides[column.id];
        return override ? { ...column, width: override } : column;
      }),
    [columns, widthOverrides],
  );

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
