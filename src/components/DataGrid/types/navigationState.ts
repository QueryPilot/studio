import type { Item } from "@glideapps/glide-data-grid";

/**
 * Navigation modes for Excel-like behavior
 */
export type NavigationMode = 'browsing' | 'selected' | 'editing';

/**
 * Edit trigger - how editing was initiated
 */
export type EditTrigger =
  | 'double-click'  // User double-clicked the cell
  | 'f2'            // User pressed F2
  | 'type-replace'  // User started typing (replaces content)
  | 'type-append'   // Future: User started typing after F2 (appends)
  | 'enter';        // User pressed Enter on selected cell

/**
 * Navigation state for tracking current mode and context
 */
export interface NavigationState {
  mode: NavigationMode;
  selectedCell: Item | null;
  editTrigger: EditTrigger | null;
  /** Initial character typed when entering edit via type-replace */
  initialChar: string | null;
}

/**
 * Navigation actions
 */
export type NavigationAction =
  | { type: 'SELECT_CELL'; cell: Item }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'ENTER_EDIT'; trigger: EditTrigger; initialChar?: string }
  | { type: 'EXIT_EDIT'; commit: boolean }
  | { type: 'MOVE_SELECTION'; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'RESET' };

/**
 * Keys that trigger type-to-edit mode (replace content)
 */
export function isPrintableKey(key: string, ctrlKey: boolean, metaKey: boolean, altKey: boolean): boolean {
  // Ignore if modifier keys are pressed (except Shift)
  if (ctrlKey || metaKey || altKey) return false;

  // Single character keys (letters, numbers, symbols)
  if (key.length === 1) {
    const code = key.charCodeAt(0);
    // Printable ASCII range: space (32) to tilde (126)
    return code >= 32 && code <= 126;
  }

  return false;
}

/**
 * Keys that should navigate when in selected mode
 */
export function isNavigationKey(key: string): key is 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' {
  return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key);
}

/**
 * Map navigation key to direction
 */
export function keyToDirection(key: string): 'up' | 'down' | 'left' | 'right' | null {
  switch (key) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    default: return null;
  }
}

/**
 * Keys that clear cell content when in selected mode
 */
export function isClearKey(key: string): boolean {
  return key === 'Delete' || key === 'Backspace';
}
