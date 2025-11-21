import { syntaxTree } from "@codemirror/language";
import type { CompletionContext } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export type SqlIntent = "table" | "column" | "keyword" | "function" | "unknown";

export interface TableRef {
  schema?: string;
  name: string;
  alias?: string;
  isCTE?: boolean;
  cteColumns?: string[]; // Columns exposed by CTE (if parsed)
  cteSourceTable?: string; // Source table for CTE (for SELECT * handling)
}

export interface SqlContextAnalysis {
  intent: SqlIntent;
  identifier: string;
  activeStatementTables: TableRef[];
  qualifier?: string;
  range: { from: number; to: number };
  // Mutation context
  isInsertContext?: boolean;
  insertTargetTable?: string;
  isUpdateContext?: boolean;
  updateTargetTable?: string;
}

// SQL keywords that introduce table references
const TABLE_CLAUSE_TYPES = [
  "FromClause",
  "JoinExpression",
  "UpdateStatement",
  "InsertStatement",
  "DeleteStatement",
];

// Keywords that precede table names
const TABLE_KEYWORDS = ["from", "join", "update", "into", "table"];

/**
 * Detect if we're in an INSERT or UPDATE context and extract target table
 */
function detectMutationContext(sql: string): {
  isInsert: boolean;
  isUpdate: boolean;
  targetTable?: string;
} {
  // INSERT INTO table_name (columns) VALUES ...
  const insertMatch = sql.match(/\bINSERT\s+INTO\s+([a-zA-Z0-9_."]+)/i);
  if (insertMatch && insertMatch[1]) {
    return {
      isInsert: true,
      isUpdate: false,
      targetTable: insertMatch[1].replace(/["`[\]]/g, ''),
    };
  }

  // UPDATE table_name SET ...
  const updateMatch = sql.match(/\bUPDATE\s+([a-zA-Z0-9_."]+)/i);
  if (updateMatch && updateMatch[1]) {
    return {
      isInsert: false,
      isUpdate: true,
      targetTable: updateMatch[1].replace(/["`[\]]/g, ''),
    };
  }

  return { isInsert: false, isUpdate: false };
}

/**
 * Parse CTEs from SQL text and extract their column information
 */
function parseCTEs(sql: string): TableRef[] {
  const ctes: TableRef[] = [];

  // Match WITH clause CTEs: WITH name AS (SELECT ...)
  const withMatch = sql.match(/\bWITH\s+/i);
  if (!withMatch) return ctes;

  // Extract everything after WITH until the main SELECT/INSERT/UPDATE/DELETE
  const afterWith = sql.slice(withMatch.index! + withMatch[0].length);

  // Split by top-level commas (not inside parens) to get each CTE
  // Simple approach: match "name AS (...)"
  const ctePattern = /(\w+)\s+AS\s*\(/gi;
  let match;

  while ((match = ctePattern.exec(afterWith)) !== null) {
    const cteName = match[1];
    if (!cteName) continue;
    const startParen = match.index + match[0].length - 1;

    // Find matching closing paren
    let depth = 1;
    let endParen = startParen + 1;
    while (depth > 0 && endParen < afterWith.length) {
      if (afterWith[endParen] === '(') depth++;
      if (afterWith[endParen] === ')') depth--;
      endParen++;
    }

    const cteBody = afterWith.slice(startParen + 1, endParen - 1);

    // Parse the SELECT to get columns
    const selectMatch = cteBody.match(/^\s*SELECT\s+([\s\S]*?)\s+FROM\s+(\w+)/i);
    if (selectMatch && selectMatch[1] && selectMatch[2]) {
      const columnsPart = selectMatch[1].trim();
      const sourceTable = selectMatch[2];

      let cteColumns: string[] | undefined;

      if (columnsPart === '*') {
        // SELECT * - columns come from source table
        cteColumns = undefined; // Will need to fetch from source
      } else {
        // Parse explicit columns
        cteColumns = columnsPart
          .split(',')
          .map(col => {
            // Handle "col AS alias" or just "col"
            const parts = col.trim().split(/\s+(?:AS\s+)?/i);
            const lastPart = parts[parts.length - 1];
            if (!lastPart) return '';
            const name = lastPart.replace(/["`[\]]/g, '');
            // Extract just the column name, not table prefix
            if (name.includes('.')) {
              const dotParts = name.split('.');
              return dotParts[dotParts.length - 1] || '';
            }
            return name;
          })
          .filter((col): col is string => Boolean(col));
      }

      ctes.push({
        name: cteName,
        alias: cteName,
        isCTE: true,
        cteColumns,
        cteSourceTable: sourceTable,
      });
    }
  }

  return ctes;
}

/**
 * Extract table references from the current statement scope.
 * Walks the AST to find all table definitions with their aliases.
 */
function getScopeTables(state: EditorState, pos: number): TableRef[] {
  const tree = syntaxTree(state);
  const tables: TableRef[] = [];
  const sql = state.doc.toString();

  // Parse CTEs first
  const ctes = parseCTEs(sql);
  for (const cte of ctes) {
    tables.push(cte);
  }

  // Find enclosing statement
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (node?.parent && !["Statement", "Script"].includes(node.type.name)) {
    node = node.parent;
  }
  if (!node) return tables;

  // Track seen tables to avoid duplicates
  const seen = new Set<string>();

  // Walk the statement looking for table references
  const cursor = node.cursor();
  do {
    // Look for Identifier nodes that could be table names
    if (
      cursor.name === "Identifier" ||
      cursor.name === "QuotedIdentifier"
    ) {
      const parent = cursor.node.parent;
      const prevSibling = cursor.node.prevSibling;

      // Check if this identifier is in a table position
      const isInTableClause =
        parent && TABLE_CLAUSE_TYPES.includes(parent.type.name);
      const followsTableKeyword =
        prevSibling?.type.name === "Keyword" &&
        TABLE_KEYWORDS.includes(
          state.sliceDoc(prevSibling.from, prevSibling.to).toLowerCase()
        );

      if (isInTableClause || followsTableKeyword) {
        const tableName = state
          .sliceDoc(cursor.from, cursor.to)
          .replace(/["`[\]]/g, "");

        // Skip if already seen
        if (seen.has(tableName.toLowerCase())) continue;

        // Check for alias (next sibling might be AS keyword or another identifier)
        let alias: string | undefined;
        let nextNode = cursor.node.nextSibling;

        // Skip "AS" keyword if present
        if (nextNode?.type.name === "Keyword") {
          const keyword = state
            .sliceDoc(nextNode.from, nextNode.to)
            .toLowerCase();
          if (keyword === "as") {
            nextNode = nextNode.nextSibling;
          }
        }

        // Next identifier is the alias
        if (
          nextNode &&
          (nextNode.type.name === "Identifier" ||
            nextNode.type.name === "QuotedIdentifier")
        ) {
          alias = state
            .sliceDoc(nextNode.from, nextNode.to)
            .replace(/["`[\]]/g, "");
        }

        // Handle schema.table notation
        let schema: string | undefined;
        if (prevSibling?.type.name === "." && prevSibling.prevSibling) {
          schema = state
            .sliceDoc(
              prevSibling.prevSibling.from,
              prevSibling.prevSibling.to
            )
            .replace(/["`[\]]/g, "");
        }

        tables.push({ schema, name: tableName, alias });
        seen.add(tableName.toLowerCase());
        if (alias) seen.add(alias.toLowerCase());
      }
    }

    // Also check for CTEs (WITH clause)
    if (cursor.name === "CommonTableExpression") {
      const firstChild = cursor.node.firstChild;
      if (firstChild) {
        const cteName = state
          .sliceDoc(firstChild.from, firstChild.to)
          .replace(/["`[\]]/g, "");
        if (!seen.has(cteName.toLowerCase())) {
          tables.push({ name: cteName, alias: cteName });
          seen.add(cteName.toLowerCase());
        }
      }
    }
  } while (cursor.next());

  return tables;
}

/**
 * Detect what the user is trying to complete based on cursor position in the AST.
 */
function detectIntent(state: EditorState, pos: number): SqlIntent {
  const tree = syntaxTree(state);
  const node = tree.resolveInner(pos, -1);

  // Walk up to find context
  let current: SyntaxNode | null = node;
  while (current) {
    const name = current.type.name;

    // After FROM/JOIN -> expect table
    if (TABLE_CLAUSE_TYPES.includes(name)) {
      return "table";
    }

    // In SELECT list, WHERE, HAVING -> expect column
    if (
      [
        "SelectClause",
        "WhereClause",
        "HavingClause",
        "OrderByClause",
        "GroupByClause",
        "SetClause",
      ].includes(name)
    ) {
      return "column";
    }

    current = current.parent;
  }

  // Check previous token for keyword hints
  // Look backwards to find the nearest non-whitespace token
  let lookbackPos = pos - 1;
  while (lookbackPos > 0) {
    const char = state.sliceDoc(lookbackPos, lookbackPos + 1);
    if (!/\s/.test(char)) break;
    lookbackPos--;
  }

  if (lookbackPos > 0) {
    const prevToken = tree.resolveInner(lookbackPos, -1);
    if (prevToken && prevToken.type.name === "Keyword") {
      const prevText = state
        .sliceDoc(prevToken.from, prevToken.to)
        .toLowerCase();
      if (TABLE_KEYWORDS.includes(prevText)) {
        return "table";
      }
    }
  }

  return "column"; // Default to column suggestions
}

/**
 * Analyze the SQL context at the cursor position.
 * Returns information about what kind of completion is expected
 * and which tables are in scope.
 */
export function analyzeSqlContext(
  context: CompletionContext,
  _defaultSchema?: string
): SqlContextAnalysis {
  const { state, pos } = context;
  const sql = state.doc.toString();

  // Get the word being typed
  const word = context.matchBefore(/[\w$]*$/);
  const identifier = word?.text || "";
  const range = word
    ? { from: word.from, to: word.to }
    : { from: pos, to: pos };

  // Check for qualifier (e.g., "u.id" -> qualifier is "u")
  const dotMatch = context.matchBefore(/([a-zA-Z0-9_"`[\]]+)\.\s*[\w$]*$/);
  let qualifier: string | undefined;
  let intent: SqlIntent;

  if (dotMatch) {
    intent = "column";
    const parts = dotMatch.text.split(".");
    qualifier = parts[0]?.replace(/["`[\]]/g, "").trim();
  } else {
    intent = detectIntent(state, pos);
  }

  const activeStatementTables = getScopeTables(state, pos);

  // Detect mutation context (INSERT/UPDATE)
  const mutationContext = detectMutationContext(sql);

  // For INSERT, check if we're in the column list (between parentheses after table name)
  let isInsertColumnContext = false;
  if (mutationContext.isInsert) {
    // Check if cursor is inside INSERT INTO table (|column, ...)
    const beforeCursor = sql.slice(0, pos);
    const insertColMatch = beforeCursor.match(/\bINSERT\s+INTO\s+[a-zA-Z0-9_."]+\s*\([^)]*$/i);
    if (insertColMatch) {
      isInsertColumnContext = true;
      intent = "column";
    }
  }

  return {
    intent,
    identifier,
    activeStatementTables,
    qualifier,
    range,
    isInsertContext: mutationContext.isInsert && isInsertColumnContext,
    insertTargetTable: mutationContext.isInsert ? mutationContext.targetTable : undefined,
    isUpdateContext: mutationContext.isUpdate,
    updateTargetTable: mutationContext.isUpdate ? mutationContext.targetTable : undefined,
  };
}
