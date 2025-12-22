import { syntaxTree } from "@codemirror/language";
import type { CompletionContext } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { isTableKeyword } from "./constants";
import {
  hashString,
  extractTablesFromRange as sharedExtractTablesFromRange,
  parseCTEs,
  TABLE_CLAUSE_TYPES,
  type TableRef,
} from "./shared";

export type SqlIntent = "table" | "column" | "keyword" | "function" | "unknown";

// Re-export TableRef for consumers
export type { TableRef };

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
  // JOIN ON context
  isJoinOnContext?: boolean;
  joinTargetTable?: TableRef; // The table being joined (the one right before ON)
}

// Scope boundary node types in Lezer SQL grammar
const SCOPE_NODES = new Set([
  "SelectStatement",
  "InsertStatement",
  "UpdateStatement",
  "DeleteStatement",
  "Subquery",
  "ParenthesizedExpression",
]);

// ============================================================================
// CONTEXT ANALYSIS CACHE - Avoid re-analyzing on every keystroke
// ============================================================================

// Position-independent cached analysis
interface CachedDocumentAnalysis {
  ctes: TableRef[];
  mutationContext: {
    isInsert: boolean;
    isUpdate: boolean;
    targetTable?: string;
  };
  sql: string;
  docHash: number;
  timestamp: number;
}

// Document-level cache (no position in key = no cache miss on cursor move)
const documentCache = new Map<string, CachedDocumentAnalysis>();
const DOCUMENT_CACHE_MAX_SIZE = 50;
const DOCUMENT_CACHE_TTL = 5000; // 5 seconds

function getDocumentCacheKey(docHash: number): string {
  return `${docHash}`;
}

function cleanDocumentCache(): void {
  const now = Date.now();
  for (const [key, entry] of documentCache) {
    if (now - entry.timestamp > DOCUMENT_CACHE_TTL) {
      documentCache.delete(key);
    }
  }
  // Evict oldest if over size
  if (documentCache.size > DOCUMENT_CACHE_MAX_SIZE) {
    const entries = [...documentCache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );
    for (let i = 0; i < entries.length - DOCUMENT_CACHE_MAX_SIZE / 2; i++) {
      const entry = entries[i];
      if (entry) {
        documentCache.delete(entry[0]);
      }
    }
  }
}

/**
 * Find all scope boundaries (queries/subqueries) containing a position using the syntax tree.
 * Returns scopes from innermost to outermost.
 */
function findScopesAtPosition(
  state: EditorState,
  pos: number
): Array<{ node: SyntaxNode; depth: number }> {
  const tree = syntaxTree(state);
  const scopes: Array<{ node: SyntaxNode; depth: number }> = [];

  let currentNode: SyntaxNode | null = tree.resolveInner(pos, -1);
  let depth = 0;

  // Walk up the tree to find all enclosing scopes
  while (currentNode) {
    // Check if this is a SELECT/INSERT/UPDATE/DELETE statement
    if (SCOPE_NODES.has(currentNode.name)) {
      // For ParenthesizedExpression, check if it contains a SELECT (making it a subquery)
      if (currentNode.name === "ParenthesizedExpression") {
        let hasSelect = false;
        const cursor = currentNode.cursor();
        cursor.firstChild();
        do {
          if (cursor.name === "SelectStatement" || cursor.name === "Keyword") {
            const text = state.sliceDoc(cursor.from, cursor.to).toUpperCase();
            if (text === "SELECT") {
              hasSelect = true;
              break;
            }
          }
        } while (cursor.nextSibling());

        if (!hasSelect) {
          currentNode = currentNode.parent;
          continue;
        }
      }

      scopes.push({ node: currentNode, depth });
      depth++;
    }
    currentNode = currentNode.parent;
  }

  return scopes;
}

/**
 * Get the subquery scope at a given position using the syntax tree.
 * Returns the innermost SELECT statement containing the position, or null if at top level.
 */
function getSubqueryScopeAtPosition(
  state: EditorState,
  pos: number
): { from: number; to: number; depth: number } | null {
  const scopes = findScopesAtPosition(state, pos);

  // scopes[0] is the innermost scope
  // If we have more than one scope, we're in a subquery
  if (scopes.length > 1 && scopes[0]) {
    return {
      from: scopes[0].node.from,
      to: scopes[0].node.to,
      depth: scopes.length - 1,
    };
  }

  return null;
}

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
 * Extract table references from a specific SQL range.
 * Uses shared implementation for consistency.
 */
function extractTablesFromRange(
  state: EditorState,
  from: number,
  to: number,
  seen: Set<string>
): TableRef[] {
  const tables = sharedExtractTablesFromRange(state, from, to, seen);
  // Add any newly found tables/aliases to seen set
  for (const table of tables) {
    seen.add(table.name.toLowerCase());
    if (table.alias) seen.add(table.alias.toLowerCase());
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
  pos: number,
  cachedCTEs: TableRef[]
): { tables: TableRef[]; outerTables: TableRef[]; subqueryDepth: number } {
  const tree = syntaxTree(state);
  const tables: TableRef[] = [];
  const outerTables: TableRef[] = [];

  // Use cached CTEs (available at all scope levels)
  for (const cte of cachedCTEs) {
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

  // Check if we're in a subquery using the syntax tree
  const subqueryScope = getSubqueryScopeAtPosition(state, pos);
  const seen = new Set<string>(cachedCTEs.map(c => c.name.toLowerCase()));

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
          isTableKeyword(state.sliceDoc(prevSibling.from, prevSibling.to));

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
      const prevText = state.sliceDoc(prevToken.from, prevToken.to);
      if (isTableKeyword(prevText)) {
        return "table";
      }
    }
  }

  return "column"; // Default to column suggestions
}

/**
 * Detect if we're in a JOIN ON context and extract the joining table.
 * Uses AST-based analysis to handle all JOIN types:
 * - Basic: FROM a JOIN b ON |
 * - With aliases: FROM users u JOIN orders o ON |
 * - LEFT/RIGHT/INNER/FULL: LEFT JOIN b ON |
 * - Schema-qualified: JOIN schema.table ON |
 * - Multi-table: FROM a JOIN b ON ... JOIN c ON |
 * - Self-join: FROM emp e1 JOIN emp e2 ON |
 */
function detectJoinOnContext(
  state: EditorState,
  pos: number
): { isJoinOnContext: boolean; joinTargetTable?: TableRef } {
  const tree = syntaxTree(state);
  const sql = state.doc.toString();
  const beforeCursor = sql.slice(0, pos);

  // Quick check: look for JOIN ... ON pattern before cursor
  // This regex captures the table (with optional schema and alias) right before ON
  // Pattern: JOIN [schema.]table [AS] [alias] ON
  const joinOnPattern = /\b(?:LEFT\s+|RIGHT\s+|INNER\s+|FULL\s+(?:OUTER\s+)?|CROSS\s+)?JOIN\s+(?:([a-zA-Z0-9_"`[\]]+)\.)?([a-zA-Z0-9_"`[\]]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_"`[\]]+))?\s+ON\s*$/i;
  const joinOnMatch = beforeCursor.match(joinOnPattern);

  if (joinOnMatch) {
    const schema = joinOnMatch[1]?.replace(/["`[\]]/g, "");
    const tableName = joinOnMatch[2]?.replace(/["`[\]]/g, "") || "";
    const alias = joinOnMatch[3]?.replace(/["`[\]]/g, "");

    return {
      isJoinOnContext: true,
      joinTargetTable: {
        schema,
        name: tableName,
        alias,
      },
    };
  }

  // Also check for partial conditions: JOIN b ON a.|
  // In this case, we're completing a column, not the full condition
  const partialConditionPattern = /\b(?:LEFT\s+|RIGHT\s+|INNER\s+|FULL\s+(?:OUTER\s+)?|CROSS\s+)?JOIN\s+(?:([a-zA-Z0-9_"`[\]]+)\.)?([a-zA-Z0-9_"`[\]]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_"`[\]]+))?\s+ON\s+[a-zA-Z0-9_"`[\].]+\s*$/i;
  const partialMatch = beforeCursor.match(partialConditionPattern);

  // If we have a partial condition (already started typing), don't suggest full condition
  if (partialMatch) {
    // Check if it's just a qualifier (ends with dot)
    if (beforeCursor.trimEnd().endsWith('.')) {
      // User is typing column - let normal column completion handle it
      return { isJoinOnContext: false };
    }
  }

  // Try AST-based detection for more complex cases
  const node = tree.resolveInner(pos, -1);
  let current: SyntaxNode | null = node;

  while (current) {
    // Check if we're inside a JoinExpression
    if (current.name === "JoinExpression") {
      // Look for ON keyword in this join expression
      const cursor = current.cursor();
      cursor.firstChild();
      
      let foundOn = false;
      let joinTable: TableRef | undefined;
      let onPos = -1;

      do {
        // Look for the ON keyword
        if (cursor.name === "Keyword") {
          const keyword = state.sliceDoc(cursor.from, cursor.to).toUpperCase();
          if (keyword === "ON") {
            foundOn = true;
            onPos = cursor.to;
          } else if (["JOIN", "LEFT", "RIGHT", "INNER", "FULL", "OUTER", "CROSS"].includes(keyword)) {
            // This is a join keyword, next identifier should be the table
            continue;
          }
        }

        // Look for table identifier after JOIN keyword
        if ((cursor.name === "Identifier" || cursor.name === "QuotedIdentifier") && !joinTable) {
          const prevSibling = cursor.node.prevSibling;
          // Check if previous sibling is JOIN or a dot (for schema.table)
          if (prevSibling?.name === "Keyword") {
            const kw = state.sliceDoc(prevSibling.from, prevSibling.to).toUpperCase();
            if (kw === "JOIN") {
              const tableName = state.sliceDoc(cursor.from, cursor.to).replace(/["`[\]]/g, "");
              
              // Check for alias
              let alias: string | undefined;
              let nextNode = cursor.node.nextSibling;
              if (nextNode?.name === "Keyword") {
                const nextKw = state.sliceDoc(nextNode.from, nextNode.to).toUpperCase();
                if (nextKw === "AS") {
                  nextNode = nextNode.nextSibling;
                }
              }
              if (nextNode && (nextNode.name === "Identifier" || nextNode.name === "QuotedIdentifier")) {
                const nextText = state.sliceDoc(nextNode.from, nextNode.to).toUpperCase();
                // Make sure it's not ON keyword
                if (nextText !== "ON") {
                  alias = state.sliceDoc(nextNode.from, nextNode.to).replace(/["`[\]]/g, "");
                }
              }

              // Check for schema
              let schema: string | undefined;
              if (prevSibling.prevSibling?.name === ".") {
                const schemaNode = prevSibling.prevSibling.prevSibling;
                if (schemaNode) {
                  schema = state.sliceDoc(schemaNode.from, schemaNode.to).replace(/["`[\]]/g, "");
                }
              }

              joinTable = { schema, name: tableName, alias };
            }
          }
        }
      } while (cursor.nextSibling());

      // If we found ON and cursor is right after it (with optional whitespace)
      if (foundOn && onPos > 0 && pos >= onPos) {
        // Check that there's only whitespace between ON and cursor
        const afterOn = sql.slice(onPos, pos);
        if (/^\s*$/.test(afterOn) || /^\s*[\w$]*$/.test(afterOn)) {
          return {
            isJoinOnContext: true,
            joinTargetTable: joinTable,
          };
        }
      }
    }

    current = current.parent;
  }

  return { isJoinOnContext: false };
}

/**
 * Get or compute document-level analysis (position-independent).
 * This is cached by document hash only - cursor movement doesn't invalidate cache.
 *
 * All expensive computations that don't depend on cursor position go here.
 */
function getOrComputeDocumentAnalysis(
  _state: EditorState,
  sql: string,
  docHash: number
): CachedDocumentAnalysis {
  const cacheKey = getDocumentCacheKey(docHash);
  const cached = documentCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < DOCUMENT_CACHE_TTL) {
    return cached; // CACHE HIT - reuse expensive computations
  }

  // Clean old cache entries periodically
  if (documentCache.size > DOCUMENT_CACHE_MAX_SIZE / 2) {
    cleanDocumentCache();
  }

  // CACHE MISS - compute all position-independent data
  const ctes = parseCTEs(sql);
  const mutationContext = detectMutationContext(sql);

  const analysis: CachedDocumentAnalysis = {
    ctes,
    mutationContext,
    sql,
    docHash,
    timestamp: Date.now(),
  };

  documentCache.set(cacheKey, analysis);
  return analysis;
}

/**
 * Analyze the SQL context at the cursor position.
 * Returns information about what kind of completion is expected
 * and which tables are in scope.
 *
 * Performance optimizations:
 * - Caches document analysis by hash only (no position in key)
 * - Position-specific resolution uses cached data
 * - Cursor movement doesn't invalidate cache
 */
export function analyzeSqlContext(
  context: CompletionContext,
  _defaultSchema?: string
): SqlContextAnalysis {
  const { state, pos } = context;
  const sql = state.doc.toString();

  // ACTUALLY USE the cached document analysis (position-independent)
  const docHash = hashString(sql);
  const docAnalysis = getOrComputeDocumentAnalysis(state, sql, docHash);

  // Position-specific analysis (not cached)
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

  // Get tables with subquery scope isolation using cached CTEs
  const { tables, outerTables, subqueryDepth } = getScopeTables(state, pos, docAnalysis.ctes);

  // Use cached mutation context
  const mutationContext = docAnalysis.mutationContext;

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

  // Detect JOIN ON context (position-specific)
  const joinContext = detectJoinOnContext(state, pos);

  const analysis: SqlContextAnalysis = {
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
    isJoinOnContext: joinContext.isJoinOnContext,
    joinTargetTable: joinContext.joinTargetTable,
  };

  return analysis;
}
