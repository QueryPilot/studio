/**
 * Cell states in the editing lifecycle
 */
export type CellState =
  | 'idle'        // No interaction
  | 'focused'     // Selected, not editing (keyboard nav active)
  | 'editing'     // Active input
  | 'validating'  // Checking value (async)
  | 'dirty'       // Valid change staged
  | 'committing'  // Sending to backend
  | 'error';      // Validation or commit failed

/**
 * Transitions between cell states
 */
export type CellStateTransition =
  | { type: 'FOCUS'; cellKey: string }
  | { type: 'BLUR' }
  | { type: 'START_EDIT' }
  | { type: 'CANCEL_EDIT' }
  | { type: 'SUBMIT_VALUE'; value: unknown }
  | { type: 'VALIDATION_START' }
  | { type: 'VALIDATION_SUCCESS' }
  | { type: 'VALIDATION_FAILURE'; error: string }
  | { type: 'STAGE_CHANGE' }
  | { type: 'COMMIT_START' }
  | { type: 'COMMIT_SUCCESS' }
  | { type: 'COMMIT_FAILURE'; error: string }
  | { type: 'DISCARD' }
  | { type: 'RESET' };

/**
 * Cell key format: "tableKey:rowIndex:columnField"
 */
export type CellKey = string;

/**
 * Create a cell key from components
 */
export function createCellKey(
  tableKey: string,
  rowIndex: number,
  columnField: string
): CellKey {
  return `${tableKey}:${rowIndex}:${columnField}`;
}

/**
 * Parse a cell key into components
 */
export function parseCellKey(cellKey: CellKey): {
  tableKey: string;
  rowIndex: number;
  columnField: string;
} | null {
  const parts = cellKey.split(':');
  if (parts.length < 3) return null;

  const columnField = parts.pop()!;
  const rowIndexStr = parts.pop()!;
  const tableKey = parts.join(':');
  const rowIndex = parseInt(rowIndexStr, 10);

  if (isNaN(rowIndex)) return null;

  return { tableKey, rowIndex, columnField };
}

/**
 * Cell state data stored per cell
 */
export interface CellStateData {
  state: CellState;
  originalValue?: unknown;
  currentValue?: unknown;
  error?: string;
  timestamp: number;
}

/**
 * Valid state transitions
 */
export const VALID_TRANSITIONS: Record<CellState, CellStateTransition['type'][]> = {
  idle: ['FOCUS'],
  focused: ['BLUR', 'START_EDIT', 'FOCUS'],
  editing: ['CANCEL_EDIT', 'SUBMIT_VALUE'],
  validating: ['VALIDATION_SUCCESS', 'VALIDATION_FAILURE', 'CANCEL_EDIT'],
  dirty: ['START_EDIT', 'COMMIT_START', 'DISCARD', 'BLUR'],
  committing: ['COMMIT_SUCCESS', 'COMMIT_FAILURE'],
  error: ['START_EDIT', 'DISCARD', 'RESET'],
};

/**
 * Check if a transition is valid
 */
export function isValidTransition(
  currentState: CellState,
  transition: CellStateTransition['type']
): boolean {
  return VALID_TRANSITIONS[currentState]?.includes(transition) ?? false;
}
