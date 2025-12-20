/**
 * Keyboard Navigation Utilities for DataGrid
 *
 * Provides robust keyboard navigation for Glide Data Grid including:
 * - Tab navigation between cells with auto-edit
 * - F2 to enter edit mode
 * - Arrow key navigation
 */

import type { DataEditorRef, GridSelection, Item } from "@glideapps/glide-data-grid";
import { CompactSelection } from "@glideapps/glide-data-grid";
import type { NavigationBounds } from "../stores/navigationStore";

export type Movement = readonly [-1 | 0 | 1, -1 | 0 | 1];

export type { NavigationBounds };

/**
 * Calculate next cell position based on movement direction
 */
export function getNextCell(
  current: Item,
  movement: Movement,
  bounds: NavigationBounds
): Item | null {
  const [colOffset, rowOffset] = movement;
  const [currentCol, currentRow] = current;

  const nextCol = currentCol + colOffset;
  const nextRow = currentRow + rowOffset;

  // Check bounds
  if (nextCol < 0 || nextCol >= bounds.maxCol) return null;
  if (nextRow < 0 || nextRow >= bounds.maxRow) return null;

  return [nextCol, nextRow];
}

/**
 * Create a GridSelection for a single cell
 */
export function createCellSelection(cell: Item): GridSelection {
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: {
      cell,
      range: {
        x: cell[0],
        y: cell[1],
        width: 1,
        height: 1,
      },
      rangeStack: [],
    },
  };
}

/**
 * Navigate to cell and optionally open editor
 * Uses a single RAF + microtask instead of nested RAFs for reliability
 */
export function navigateToCell(
  gridRef: React.RefObject<DataEditorRef | null>,
  cell: Item,
  onSelectionChange: ((selection: GridSelection) => void) | undefined,
  options: {
    openEditor?: boolean;
    scrollToCell?: boolean;
  } = {}
): void {
  const { openEditor = false, scrollToCell = true } = options;

  // Update selection first
  const selection = createCellSelection(cell);
  onSelectionChange?.(selection);

  // Use a single RAF for DOM operations
  requestAnimationFrame(() => {
    const grid = gridRef.current;
    if (!grid) return;

    // Scroll to make cell visible
    if (scrollToCell) {
      grid.scrollTo(cell[0], cell[1]);
    }

    // Focus the grid
    grid.focus();

    // If we need to open editor, use microtask to ensure selection is processed
    if (openEditor) {
      queueMicrotask(() => {
        // Dispatch Enter key to trigger edit mode
        // This is the Glide-recommended way to programmatically enter edit mode
        const canvas = document.querySelector(
          ".dvn-scroller canvas"
        ) as HTMLCanvasElement;
        if (canvas) {
          canvas.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
            })
          );
        }
      });
    }
  });
}

/**
 * Handle Tab key navigation with auto-edit on next cell
 */
export function handleTabNavigation(
  gridRef: React.RefObject<DataEditorRef | null>,
  currentCell: Item,
  shiftKey: boolean,
  bounds: NavigationBounds,
  onSelectionChange: ((selection: GridSelection) => void) | undefined
): boolean {
  const movement: Movement = shiftKey ? [-1, 0] : [1, 0];
  const nextCell = getNextCell(currentCell, movement, bounds);

  if (!nextCell) {
    // At edge - could wrap to next/prev row in future
    return false;
  }

  navigateToCell(gridRef, nextCell, onSelectionChange, {
    openEditor: true,
    scrollToCell: true,
  });

  return true;
}

/**
 * Handle F2 key to enter edit mode on current cell
 */
export function handleF2Key(
  gridRef: React.RefObject<DataEditorRef | null>,
  currentCell: Item | null
): boolean {
  if (!currentCell) return false;

  const grid = gridRef.current;
  if (!grid) return false;

  // Dispatch Enter key to trigger edit mode
  const canvas = document.querySelector(
    ".dvn-scroller canvas"
  ) as HTMLCanvasElement;
  if (canvas) {
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      })
    );
    return true;
  }

  return false;
}

/**
 * Create keyboard event handler for grid-level shortcuts
 * Should be attached to the grid container
 */
export function createGridKeyboardHandler(options: {
  gridRef: React.RefObject<DataEditorRef | null>;
  getCurrentCell: () => Item | null;
  bounds?: NavigationBounds;
  onSelectionChange?: (selection: GridSelection) => void;
}): (e: KeyboardEvent) => void {
  const { gridRef, getCurrentCell } = options;
  // bounds and onSelectionChange reserved for future arrow key navigation

  return (e: KeyboardEvent) => {
    // Don't handle if in input/textarea
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    // F2 to enter edit mode
    if (e.key === "F2") {
      const cell = getCurrentCell();
      if (cell && handleF2Key(gridRef, cell)) {
        e.preventDefault();
      }
    }
  };
}
