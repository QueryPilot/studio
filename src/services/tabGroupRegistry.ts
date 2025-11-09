/**
 * Global registry for tab groups to enable keyboard command integration.
 * Tab groups register themselves when they become focused and can be controlled
 * via keyboard commands (e.g., Cmd+1, Cmd+2, etc.)
 */

interface TabGroupController {
  tabGroupId: string;
  switchToTab: (index: number) => void;
  getTabCount?: () => number;
}

class TabGroupRegistry {
  private focusedGroup: TabGroupController | null = null;
  private registeredGroups = new Map<string, TabGroupController>();

  /**
   * Register a tab group with the registry
   */
  register(controller: TabGroupController): void {
    this.registeredGroups.set(controller.tabGroupId, controller);
  }

  /**
   * Unregister a tab group from the registry
   */
  unregister(tabGroupId: string): void {
    this.registeredGroups.delete(tabGroupId);
    if (this.focusedGroup?.tabGroupId === tabGroupId) {
      this.focusedGroup = null;
    }
  }

  /**
   * Set the currently focused tab group
   */
  setFocusedGroup(tabGroupId: string): void {
    const controller = this.registeredGroups.get(tabGroupId);
    if (controller) {
      this.focusedGroup = controller;
    }
  }

  /**
   * Clear the focused tab group (called when a group loses focus)
   */
  clearFocusedGroup(tabGroupId: string): void {
    if (this.focusedGroup?.tabGroupId === tabGroupId) {
      this.focusedGroup = null;
    }
  }

  /**
   * Get the currently focused tab group controller
   */
  getFocusedGroup(): TabGroupController | null {
    return this.focusedGroup;
  }

  /**
   * Switch to a tab in the focused group by index (0-based)
   */
  switchToTab(index: number): boolean {
    if (!this.focusedGroup) {
      return false;
    }

    // Check if index is within bounds (if getTabCount is available)
    if (this.focusedGroup.getTabCount) {
      const tabCount = this.focusedGroup.getTabCount();
      if (index < 0 || index >= tabCount) {
        return false;
      }
    }

    this.focusedGroup.switchToTab(index);
    return true;
  }
}

// Singleton instance
export const tabGroupRegistry = new TabGroupRegistry();
