/**
 * Query extraction utilities for SQL editors.
 * Provides AST-based query boundary detection.
 */

import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// LRU cache for getAllStatements - supports multiple concurrent editors without thrashing
const statementsLRU = new Map<string, {
  docLength: number;
  treeLength: number;
  statements: StatementBoundary[];
}>();
const MAX_CACHE_SIZE = 8; // Support up to 8 concurrent editors

function hashDoc(state: EditorState): number {
  // Fast hash using first/last chars and length - good enough for change detection
  const doc = state.doc;
  const len = doc.length;
  if (len === 0) return 0;
  const first = doc.sliceString(0, Math.min(100, len));
  const last = len > 100 ? doc.sliceString(Math.max(0, len - 100), len) : "";
  let hash = len;
  for (let i = 0; i < first.length; i++) {
    hash = ((hash << 5) - hash + first.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < last.length; i++) {
    hash = ((hash << 5) - hash + last.charCodeAt(i)) | 0;
  }
  return hash;
}

function getCacheKey(state: EditorState): string {
  return `${state.doc.length}:${hashDoc(state)}:${syntaxTree(state).length}`;
}

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
 * Split SQL content by semicolons, respecting strings, comments, and dollar quotes.
 * Returns array of statement strings (without trailing semicolons).
 */
function splitBySemicolon(content: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    // Handle line comments
    if (!inSingleQuote && !inDoubleQuote && !inBlockComment && !dollarTag) {
      if (char === "-" && nextChar === "-") {
        inLineComment = true;
        current += char;
        i++;
        continue;
      }
    }
    if (inLineComment) {
      current += char;
      if (char === "\n") {
        inLineComment = false;
      }
      i++;
      continue;
    }

    // Handle block comments
    if (!inSingleQuote && !inDoubleQuote && !dollarTag) {
      if (char === "/" && nextChar === "*") {
        inBlockComment = true;
        current += "/*";
        i += 2;
        continue;
      }
    }
    if (inBlockComment) {
      current += char;
      if (char === "*" && nextChar === "/") {
        current += "/";
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Handle dollar-quoted strings (PostgreSQL)
    if (!inSingleQuote && !inDoubleQuote && !dollarTag) {
      if (char === "$") {
        // Look for opening dollar tag: $tag$ or $$
        const match = content.slice(i).match(/^(\$[a-zA-Z0-9_]*\$)/);
        if (match?.[1]) {
          dollarTag = match[1];
          current += dollarTag;
          i += dollarTag.length;
          continue;
        }
      }
    }
    if (dollarTag) {
      current += char;
      // Check for closing dollar tag
      if (char === "$" && content.slice(i, i + dollarTag.length) === dollarTag) {
        current += dollarTag.slice(1); // Already added first $
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }

    // Handle single quotes
    if (!inDoubleQuote && char === "'") {
      if (inSingleQuote && nextChar === "'") {
        // Escaped quote
        current += "''";
        i += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += char;
      i++;
      continue;
    }

    // Handle double quotes
    if (!inSingleQuote && char === '"') {
      if (inDoubleQuote && nextChar === '"') {
        // Escaped quote
        current += '""';
        i += 2;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      current += char;
      i++;
      continue;
    }

    // Handle semicolon (statement delimiter)
    if (!inSingleQuote && !inDoubleQuote && char === ";") {
      statements.push(current);
      current = "";
      i++;
      continue;
    }

    current += char;
    i++;
  }

  // Add remaining content as last statement
  if (current.trim()) {
    statements.push(current);
  }

  return statements;
}

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
 *
 * MEMOIZED: Results are cached based on document content hash.
 * Safe to call frequently (e.g., on every transaction).
 */
export function getAllStatements(state: EditorState): StatementBoundary[] {
  const tree = syntaxTree(state);
  const doc = state.doc;
  const docLength = doc.length;
  const treeLength = tree.length;
  const cacheKey = getCacheKey(state);

  // Return cached result if document unchanged
  const cached = statementsLRU.get(cacheKey);
  if (cached && cached.docLength === docLength && cached.treeLength === treeLength) {
    return cached.statements;
  }

  const statements: StatementBoundary[] = [];

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

  // Fallback to semicolon-based splitting if:
  // 1. No statements found via AST, OR
  // 2. AST found only 1 statement but content has semicolons (likely parsing issue)
  const content = doc.toString();
  const hasSemicolons = content.includes(";");
  const needsFallback = statements.length === 0 || (statements.length === 1 && hasSemicolons);

  if (needsFallback && content.trim()) {
    // Split by semicolons (respecting strings and comments)
    const splitStatements = splitBySemicolon(content);

    // Only use fallback if it finds more statements than AST did
    if (splitStatements.length > statements.length) {
      statements.length = 0; // Clear AST results
      let offset = 0;

      for (const stmtText of splitStatements) {
        const trimmed = stmtText.trim();
        if (!trimmed) {
          offset += stmtText.length + 1; // +1 for semicolon
          continue;
        }

        // Find actual position in document
        const from = content.indexOf(trimmed, offset);
        const to = from + trimmed.length;
        const lineStart = doc.lineAt(from).number;
        const lineEnd = doc.lineAt(to).number;

        statements.push({
          from,
          to,
          text: cleanQuery(trimmed),
          lineStart,
          lineEnd,
          type: "Statement",
        });

        offset = to + 1;
      }
    }
  }

  // Cache result for subsequent calls (LRU eviction)
  if (statementsLRU.size >= MAX_CACHE_SIZE) {
    const firstKey = statementsLRU.keys().next().value;
    if (firstKey) statementsLRU.delete(firstKey);
  }
  statementsLRU.set(cacheKey, { docLength, treeLength, statements });

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
  const doc = state.doc;
  const tree = syntaxTree(state);

  let node = tree.resolveInner(pos, -1);
  while (node) {
    const typeName = node.type.name;
    if (typeName === "Script") {
      break;
    }
    if (STATEMENT_TYPES.has(typeName) || typeName.includes("Statement")) {
      const from = node.from;
      const to = node.to;
      const text = cleanQuery(state.sliceDoc(from, to));
      if (text) {
        return {
          from,
          to,
          text,
          lineStart: doc.lineAt(from).number,
          lineEnd: doc.lineAt(to).number,
          type: typeName,
        };
      }
      break;
    }
    if (!node.parent) break;
    node = node.parent;
  }

  const statements = getAllStatements(state);

  if (!statements.length) return null;

  // Find the statement that contains this position
  for (const stmt of statements) {
    if (pos >= stmt.from && pos <= stmt.to) {
      return stmt;
    }
  }

  // If cursor is before the first statement, snap to the first
  const first = statements[0];
  if (first && pos < first.from) {
    return first;
  }

  // If cursor is after the last statement, snap to the last
  const last = statements[statements.length - 1];
  if (last && pos > last.to) {
    return last;
  }

  // Cursor is between statements; choose the nearest previous statement
  for (let i = 1; i < statements.length; i++) {
    const prev = statements[i - 1];
    const next = statements[i];
    if (prev && next && pos > prev.to && pos < next.from) {
      return prev;
    }
  }

  return statements[statements.length - 1] ?? null;
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

/**
 * Check if a query is a potentially destructive mutation without WHERE clause.
 */
export function isDestructiveQuery(query: string): { isDestructive: boolean; type: string } {
  const upperQuery = query.toUpperCase().trim();

  // Check for DELETE without WHERE
  if (upperQuery.startsWith("DELETE")) {
    const hasWhere = /\bWHERE\b/i.test(query);
    if (!hasWhere) {
      return { isDestructive: true, type: "DELETE" };
    }
  }

  // Check for UPDATE without WHERE
  if (upperQuery.startsWith("UPDATE")) {
    const hasWhere = /\bWHERE\b/i.test(query);
    if (!hasWhere) {
      return { isDestructive: true, type: "UPDATE" };
    }
  }

  // Check for TRUNCATE (always destructive)
  if (upperQuery.startsWith("TRUNCATE")) {
    return { isDestructive: true, type: "TRUNCATE" };
  }

  // Check for DROP (always destructive)
  if (upperQuery.startsWith("DROP")) {
    return { isDestructive: true, type: "DROP" };
  }

  return { isDestructive: false, type: "" };
}

