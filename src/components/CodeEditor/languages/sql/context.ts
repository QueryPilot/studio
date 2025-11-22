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
  // Subquery context
  subqueryDepth?: number;
  outerScopeTables?: TableRef[]; // Tables from outer scopes (for correlated subqueries)
}

/**
 * Find subquery boundaries in SQL text.
 * Returns array of {from, to, depth} for each subquery.
 */
function findSubqueryBoundaries(sql: string): Array<{ from: number; to: number; depth: number }> {
  const subqueries: Array<{ from: number; to: number; depth: number }> = [];
  const stack: Array<{ from: number; depth: number }> = [];
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    // Handle comments
    if (!inString && !inBlockComment && char === '-' && nextChar === '-') {
      inLineComment = true;
      continue;
    }
    if (inLineComment && char === '\n') {
      inLineComment = false;
      continue;
    }
    if (inLineComment) continue;

    if (!inString && !inLineComment && char === '/' && nextChar === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (inBlockComment && char === '*' && nextChar === '/') {
      inBlockComment = false;
      i++;
      continue;
    }
    if (inBlockComment) continue;

    // Handle strings
    if (!inString && (char === "'" || char === '"')) {
      inString = true;
      stringChar = char;
      continue;
    }
    if (inString && char === stringChar) {
      if (nextChar === stringChar) {
        i++; // Skip escaped quote
      } else {
        inString = false;
      }
      continue;
    }
    if (inString) continue;

    // Track parentheses
    if (char === '(') {
      // Check if this starts a subquery by looking at preceding text
      const before = sql.slice(Math.max(0, i - 50), i).toUpperCase();
      const isSubquery = /\b(IN|EXISTS|ANY|ALL|NOT)\s*$/.test(before) ||
                         /\bFROM\s*$/.test(before) ||
                         /^\s*$/.test(before) && depth > 0;

      if (isSubquery || depth > 0) {
        depth++;
        stack.push({ from: i, depth });
      }
    } else if (char === ')' && stack.length > 0) {
      const start = stack.pop();
      if (start) {
        subqueries.push({ from: start.from, to: i, depth: start.depth });
        depth--;
      }
    }
  }

  return subqueries;
}

/**
 * Get the subquery scope at a given position.
 * Returns the innermost subquery containing the position, or null if not in a subquery.
 */
function getSubqueryScopeAtPosition(
  sql: string,
  pos: number
): { from: number; to: number; depth: number } | null {
  const subqueries = findSubqueryBoundaries(sql);

  // Find the innermost subquery containing the position
  let innermost: { from: number; to: number; depth: number } | null = null;

  for (const sq of subqueries) {
    if (pos > sq.from && pos < sq.to) {
      if (!innermost || sq.depth > innermost.depth) {
        innermost = sq;
      }
    }
  }

  return innermost;
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
 * Extract table references from a specific SQL range.
 * Used for both full statement and subquery scope parsing.
 */
function extractTablesFromRange(
  state: EditorState,
  from: number,
  to: number,
  seen: Set<string>
): TableRef[] {
  const tables: TableRef[] = [];
  const tree = syntaxTree(state);

  // Walk the tree within the range
  const cursor = tree.cursor();

  while (cursor.next()) {
    // Skip nodes outside our range
    if (cursor.to < from || cursor.from > to) continue;

    // Look for Identifier nodes that could be table names
    if (cursor.name === "Identifier" || cursor.name === "QuotedIdentifier") {
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

        // Check for alias
        let alias: string | undefined;
        let nextNode = cursor.node.nextSibling;

        if (nextNode?.type.name === "Keyword") {
          const keyword = state
            .sliceDoc(nextNode.from, nextNode.to)
            .toLowerCase();
          if (keyword === "as") {
            nextNode = nextNode.nextSibling;
          }
        }

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
            .sliceDoc(prevSibling.prevSibling.from, prevSibling.prevSibling.to)
            .replace(/["`[\]]/g, "");
        }

        tables.push({ schema, name: tableName, alias });
        seen.add(tableName.toLowerCase());
        if (alias) seen.add(alias.toLowerCase());
      }
    }
  }

  return tables;
}

/**
 * Extract table references from the current statement scope.
 * Respects subquery boundaries - only returns tables in the same scope.
 * Also returns outer scope tables separately for correlated subquery support.
 */
function getScopeTables(
  state: EditorState,
  pos: number
): { tables: TableRef[]; outerTables: TableRef[]; subqueryDepth: number } {
  const tree = syntaxTree(state);
  const tables: TableRef[] = [];
  const outerTables: TableRef[] = [];
  const sql = state.doc.toString();

  // Parse CTEs first (available at all scope levels)
  const ctes = parseCTEs(sql);
  for (const cte of ctes) {
    tables.push(cte);
  }

  // Find enclosing statement
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (node?.parent && !["Statement", "Script"].includes(node.type.name)) {
    node = node.parent;
  }
  if (!node) return { tables, outerTables, subqueryDepth: 0 };

  const statementFrom = node.from;
  const statementTo = node.to;

  // Check if we're in a subquery
  const subqueryScope = getSubqueryScopeAtPosition(sql, pos);
  const seen = new Set<string>(ctes.map(c => c.name.toLowerCase()));

  if (subqueryScope) {
    // We're in a subquery - extract tables only from this subquery's scope
    const subqueryTables = extractTablesFromRange(
      state,
      subqueryScope.from,
      subqueryScope.to,
      seen
    );
    tables.push(...subqueryTables);

    // Also extract outer scope tables (for correlated subquery support)
    // Tables from the outer query that can be referenced in the subquery
    const outerSeen = new Set<string>();

    // Get tables from the full statement, excluding the current subquery
    const cursor = node.cursor();
    do {
      // Skip nodes inside the current subquery
      if (cursor.from >= subqueryScope.from && cursor.to <= subqueryScope.to) {
        continue;
      }

      if (cursor.name === "Identifier" || cursor.name === "QuotedIdentifier") {
        const parent = cursor.node.parent;
        const prevSibling = cursor.node.prevSibling;

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

          if (!outerSeen.has(tableName.toLowerCase())) {
            let alias: string | undefined;
            let nextNode = cursor.node.nextSibling;

            if (nextNode?.type.name === "Keyword") {
              const keyword = state
                .sliceDoc(nextNode.from, nextNode.to)
                .toLowerCase();
              if (keyword === "as") {
                nextNode = nextNode.nextSibling;
              }
            }

            if (
              nextNode &&
              (nextNode.type.name === "Identifier" ||
                nextNode.type.name === "QuotedIdentifier")
            ) {
              alias = state
                .sliceDoc(nextNode.from, nextNode.to)
                .replace(/["`[\]]/g, "");
            }

            let schema: string | undefined;
            if (prevSibling?.type.name === "." && prevSibling.prevSibling) {
              schema = state
                .sliceDoc(
                  prevSibling.prevSibling.from,
                  prevSibling.prevSibling.to
                )
                .replace(/["`[\]]/g, "");
            }

            outerTables.push({ schema, name: tableName, alias });
            outerSeen.add(tableName.toLowerCase());
            if (alias) outerSeen.add(alias.toLowerCase());
          }
        }
      }
    } while (cursor.next());

    return { tables, outerTables, subqueryDepth: subqueryScope.depth };
  }

  // Not in a subquery - extract all tables from the statement
  const statementTables = extractTablesFromRange(
    state,
    statementFrom,
    statementTo,
    seen
  );
  tables.push(...statementTables);

  // Also check for CTEs in the AST
  const cursor = node.cursor();
  do {
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

  return { tables, outerTables, subqueryDepth: 0 };
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

  // Get tables with subquery scope isolation
  const { tables, outerTables, subqueryDepth } = getScopeTables(state, pos);

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
    activeStatementTables: tables,
    qualifier,
    range,
    isInsertContext: mutationContext.isInsert && isInsertColumnContext,
    insertTargetTable: mutationContext.isInsert ? mutationContext.targetTable : undefined,
    isUpdateContext: mutationContext.isUpdate,
    updateTargetTable: mutationContext.isUpdate ? mutationContext.targetTable : undefined,
    subqueryDepth,
    outerScopeTables: outerTables.length > 0 ? outerTables : undefined,
  };
}
