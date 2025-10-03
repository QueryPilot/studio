import { useCallback, useEffect, useMemo, useState } from "react";
import type { GridColumnV2 } from "../types";

export interface UseColumnVisibilityOptions {
  columns: GridColumnV2[];
  initialHidden?: string[] | Record<string, boolean>;
  onChange?: (visibility: Record<string, boolean>) => void;
}

export interface UseColumnVisibilityResult {
  visibleColumns: GridColumnV2[];
  hiddenColumns: GridColumnV2[];
  visibilityMap: Record<string, boolean>;
  isColumnVisible: (columnId: string) => boolean;
  setColumnVisibility: (columnId: string, isVisible: boolean) => void;
  toggleColumnVisibility: (columnId: string) => void;
  resetVisibility: (next?: string[] | Record<string, boolean>) => void;
}

const buildVisibilityMap = (
  columns: GridColumnV2[],
  initialHidden?: string[] | Record<string, boolean>,
): Record<string, boolean> => {
  const map: Record<string, boolean> = {};
  const hiddenSet = new Set<string>();

  if (Array.isArray(initialHidden)) {
    initialHidden.forEach((id) => hiddenSet.add(id));
  } else if (initialHidden && typeof initialHidden === "object") {
    Object.entries(initialHidden).forEach(([id, isVisible]) => {
      if (!isVisible) {
        hiddenSet.add(id);
      }
    });
  }

  columns.forEach((column) => {
    map[column.id] = !hiddenSet.has(column.id);
  });

  return map;
};

export function useColumnVisibility(
  options: UseColumnVisibilityOptions,
): UseColumnVisibilityResult {
  const { columns, initialHidden, onChange } = options;

  const [visibilityMap, setVisibilityMap] = useState<Record<string, boolean>>(
    () => buildVisibilityMap(columns, initialHidden),
  );

  useEffect(() => {
    setVisibilityMap((prev) => {
      const next = { ...prev };
      const validIds = new Set(columns.map((column) => column.id));
      // Remove stale ids
      Object.keys(next).forEach((key) => {
        if (!validIds.has(key)) {
          delete next[key];
        }
      });
      columns.forEach((column) => {
        if (!(column.id in next)) {
          next[column.id] = true;
        }
      });
      return next;
    });
  }, [columns]);

  // Removed useEffect to prevent circular updates - onChange is now called directly in setters

  const setColumnVisibility = useCallback<
    UseColumnVisibilityResult["setColumnVisibility"]
  >(
    (columnId, isVisible) => {
      setVisibilityMap((prev) => {
        if (prev[columnId] === isVisible) return prev;
        const next = {
          ...prev,
          [columnId]: isVisible,
        };
        onChange?.(next);
        return next;
      });
    },
    [onChange],
  );

  const toggleColumnVisibility = useCallback<
    UseColumnVisibilityResult["toggleColumnVisibility"]
  >(
    (columnId) => {
      setVisibilityMap((prev) => {
        const next = {
          ...prev,
          [columnId]: !(prev[columnId] ?? true),
        };
        onChange?.(next);
        return next;
      });
    },
    [onChange],
  );

  const resetVisibility = useCallback<
    UseColumnVisibilityResult["resetVisibility"]
  >(
    (next) => {
      const newMap = buildVisibilityMap(columns, next);
      setVisibilityMap(newMap);
      onChange?.(newMap);
    },
    [columns, onChange],
  );

  const { visibleColumns, hiddenColumns } = useMemo(() => {
    const visible: GridColumnV2[] = [];
    const hidden: GridColumnV2[] = [];
    columns.forEach((column) => {
      const isVisible = visibilityMap[column.id] ?? true;
      const nextColumn = { ...column, isVisible };
      if (isVisible) {
        visible.push(nextColumn);
      } else {
        hidden.push(nextColumn);
      }
    });
    return { visibleColumns: visible, hiddenColumns: hidden };
  }, [columns, visibilityMap]);

  const isColumnVisible = useCallback<
    UseColumnVisibilityResult["isColumnVisible"]
  >(
    (columnId) => visibilityMap[columnId] ?? true,
    [visibilityMap],
  );

  return {
    visibleColumns,
    hiddenColumns,
    visibilityMap,
    isColumnVisible,
    setColumnVisibility,
    toggleColumnVisibility,
    resetVisibility,
  };
}
