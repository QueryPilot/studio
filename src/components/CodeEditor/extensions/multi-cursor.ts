/**
 * Multi-Cursor and Column Selection Extension
 *
 * Provides VS Code-like multi-cursor editing:
 * - Alt+Click to add cursor
 * - Alt+Shift+Up/Down for column selection
 * - Cmd/Ctrl+D to select next occurrence
 * - Cmd/Ctrl+Shift+L to select all occurrences
 */

import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import {
  EditorState,
  EditorSelection,
  SelectionRange,
  type Extension,
} from "@codemirror/state";

/**
 * Add cursor at click position while keeping existing cursors
 */
function addCursorAtClick(view: EditorView, event: MouseEvent): boolean {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return false;

  const { state } = view;
  const newRange = EditorSelection.cursor(pos);

  // Check if clicking on an existing cursor - if so, remove it
  const existingIndex = state.selection.ranges.findIndex(
    (r) => r.from === pos && r.to === pos
  );

  if (existingIndex >= 0 && state.selection.ranges.length > 1) {
    // Remove cursor at this position
    const newRanges = state.selection.ranges.filter((_, i) => i !== existingIndex);
    view.dispatch({
      selection: EditorSelection.create(newRanges, 0),
    });
  } else {
    // Add new cursor
    view.dispatch({
      selection: state.selection.addRange(newRange),
    });
  }

  return true;
}

/**
 * Select next occurrence of current selection or word
 */
function selectNextOccurrence(view: EditorView): boolean {
  const { state } = view;
  const mainSelection = state.selection.main;

  // Get the text to search for
  let searchText: string;
  let searchFrom: number;

  if (mainSelection.empty) {
    // No selection - select word at cursor
    const wordRange = view.state.wordAt(mainSelection.head);
    if (!wordRange) return false;

    view.dispatch({
      selection: EditorSelection.single(wordRange.from, wordRange.to),
    });
    return true;
  }

  searchText = state.doc.sliceString(mainSelection.from, mainSelection.to);
  if (!searchText) return false;

  // Find the next occurrence after the last selection
  const lastRange = state.selection.ranges[state.selection.ranges.length - 1];
  searchFrom = lastRange ? lastRange.to : 0;

  // Search for next occurrence
  let nextPos = findNextOccurrence(state, searchText, searchFrom);

  // Wrap around if not found
  if (nextPos === -1 && searchFrom > 0) {
    nextPos = findNextOccurrence(state, searchText, 0);
    // Make sure we don't select an already selected range
    if (nextPos >= 0) {
      const alreadySelected = state.selection.ranges.some(
        (r) => r.from === nextPos && r.to === nextPos + searchText.length
      );
      if (alreadySelected) return false;
    }
  }

  if (nextPos === -1) return false;

  // Check if this occurrence is already selected
  const alreadySelected = state.selection.ranges.some(
    (r) => r.from === nextPos && r.to === nextPos + searchText.length
  );

  if (alreadySelected) return false;

  // Add new selection
  const newRange = EditorSelection.range(nextPos, nextPos + searchText.length);
  view.dispatch({
    selection: state.selection.addRange(newRange),
    scrollIntoView: true,
  });

  return true;
}

/**
 * Select all occurrences of current selection
 */
function selectAllOccurrences(view: EditorView): boolean {
  const { state } = view;
  const mainSelection = state.selection.main;

  let searchText: string;

  if (mainSelection.empty) {
    // No selection - select word at cursor first
    const wordRange = view.state.wordAt(mainSelection.head);
    if (!wordRange) return false;
    searchText = state.doc.sliceString(wordRange.from, wordRange.to);
  } else {
    searchText = state.doc.sliceString(mainSelection.from, mainSelection.to);
  }

  if (!searchText) return false;

  // Find all occurrences
  const ranges: SelectionRange[] = [];
  let pos = 0;
  const text = state.doc.toString();

  while (pos < text.length) {
    const found = text.indexOf(searchText, pos);
    if (found === -1) break;

    ranges.push(EditorSelection.range(found, found + searchText.length));
    pos = found + 1;
  }

  if (ranges.length === 0) return false;

  view.dispatch({
    selection: EditorSelection.create(ranges, 0),
  });

  return true;
}

/**
 * Add cursor above current cursor
 */
function addCursorAbove(view: EditorView): boolean {
  return addCursorVertical(view, -1);
}

/**
 * Add cursor below current cursor
 */
function addCursorBelow(view: EditorView): boolean {
  return addCursorVertical(view, 1);
}

function addCursorVertical(view: EditorView, direction: 1 | -1): boolean {
  const { state } = view;
  const newRanges: SelectionRange[] = [...state.selection.ranges];

  // Get the topmost or bottommost range
  const targetRange =
    direction === -1
      ? state.selection.ranges.reduce((min, r) =>
          r.head < min.head ? r : min
        )
      : state.selection.ranges.reduce((max, r) =>
          r.head > max.head ? r : max
        );

  const targetLine = state.doc.lineAt(targetRange.head);
  const targetCol = targetRange.head - targetLine.from;

  const newLineNum = targetLine.number + direction;
  if (newLineNum < 1 || newLineNum > state.doc.lines) return false;

  const newLine = state.doc.line(newLineNum);
  const newCol = Math.min(targetCol, newLine.length);
  const newPos = newLine.from + newCol;

  // Check if cursor already exists at this position
  const exists = newRanges.some((r) => r.head === newPos);
  if (exists) return false;

  // Handle selection extension vs cursor addition
  if (!targetRange.empty) {
    // Extend selection to new line
    const anchorLine = state.doc.lineAt(targetRange.anchor);
    const anchorCol = targetRange.anchor - anchorLine.from;
    const newAnchorLine = state.doc.line(newLineNum);
    const newAnchorCol = Math.min(anchorCol, newAnchorLine.length);
    const newAnchor = newAnchorLine.from + newAnchorCol;

    newRanges.push(EditorSelection.range(newAnchor, newPos));
  } else {
    newRanges.push(EditorSelection.cursor(newPos));
  }

  view.dispatch({
    selection: EditorSelection.create(newRanges, newRanges.length - 1),
    scrollIntoView: true,
  });

  return true;
}

function findNextOccurrence(
  state: EditorState,
  searchText: string,
  from: number
): number {
  const text = state.doc.toString();
  return text.indexOf(searchText, from);
}

/**
 * Multi-cursor keybindings
 */
const multiCursorKeymap: KeyBinding[] = [
  // Cmd/Ctrl+D - Select next occurrence
  { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },

  // Cmd/Ctrl+Shift+L - Select all occurrences
  { key: "Mod-Shift-l", run: selectAllOccurrences, preventDefault: true },

  // Alt+Shift+Up - Add cursor above
  { key: "Alt-Shift-ArrowUp", run: addCursorAbove, preventDefault: true },

  // Alt+Shift+Down - Add cursor below
  { key: "Alt-Shift-ArrowDown", run: addCursorBelow, preventDefault: true },

  // Escape - reduce to single cursor
  {
    key: "Escape",
    run: (view) => {
      if (view.state.selection.ranges.length > 1) {
        view.dispatch({
          selection: EditorSelection.single(
            view.state.selection.main.anchor,
            view.state.selection.main.head
          ),
        });
        return true;
      }
      return false;
    },
  },
];

/**
 * Create multi-cursor extension
 */
export function createMultiCursorExtension(): Extension[] {
  return [
    keymap.of(multiCursorKeymap),
    // Alt+Click handler
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          return addCursorAtClick(view, event);
        }
        return false;
      },
    }),
  ];
}

/**
 * Get number of active cursors
 */
export function getCursorCount(view: EditorView): number {
  return view.state.selection.ranges.length;
}
