import { useEffect, useCallback } from "react";

export interface UseKeyboardShortcutsOptions {
  /** Handler for search shortcut (Cmd+F or /) */
  onSearch?: () => void;
  /** Handler for fill down (Ctrl+D) */
  onFillDown?: () => void;
  /** Handler for fill right (Ctrl+R) */
  onFillRight?: () => void;
  /** Handler for delete rows (Delete/Backspace) */
  onDelete?: () => void;
  /** Whether shortcuts are enabled */
  enabled?: boolean;
}

export interface UseKeyboardShortcutsResult {
  /** Manually trigger search */
  triggerSearch: () => void;
}

/**
 * Hook to manage keyboard shortcuts for DataGrid
 */
export function useKeyboardShortcuts(
  options: UseKeyboardShortcutsOptions,
): UseKeyboardShortcutsResult {
  const {
    onSearch,
    onFillDown,
    onFillRight,
    onDelete,
    enabled = true,
  } = options;

  const triggerSearch = useCallback(() => {
    onSearch?.();
  }, [onSearch]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isMeta = event.metaKey || event.ctrlKey;

      // Search: Cmd+F or /
      if ((isMeta && key === "f") || key === "/") {
        event.preventDefault();
        onSearch?.();
        return;
      }

      // Fill down: Ctrl+D
      if (event.ctrlKey && key === "d" && !event.metaKey) {
        event.preventDefault();
        onFillDown?.();
        return;
      }

      // Fill right: Ctrl+R
      if (event.ctrlKey && key === "r" && !event.metaKey) {
        event.preventDefault();
        onFillRight?.();
        return;
      }

      // Delete: Delete or Backspace
      if (key === "delete" || key === "backspace") {
        onDelete?.();
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, onSearch, onFillDown, onFillRight, onDelete]);

  return {
    triggerSearch,
  };
}
