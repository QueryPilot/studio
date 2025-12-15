/**
 * SQL Formatter Extension
 *
 * Format SQL on Cmd+Shift+F (Mac) or Ctrl+Shift+F (Windows/Linux)
 */

import { EditorView, keymap } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import { formatSql } from "@/utils/codeFormatter";
import type { SqlDialect } from "../types";

/**
 * Format the entire document or selection
 */
function formatDocument(view: EditorView, dialect: SqlDialect): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;

  // Determine if we have a selection
  const hasSelection = from !== to;
  const textToFormat = hasSelection
    ? state.doc.sliceString(from, to)
    : state.doc.toString();

  try {
    const formatted = formatSql(textToFormat, dialect);

    if (formatted === textToFormat) {
      // No changes needed
      return true;
    }

    if (hasSelection) {
      // Format selection only
      view.dispatch({
        changes: { from, to, insert: formatted },
        selection: { anchor: from, head: from + formatted.length },
      });
    } else {
      // Format entire document
      const cursorPos = state.selection.main.head;
      const beforeCursor = state.doc.sliceString(0, cursorPos);
      const linesBefore = beforeCursor.split("\n").length;

      view.dispatch({
        changes: { from: 0, to: state.doc.length, insert: formatted },
      });

      // Try to restore cursor to approximately the same line
      const newLines = formatted.split("\n");
      const targetLine = Math.min(linesBefore, newLines.length);
      const lineInfo = view.state.doc.line(targetLine);
      view.dispatch({
        selection: { anchor: lineInfo.from },
      });
    }

    return true;
  } catch {
    // Formatting failed, do nothing
    return false;
  }
}

/**
 * Create SQL formatter extension with high precedence to override other keybindings
 */
export function createFormatterExtension(dialect: SqlDialect = "postgresql"): Extension[] {
  return [
    Prec.high(keymap.of([
      {
        key: "Mod-Shift-f",
        run: (view) => formatDocument(view, dialect),
        preventDefault: true,
      },
      // Alternative binding
      {
        key: "Alt-Shift-f",
        run: (view) => formatDocument(view, dialect),
        preventDefault: true,
      },
    ])),
  ];
}

/**
 * Format SQL in an editor view programmatically
 */
export function formatEditorContent(view: EditorView, dialect: SqlDialect): void {
  formatDocument(view, dialect);
}
