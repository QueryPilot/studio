import { useState, useCallback, useRef, useEffect } from "react";

interface ColumnConfig {
  key: string;
  minWidth: number;
  defaultWidth: number;
  maxWidth?: number;
}

interface UseColumnResizingProps {
  columns: ColumnConfig[];
  storageKey?: string;
}

export function useColumnResizing({ columns, storageKey }: UseColumnResizingProps) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    // Load from localStorage if available
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch {
          // Fall back to defaults
        }
      }
    }

    // Initialize with default widths
    return columns.reduce((acc, col) => ({
      ...acc,
      [col.key]: col.defaultWidth
    }), {});
  });

  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);

  // Save to localStorage when widths change
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(columnWidths));
    }
  }, [columnWidths, storageKey]);

  const handleMouseDown = useCallback((e: React.MouseEvent, columnKey: string) => {
    e.preventDefault();
    setResizingColumn(columnKey);
    startX.current = e.clientX;
    startWidth.current = columnWidths[columnKey];
  }, [columnWidths]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!resizingColumn) return;

    const column = columns.find(c => c.key === resizingColumn);
    if (!column) return;

    const diff = e.clientX - startX.current;
    const newWidth = startWidth.current + diff;

    // Clamp to min/max
    const clampedWidth = Math.max(
      column.minWidth,
      Math.min(newWidth, column.maxWidth || 1000)
    );

    setColumnWidths(prev => ({
      ...prev,
      [resizingColumn]: clampedWidth
    }));
  }, [resizingColumn, columns]);

  const handleMouseUp = useCallback(() => {
    setResizingColumn(null);
  }, []);

  // Set up global mouse event listeners
  useEffect(() => {
    if (resizingColumn) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [resizingColumn, handleMouseMove, handleMouseUp]);

  const resetColumn = useCallback((columnKey: string) => {
    const column = columns.find(c => c.key === columnKey);
    if (column) {
      setColumnWidths(prev => ({
        ...prev,
        [columnKey]: column.defaultWidth
      }));
    }
  }, [columns]);

  const resetAllColumns = useCallback(() => {
    setColumnWidths(
      columns.reduce((acc, col) => ({
        ...acc,
        [col.key]: col.defaultWidth
      }), {})
    );
  }, [columns]);

  return {
    columnWidths,
    resizingColumn,
    handleMouseDown,
    resetColumn,
    resetAllColumns,
  };
}