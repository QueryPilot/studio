/**
 * Query extraction utilities for SQL editors.
 * Provides AST-based query boundary detection.
 */

import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// SQL statement types recognized by the Lezer grammar
const STATEMENT_TYPES = new Set([
  "Statement",
  "SelectStatement",
  "InsertStatement",
  "UpdateStatement",
  "DeleteStatement",
  "CreateStatement",
  "AlterStatement",
  "DropStatement",
]);

/**
 * Remove trailing semicolons and whitespace from a query string.
 */
function cleanQuery(query: string): string {
  return query.trim().replace(/;\s*$/, "");
}

/**
 * Extract the SQL query at cursor position using AST-based boundary detection.
 * 
 * Priority:
 * 1. If text is selected, returns the selection
 * 2. Uses syntax tree to find the enclosing statement
 * 3. Falls back to sibling traversal for incomplete syntax
 * 4. Returns entire document as last resort
 */
export function getQueryAtCursor(view: EditorView): string {
  return getQueryAtCursorFromState(view.state);
}

/**
 * Extract the SQL query from EditorState (for use without EditorView).
 */
export function getQueryAtCursorFromState(state: EditorState): string {
  const selection = state.selection.main;

  // If there's a selection, return the selected text
  if (selection.from !== selection.to) {
    return cleanQuery(state.sliceDoc(selection.from, selection.to));
  }

  const cursorPos = selection.from;
  const tree = syntaxTree(state);

  // Walk up the tree to find enclosing Statement
  let node = tree.resolveInner(cursorPos, -1);
  while (node && node.parent) {
    if (STATEMENT_TYPES.has(node.type.name) || node.type.name === "Script") {
      break;
    }
    node = node.parent;
  }

  // If we found a statement node (not Script), extract its content
  if (node && node.type.name !== "Script") {
    return cleanQuery(state.sliceDoc(node.from, node.to));
  }

  // Fallback: find statement boundaries using sibling traversal
  // This handles incomplete syntax better
  const cursor = tree.cursor();
  cursor.moveTo(cursorPos);

  while (cursor.parent()) {
    if (cursor.type.name === "Script") {
      if (cursor.firstChild()) {
        let statementStart = 0;
        let statementEnd = state.doc.length;

        do {
          const typeName = cursor.type.name;
          const isStatement =
            STATEMENT_TYPES.has(typeName) || typeName.includes("Statement");

          if (isStatement) {
            if (cursor.to <= cursorPos) {
              statementStart = cursor.to;
            } else if (cursor.from <= cursorPos && cursor.to >= cursorPos) {
              return cleanQuery(state.sliceDoc(cursor.from, cursor.to));
            } else {
              statementEnd = cursor.from;
              break;
            }
          }
        } while (cursor.nextSibling());

        return cleanQuery(state.sliceDoc(statementStart, statementEnd));
      }
      break;
    }
  }

  // Ultimate fallback: return entire document
  return cleanQuery(state.doc.toString());
}



