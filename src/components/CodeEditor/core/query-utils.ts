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
 * Represents a SQL statement boundary in the editor.
 */
export interface StatementBoundary {
  /** Starting position in the document */
  from: number;
  /** Ending position in the document */
  to: number;
  /** The SQL statement text (trimmed, without trailing semicolon) */
  text: string;
  /** Starting line number (1-based) */
  lineStart: number;
  /** Ending line number (1-based) */
  lineEnd: number;
  /** Type of statement node from the AST */
  type: string;
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

/**
 * Get all SQL statements in the document using AST-based detection.
 * Returns boundaries for each statement found.
 */
export function getAllStatements(state: EditorState): StatementBoundary[] {
  const statements: StatementBoundary[] = [];
  const tree = syntaxTree(state);
  const doc = state.doc;

  // Find the Script node (root)
  const cursor = tree.cursor();
  
  // Navigate to Script node
  while (cursor.node.name !== "Script" && cursor.parent()) {
    // Keep walking up
  }

  if (cursor.node.name === "Script" && cursor.firstChild()) {
    // Iterate through all top-level statements
    do {
      const typeName = cursor.type.name;
      const isStatement = STATEMENT_TYPES.has(typeName) || typeName.includes("Statement");

      if (isStatement) {
        const from = cursor.from;
        const to = cursor.to;
        const text = cleanQuery(state.sliceDoc(from, to));
        
        // Skip empty statements
        if (!text) continue;

        const lineStart = doc.lineAt(from).number;
        const lineEnd = doc.lineAt(to).number;

        statements.push({
          from,
          to,
          text,
          lineStart,
          lineEnd,
          type: typeName,
        });
      }
    } while (cursor.nextSibling());
  }

  // If no statements found via AST, fallback to semicolon splitting
  // This handles cases where the AST is incomplete or parsing failed
  if (statements.length === 0) {
    const content = doc.toString();
    if (content.trim()) {
      // Simple fallback: treat entire document as one statement
      statements.push({
        from: 0,
        to: doc.length,
        text: cleanQuery(content),
        lineStart: 1,
        lineEnd: doc.lines,
        type: "Statement",
      });
    }
  }

  return statements;
}

/**
 * Get the statement boundary at a specific position in the document.
 * Returns null if no statement is found at that position.
 */
export function getStatementAtPosition(
  state: EditorState,
  pos: number
): StatementBoundary | null {
  const statements = getAllStatements(state);

  if (!statements.length) return null;

  // Find the statement that contains this position
  for (const stmt of statements) {
    if (pos >= stmt.from && pos <= stmt.to) {
      return stmt;
    }
  }

  // If cursor is before the first statement, snap to the first
  if (pos < statements[0].from) {
    return statements[0];
  }

  // If cursor is after the last statement, snap to the last
  const last = statements[statements.length - 1];
  if (pos > last.to) {
    return last;
  }

  // Cursor is between statements; choose the nearest previous statement
  for (let i = 1; i < statements.length; i++) {
    const prev = statements[i - 1];
    const next = statements[i];
    if (pos > prev.to && pos < next.from) {
      return prev;
    }
  }

  return statements[statements.length - 1];
}

/**
 * Get all statements that overlap with a given selection range.
 * Used for multi-statement execution when user selects across multiple queries.
 */
export function getStatementsInRange(
  state: EditorState,
  from: number,
  to: number
): StatementBoundary[] {
  const statements = getAllStatements(state);
  
  // Filter statements that overlap with the selection
  return statements.filter((stmt) => {
    // Statement overlaps if it starts before selection ends and ends after selection starts
    return stmt.from < to && stmt.to > from;
  });
}


