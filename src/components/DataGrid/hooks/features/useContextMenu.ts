import { useRef, useCallback } from "react";
import type { Item } from "@glideapps/glide-data-grid";

export type ContextMenuTarget =
  | { type: "cell"; col: number; row: number; bounds: DOMRect }
  | { type: "header"; col: number; bounds: DOMRect }
  | { type: "out-of-bounds" }
  | null;

export interface UseContextMenuOptions {
  /** Optional callback when context menu is opened */
  onContextMenu?: (target: ContextMenuTarget) => void;
}

export interface UseContextMenuResult {
  contextMenuTarget: React.MutableRefObject<ContextMenuTarget>;
  handleCellContextMenu: (cell: Item, event: MouseEvent | React.MouseEvent) => void;
  handleHeaderContextMenu: (col: number, event: { bounds: DOMRect }) => void;
  clearContextMenu: () => void;
}

/**
 * Hook to manage context menu state for DataGrid
 */
export function useContextMenu(
  options: UseContextMenuOptions = {},
): UseContextMenuResult {
  const { onContextMenu } = options;
  const contextMenuTargetRef = useRef<ContextMenuTarget>(null);

  const handleCellContextMenu = useCallback<
    UseContextMenuResult["handleCellContextMenu"]
  >(
    (cell, event) => {
      const target = event.target as HTMLElement;
      if (!target) return;

      const bounds = target.getBoundingClientRect();
      contextMenuTargetRef.current = {
        type: "cell",
        col: cell[0],
        row: cell[1],
        bounds,
      };

      onContextMenu?.(contextMenuTargetRef.current);
    },
    [onContextMenu],
  );

  const handleHeaderContextMenu = useCallback<
    UseContextMenuResult["handleHeaderContextMenu"]
  >(
    (col, event) => {
      contextMenuTargetRef.current = {
        type: "header",
        col,
        bounds: event.bounds,
      };

      onContextMenu?.(contextMenuTargetRef.current);
    },
    [onContextMenu],
  );

  const clearContextMenu = useCallback(() => {
    contextMenuTargetRef.current = null;
  }, []);

  return {
    contextMenuTarget: contextMenuTargetRef,
    handleCellContextMenu,
    handleHeaderContextMenu,
    clearContextMenu,
  };
}
