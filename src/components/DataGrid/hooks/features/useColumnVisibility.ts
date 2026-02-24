import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import type { GridColumnV2 } from '../../types';

interface UseColumnVisibilityParams {
  columns: GridColumnV2[];
  initialHidden?: string[];
  onChange?: (visibility: Record<string, boolean>) => void;
}

interface UseColumnVisibilityResult {
  visibleColumns: GridColumnV2[];
  visibility: Record<string, boolean>;
  isVisible: (columnId: string) => boolean;
  hide: (columnId: string) => void;
  show: (columnId: string) => void;
  toggle: (columnId: string) => void;
  showAll: () => void;
}

export function useColumnVisibility({
  columns,
  initialHidden = [],
  onChange,
}: UseColumnVisibilityParams): UseColumnVisibilityResult {
  // Use ref to avoid infinite loops in onChange
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Build initial visibility map
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    columns.forEach((col) => {
      map[col.id] = !initialHidden.includes(col.id);
    });
    return map;
  });

  // No sync effect - initialHidden is only for initialization
  // User changes via show/hide/toggle should persist

  // Add new columns as visible
  useEffect(() => {
    setVisibility((prev) => {
      const updated = { ...prev };
      let changed = false;

      columns.forEach((col) => {
        if (!(col.id in updated)) {
          updated[col.id] = true;
          changed = true;
        }
      });

      return changed ? updated : prev;
    });
  }, [columns]);

  const visibleColumns = useMemo(() => {
    return columns.filter((col) => visibility[col.id] !== false);
  }, [columns, visibility]);

  const isVisible = useCallback(
    (columnId: string) => visibility[columnId] !== false,
    [visibility]
  );

  const hide = useCallback(
    (columnId: string) => {
      // Validate column exists
      if (!columns.some((col) => col.id === columnId)) {
        return;
      }

      setVisibility((prev) => {
        if (prev[columnId] === false) return prev;
        const updated = { ...prev, [columnId]: false };
        onChangeRef.current?.(updated);
        return updated;
      });
    },
    [columns]
  );

  const show = useCallback(
    (columnId: string) => {
      // Validate column exists
      if (!columns.some((col) => col.id === columnId)) {
        return;
      }

      setVisibility((prev) => {
        if (prev[columnId] === true) return prev;
        const updated = { ...prev, [columnId]: true };
        onChangeRef.current?.(updated);
        return updated;
      });
    },
    [columns]
  );

  const toggle = useCallback(
    (columnId: string) => {
      if (isVisible(columnId)) {
        hide(columnId);
      } else {
        show(columnId);
      }
    },
    [isVisible, hide, show]
  );

  const showAll = useCallback(() => {
    setVisibility((prev) => {
      const updated: Record<string, boolean> = {};
      let changed = false;

      columns.forEach((col) => {
        updated[col.id] = true;
        if (prev[col.id] !== true) {
          changed = true;
        }
      });

      if (!changed) return prev;
      onChangeRef.current?.(updated);
      return updated;
    });
  }, [columns]);

  return {
    visibleColumns,
    visibility,
    isVisible,
    hide,
    show,
    toggle,
    showAll,
  };
}
