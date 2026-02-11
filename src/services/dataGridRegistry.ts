/**
 * Focused Data Grid registry for command routing.
 *
 * Commands (keyboard/menu/palette) target the currently focused grid.
 * Individual grid instances register/unregister handlers on mount/unmount.
 */

export interface DataGridController {
  id: string;
  focusFilter?: () => void;
  copySelection?: () => Promise<void> | void;
  copySelectionAsJson?: () => Promise<void> | void;
  fillDown?: () => void;
  fillRight?: () => void;
  duplicateRows?: () => void;
  deleteRows?: () => void;
  clearSelection?: () => void;
  showContextMenu?: () => void;
}

class DataGridRegistry {
  private focusedGridId: string | null = null;
  private readonly registered = new Map<string, DataGridController>();

  register(controller: DataGridController): void {
    this.registered.set(controller.id, controller);
  }

  unregister(gridId: string): void {
    this.registered.delete(gridId);
    if (this.focusedGridId === gridId) {
      this.focusedGridId = null;
    }
  }

  setFocused(gridId: string): void {
    if (this.registered.has(gridId)) {
      this.focusedGridId = gridId;
    }
  }

  clearFocused(gridId: string): void {
    if (this.focusedGridId === gridId) {
      this.focusedGridId = null;
    }
  }

  getFocused(): DataGridController | null {
    if (!this.focusedGridId) {
      return null;
    }
    return this.registered.get(this.focusedGridId) ?? null;
  }
}

export const dataGridRegistry = new DataGridRegistry();
