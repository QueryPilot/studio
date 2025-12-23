import { syntaxTree } from "@codemirror/language";
import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension, EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { getStatementAtPosition } from "@/components/CodeEditor/core";
import type { SqlDialect, MetadataProvider } from "@/components/CodeEditor/types";
import { getDialectValidator, type SyntaxError } from "./dialect-validators";
import { analyzeSqlContext, type TableRef } from "./context";
import { SQL_KEYWORDS, isSqlKeyword } from "./constants";
import { LRUCache, CACHE_CONFIG } from "./shared";

const UPPERCASE_IDENTIFIER = /^[A-Z_]+$/;

const levenshtein = (a: string, b: string): number => {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    if (!matrix[0]) matrix[0] = [];
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    const currentRow = matrix[i] || [];
    matrix[i] = currentRow;
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        currentRow[j] = matrix[i - 1]?.[j - 1] ?? 0;
        continue;
      }

      const substitution = (matrix[i - 1]?.[j - 1] ?? 0) + 1;
      const insertion = (currentRow[j - 1] ?? 0) + 1;
      const deletion = (matrix[i - 1]?.[j] ?? 0) + 1;

      currentRow[j] = Math.min(substitution, insertion, deletion);
    }
  }

  return matrix[b.length]?.[a.length] ?? 0;
};

const suggestKeyword = (identifier: string): string | null => {
  if (!identifier || identifier.length < 3) return null;
  if (identifier !== identifier.toUpperCase()) return null;
  if (!UPPERCASE_IDENTIFIER.test(identifier)) return null;

  let best: { keyword: string; distance: number } | null = null;

  for (const keyword of SQL_KEYWORDS) {
    if (identifier.length > keyword.length) continue;
    if (identifier[0] !== keyword[0]) continue;

    const distance = levenshtein(identifier, keyword);
    if (distance > 1) continue;

    if (!best || distance < best.distance) {
      best = { keyword, distance };
      if (distance === 0) break;
    }
  }

  return best?.distance === 0 ? null : best?.keyword ?? null;
};

const MAX_SNIPPET_LENGTH = 24;

const toSnippet = (state: EditorState, from: number, to: number): string => {
  const doc = state.doc;
  let raw = doc.sliceString(from, Math.min(doc.length, to));

  if (!raw.trim()) {
    const contextFrom = Math.max(0, from - 12);
    raw = doc.sliceString(contextFrom, Math.min(doc.length, from + 12));
  }

  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "token";

  if (normalized.length > MAX_SNIPPET_LENGTH) {
    return `${normalized.slice(0, MAX_SNIPPET_LENGTH - 1)}…`;
  }

  return normalized;
};

/**
 * Get context around an error position for dialect-specific validation
 */
const getErrorContext = (
  state: EditorState,
  from: number,
  to: number,
  contextSize = 200,
): string => {
  const doc = state.doc;
  const contextFrom = Math.max(0, from - contextSize);
  const contextTo = Math.min(doc.length, to + contextSize);
  return doc.sliceString(contextFrom, contextTo);
};

/**
 * Collect diagnostics with dialect-aware error filtering
 */
const collectDiagnostics = (
  state: EditorState,
  dialect?: SqlDialect,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const tree = syntaxTree(state);
  const validator = getDialectValidator(dialect);

  tree.iterate({
    enter: (node) => {
      if (node.type.isError) {
        const from = node.from;
        const to =
          node.to > node.from
            ? node.to
            : Math.min(state.doc.length, node.from + 1);
        const snippet = toSnippet(state, from, to);
        const context = getErrorContext(state, from, to);

        // Create a syntax error object for the validator
        const syntaxError: SyntaxError = {
          from,
          to,
          message: `Syntax error near "${snippet}"`,
          snippet,
        };

        // Check if this error should be suppressed based on dialect-specific patterns
        if (validator.shouldSuppressError(syntaxError, context)) {
          // Error is suppressed - it's valid dialect-specific syntax
          return;
        }

        // Report the error
        diagnostics.push({
          from,
          to,
          severity: "error",
          message: syntaxError.message,
        });
        return;
      }

      if (node.type.name === "Identifier") {
        const text = state.doc.sliceString(node.from, node.to);
        const suggestion = suggestKeyword(text);
        if (!suggestion) return;

        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "warning",
          message: `Unknown keyword "${text}". Did you mean "${suggestion}"?`,
          actions: [
            {
              name: `Replace with ${suggestion}`,
              apply(view, from, to) {
                view.dispatch({ changes: { from, to, insert: suggestion } });
              },
            },
          ],
        });
      }
    },
  });

  // Add dialect-specific validations
  const dialectDiagnostics = validator.validateDialectSyntax(state);
  diagnostics.push(...dialectDiagnostics);

  // Add best practice checks if available
  if (validator.validateBestPractices) {
    const bestPracticeDiagnostics = validator.validateBestPractices(state);
    diagnostics.push(...bestPracticeDiagnostics);
  }

  if (!diagnostics.length) return diagnostics;

  // Deduplicate diagnostics
  const deduped: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const diag of diagnostics) {
    const key = `${diag.from}-${diag.to}-${diag.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(diag);
  }

  return deduped;
};

/**
 * Create a SQL linter extension with dialect-aware validation
 * @param dialect - The SQL dialect (postgresql, mysql, sqlite, mssql, plsql)
 * @returns CodeMirror linter extension
 */
export const createSqlLinter = (dialect?: SqlDialect): Extension =>
  linter((view) => {
    // Skip linting very short content
    if (view.state.doc.length < 10) return [];
    return collectDiagnostics(view.state, dialect);
  }, {
    // Use adaptive delay - smaller documents get faster linting
    // Note: The delay option calculates at registration time
    delay: 800,
    needsRefresh: (update) => update.docChanged,
  });

// Cache for entity existence checks with LRU eviction (using shared cache config)
const entityExistsCache = new LRUCache<boolean>(CACHE_CONFIG.ENTITY_MAX_SIZE, CACHE_CONFIG.ENTITY_TTL);
const columnTypeCache = new LRUCache<string>(CACHE_CONFIG.ENTITY_MAX_SIZE, CACHE_CONFIG.ENTITY_TTL);

// Type compatibility groups
const NUMERIC_TYPES = ['integer', 'int', 'int4', 'int8', 'bigint', 'smallint', 'decimal', 'numeric', 'real', 'float', 'double', 'money'];
const TEXT_TYPES = ['text', 'varchar', 'char', 'character', 'string', 'citext', 'name'];
const BOOLEAN_TYPES = ['boolean', 'bool'];
const DATE_TYPES = ['date', 'timestamp', 'timestamptz', 'time', 'timetz', 'interval'];
const JSON_TYPES = ['json', 'jsonb'];

/**
 * Get the base type category for a column type
 */
function getTypeCategory(dataType: string): 'numeric' | 'text' | 'boolean' | 'date' | 'json' | 'unknown' {
  const lower = dataType.toLowerCase();
  if (NUMERIC_TYPES.some(t => lower.includes(t))) return 'numeric';
  if (TEXT_TYPES.some(t => lower.includes(t))) return 'text';
  if (BOOLEAN_TYPES.some(t => lower.includes(t))) return 'boolean';
  if (DATE_TYPES.some(t => lower.includes(t))) return 'date';
  if (JSON_TYPES.some(t => lower.includes(t))) return 'json';
  return 'unknown';
}


/**
 * Check if column type and literal type are compatible
 */
function areTypesCompatible(columnCategory: string, literalType: string): boolean {
  // Null is compatible with everything
  if (literalType === 'null') return true;

  // Unknown types are assumed compatible
  if (columnCategory === 'unknown' || literalType === 'unknown') return true;

  // Same category is compatible
  if (columnCategory === literalType) return true;

  // Text can hold anything when cast explicitly
  // But comparing numeric column with text literal is suspicious
  if (columnCategory === 'text' && literalType === 'numeric') return true; // Numbers can be in text

  return false;
}

const checkEntityExists = async (
  provider: MetadataProvider,
  entityName: string,
  schema?: string
): Promise<boolean> => {
  const cacheKey = `${schema || "default"}:${entityName.toLowerCase()}`;
  const cached = entityExistsCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  try {
    const entities = await provider.listEntities(schema);
    const exists = entities.some(
      (e) => e.name.toLowerCase() === entityName.toLowerCase()
    );
    entityExistsCache.set(cacheKey, exists);
    return exists;
  } catch {
    // On error, assume entity exists to avoid false positives
    return true;
  }
};

/**
 * Get column type with caching
 */
const getColumnType = async (
  provider: MetadataProvider,
  tableName: string,
  columnName: string,
  schema?: string
): Promise<string | null> => {
  const cacheKey = `${schema || "default"}:${tableName.toLowerCase()}:${columnName.toLowerCase()}`;
  const cached = columnTypeCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  try {
    const fields = await provider.listFields(tableName, schema);
    const field = fields.find(
      (f) => f.name.toLowerCase() === columnName.toLowerCase()
    );
    if (field) {
      columnTypeCache.set(cacheKey, field.dataType);
      return field.dataType;
    }
  } catch {
    // Ignore errors
  }
  return null;
};

/**
 * Extract column reference info from an AST node
 */
interface ColumnRef {
  from: number;
  to: number;
  qualifier?: string;
  name: string;
}

/**
 * Parse a column reference from a syntax node
 */
function parseColumnRef(state: EditorState, node: SyntaxNode): ColumnRef | null {
  const text = state.sliceDoc(node.from, node.to).replace(/["`[\]]/g, "");

  // Check if qualified (has dot before)
  const prevSibling = node.prevSibling;
  if (prevSibling?.name === "." && prevSibling.prevSibling) {
    const qualifier = state.sliceDoc(
      prevSibling.prevSibling.from,
      prevSibling.prevSibling.to
    ).replace(/["`[\]]/g, "");
    return { from: node.from, to: node.to, qualifier, name: text };
  }

  return { from: node.from, to: node.to, name: text };
}

/**
 * Determine the type of an expression node
 */
function getExpressionType(state: EditorState, node: SyntaxNode): 'numeric' | 'text' | 'boolean' | 'null' | 'column' | 'function' | 'unknown' {
  const text = state.sliceDoc(node.from, node.to).trim();
  const upper = text.toUpperCase();

  // Literal types
  if (node.name === "Number") return 'numeric';
  if (node.name === "String") return 'text';
  if (upper === "NULL") return 'null';
  if (upper === "TRUE" || upper === "FALSE") return 'boolean';

  // Function call
  if (node.name === "Application" || node.name === "CallExpression") return 'function';

  // Column reference
  if (node.name === "Identifier" || node.name === "QuotedIdentifier") {
    // Check if it's a function call by looking for parentheses after
    const next = node.nextSibling;
    if (next?.name === "ArgumentList" || next?.name === "(") return 'function';
    return 'column';
  }

  // Subquery
  if (node.name === "ParenthesizedExpression" || node.name === "Subquery") return 'unknown';

  // Cast expression - check the target type
  if (node.name === "CastExpression") {
    // Look for the type in cast
    const cursor = node.cursor();
    cursor.firstChild();
    do {
      if (cursor.name === "Type" || cursor.name === "Identifier") {
        const typeText = state.sliceDoc(cursor.from, cursor.to).toLowerCase();
        if (NUMERIC_TYPES.some(t => typeText.includes(t))) return 'numeric';
        if (TEXT_TYPES.some(t => typeText.includes(t))) return 'text';
        if (BOOLEAN_TYPES.some(t => typeText.includes(t))) return 'boolean';
        if (DATE_TYPES.some(t => typeText.includes(t))) return 'unknown'; // Date comparisons are complex
      }
    } while (cursor.nextSibling());
  }

  return 'unknown';
}

/**
 * Find comparisons and validate types using pre-collected comparison nodes
 */
const findTypeViolations = async (
  state: EditorState,
  provider: MetadataProvider,
  tables: TableRef[],
  comparisonNodes: Array<{ node: SyntaxNode }>,
  defaultSchema?: string
): Promise<Diagnostic[]> => {
  const diagnostics: Diagnostic[] = [];

  if (comparisonNodes.length === 0) return diagnostics;

  // Extract comparison info from pre-collected nodes
  const comparisons: Array<{
    left: SyntaxNode;
    right: SyntaxNode;
    operator: string;
  }> = [];

  for (const { node } of comparisonNodes) {
    const cursor = node.cursor();
    let left: SyntaxNode | null = null;
    let right: SyntaxNode | null = null;
    let operator = "";

    cursor.firstChild();
    do {
      if (!left && (cursor.name === "Identifier" || cursor.name === "QuotedIdentifier" ||
          cursor.name === "Number" || cursor.name === "String" || cursor.name === "Application")) {
        left = cursor.node;
      } else if (cursor.name === "CompareOp" || cursor.name === "ArithOp" ||
                 ["=", "<>", "!=", ">=", "<=", ">", "<"].includes(cursor.name)) {
        operator = state.sliceDoc(cursor.from, cursor.to);
      } else if (left && operator && !right) {
        right = cursor.node;
      }
    } while (cursor.nextSibling());

    if (left && right && operator) {
      comparisons.push({ left, right, operator });
    }
  }

  // Check each comparison
  for (const { left, right } of comparisons) {
    const leftType = getExpressionType(state, left);
    const rightType = getExpressionType(state, right);

    // Skip if both are non-columns (e.g., 1 = 1)
    if (leftType !== 'column' && rightType !== 'column') continue;

    // Get column info
    let columnNode: SyntaxNode;
    let valueNode: SyntaxNode;
    let valueType: string;

    if (leftType === 'column') {
      columnNode = left;
      valueNode = right;
      valueType = rightType;
    } else {
      columnNode = right;
      valueNode = left;
      valueType = leftType;
    }

    // Skip if comparing with another column or function
    if (valueType === 'column' || valueType === 'function' || valueType === 'unknown') continue;

    // Parse column reference
    const colRef = parseColumnRef(state, columnNode);
    if (!colRef) continue;

    // Resolve table name
    let tableName: string | undefined;

    if (colRef.qualifier) {
      const tableMatch = tables.find(
        (t) =>
          t.alias?.toLowerCase() === colRef.qualifier!.toLowerCase() ||
          t.name.toLowerCase() === colRef.qualifier!.toLowerCase()
      );
      if (tableMatch) tableName = tableMatch.name;
    } else if (tables.length === 1) {
      tableName = tables[0]?.name;
    }

    if (!tableName) continue;

    // Get column type from metadata
    const columnType = await getColumnType(provider, tableName, colRef.name, defaultSchema);
    if (!columnType) continue;

    const columnCategory = getTypeCategory(columnType);

    // Check compatibility
    if (!areTypesCompatible(columnCategory, valueType)) {
      diagnostics.push({
        from: valueNode.from,
        to: valueNode.to,
        severity: "warning",
        message: `Type mismatch: column '${colRef.name}' is ${columnType} but compared with ${valueType} value`,
      });
    }
  }

  return diagnostics;
};

// ============================================================================
// SINGLE-PASS AST COLLECTOR
// Collects all nodes in one tree iteration for batch processing
// ============================================================================

interface CollectedNodes {
  errors: Array<{ from: number; to: number }>;
  identifiers: Array<{ from: number; to: number; node: SyntaxNode }>;
  selectStatements: Array<{ from: number; to: number; node: SyntaxNode }>;
  insertStatements: Array<{ from: number; to: number; node: SyntaxNode }>;
  updateStatements: Array<{ from: number; to: number; node: SyntaxNode }>;
  deleteStatements: Array<{ from: number; to: number; node: SyntaxNode }>;
  alterStatements: Array<{ from: number; to: number; node: SyntaxNode }>;
  comparisons: Array<{ node: SyntaxNode }>;
}

/**
 * Single-pass AST traversal that collects all nodes needed for validation.
 * This replaces 8 separate tree.iterate() calls with one.
 */
function collectNodesInSinglePass(state: EditorState): CollectedNodes {
  const tree = syntaxTree(state);
  const collected: CollectedNodes = {
    errors: [],
    identifiers: [],
    selectStatements: [],
    insertStatements: [],
    updateStatements: [],
    deleteStatements: [],
    alterStatements: [],
    comparisons: [],
  };

  tree.iterate({
    enter: (node) => {
      switch (node.name) {
        case "⚠": // Error node
          collected.errors.push({ from: node.from, to: node.to });
          break;

        case "Identifier":
        case "QuotedIdentifier":
          collected.identifiers.push({ from: node.from, to: node.to, node: node.node });
          break;

        case "SelectStatement":
          collected.selectStatements.push({ from: node.from, to: node.to, node: node.node });
          break;

        case "InsertStatement":
          collected.insertStatements.push({ from: node.from, to: node.to, node: node.node });
          break;

        case "UpdateStatement":
          collected.updateStatements.push({ from: node.from, to: node.to, node: node.node });
          break;

        case "DeleteStatement":
          collected.deleteStatements.push({ from: node.from, to: node.to, node: node.node });
          break;

        case "AlterStatement":
          collected.alterStatements.push({ from: node.from, to: node.to, node: node.node });
          break;

        case "CompareOp":
        case "BinaryExpression":
          collected.comparisons.push({ node: node.node });
          break;
      }
    },
  });

  return collected;
}

// Helper to check if an identifier is a table/alias name (not a column)
function isTableContext(state: EditorState, node: SyntaxNode): boolean {
  const nextSibling = node.nextSibling;

  // If next sibling is a dot, this is a schema/table qualifier
  if (nextSibling?.name === ".") return true;

  // Check text immediately before this identifier for FROM/JOIN keywords
  const textBefore = state.sliceDoc(Math.max(0, node.from - 30), node.from);
  const trimmedBefore = textBefore.trimEnd().toUpperCase();

  // Check if preceded by table-introducing keywords
  if (/\b(FROM|JOIN|INTO|UPDATE|TABLE)\s*$/i.test(textBefore)) {
    return true;
  }

  // Check for LEFT/RIGHT/INNER/FULL/OUTER/CROSS JOIN pattern
  if (/\b(LEFT|RIGHT|INNER|FULL|OUTER|CROSS)\s+JOIN\s*$/i.test(textBefore)) {
    return true;
  }

  // Check if this is an alias (follows a table name or closing paren)
  if (/[a-zA-Z0-9_"`\]]\s+$/i.test(textBefore) || /\)\s+$/i.test(textBefore)) {
    if (!/[,=<>!+\-*/]\s*$/.test(textBefore) && !/\bAND\s*$/i.test(trimmedBefore) && !/\bOR\s*$/i.test(trimmedBefore)) {
      let parent = node.parent;
      while (parent) {
        if (parent.name === "FromClause" || parent.name === "JoinExpression") {
          const parentText = state.sliceDoc(parent.from, node.from).toUpperCase();
          if (!parentText.includes(" ON ") && !parentText.includes(" WHERE ")) {
            return true;
          }
        }
        parent = parent.parent;
      }
    }
  }

  // Check parent context for join expressions before ON
  let parent = node.parent;
  while (parent) {
    if (parent.name === "JoinExpression") {
      const textBeforeInJoin = state.sliceDoc(parent.from, node.from).toUpperCase();
      if (!textBeforeInJoin.includes(" ON ")) {
        return true;
      }
    }
    parent = parent.parent;
  }

  return false;
}

/**
 * Validate columns in SELECT statement using pre-collected nodes
 */
async function validateSelectColumns(
  state: EditorState,
  provider: MetadataProvider,
  tables: TableRef[],
  selectNodes: Array<{ from: number; to: number; node: SyntaxNode }>,
  defaultSchema?: string
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  if (tables.length === 0 || selectNodes.length === 0) return diagnostics;

  // Build column cache for all tables
  const tableColumnCache = new Map<string, Set<string>>();

  for (const table of tables) {
    try {
      const columns = await provider.listFields(table.name, table.schema || defaultSchema);
      tableColumnCache.set(
        table.name.toLowerCase(),
        new Set(columns.map(c => c.name.toLowerCase()))
      );
    } catch {
      // Skip if table doesn't exist
    }
  }

  const validatedPositions = new Set<number>();

  // Validate a single column reference
  const validateColumn = (node: { from: number; to: number; node: SyntaxNode }) => {
    if (validatedPositions.has(node.from)) return;
    validatedPositions.add(node.from);

    const colRef = parseColumnRef(state, node.node);
    if (!colRef) return;

    if (isSqlKeyword(colRef.name)) return;
    if (isTableContext(state, node.node)) return;

    let tableName: string | undefined;
    let tableColumns: Set<string> | undefined;

    if (colRef.qualifier) {
      const tableMatch = tables.find(
        (t) =>
          t.alias?.toLowerCase() === colRef.qualifier!.toLowerCase() ||
          t.name.toLowerCase() === colRef.qualifier!.toLowerCase()
      );
      if (tableMatch) {
        tableName = tableMatch.name;
        tableColumns = tableColumnCache.get(tableName.toLowerCase());
      } else {
        return;
      }
    } else if (tables.length === 1) {
      tableName = tables[0]?.name;
      tableColumns = tableName ? tableColumnCache.get(tableName.toLowerCase()) : undefined;
    } else {
      for (const table of tables) {
        const cols = tableColumnCache.get(table.name.toLowerCase());
        if (cols?.has(colRef.name.toLowerCase())) {
          tableName = table.name;
          tableColumns = cols;
          break;
        }
      }
      if (!tableName) return;
    }

    if (!tableName || !tableColumns) return;

    if (!tableColumns.has(colRef.name.toLowerCase())) {
      diagnostics.push({
        from: colRef.from,
        to: colRef.to,
        severity: "error",
        message: `Column '${colRef.name}' does not exist in table '${tableName}'`,
      });
    }
  };

  // Process pre-collected SELECT statements
  for (const stmt of selectNodes) {
    stmt.node.cursor().iterate((child) => {
      if (child.name === "Identifier" || child.name === "QuotedIdentifier") {
        validateColumn(child);
      }
    });
  }

  return diagnostics;
}

/**
 * Validate columns in INSERT statement using pre-collected nodes
 */
async function validateInsertColumns(
  state: EditorState,
  provider: MetadataProvider,
  insertNodes: Array<{ from: number; to: number; node: SyntaxNode }>,
  defaultSchema?: string
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  if (insertNodes.length === 0) return diagnostics;

  // Extract INSERT info from pre-collected nodes
  const insertStatements: Array<{ targetTable: string; columnListStart: number; columnListEnd: number }> = [];

  for (const { node } of insertNodes) {
    const cursor = node.cursor();
    cursor.firstChild();

    let targetTable: string | undefined;
    let columnListStart = -1;
    let columnListEnd = -1;

    do {
      if (cursor.name === "Identifier" && !targetTable) {
        const text = state.sliceDoc(cursor.from, cursor.to);
        const prevText = state.sliceDoc(Math.max(0, cursor.from - 20), cursor.from).toUpperCase();
        if (prevText.includes("INTO")) {
          const nextSibling = cursor.node.nextSibling;
          if (nextSibling?.name === ".") continue;
          targetTable = text.replace(/["`[\]]/g, "");
        }
      }

      if (cursor.name === "(" && targetTable && columnListStart === -1) {
        columnListStart = cursor.from;
      }
      if (cursor.name === ")" && targetTable && columnListStart > 0 && columnListEnd === -1) {
        columnListEnd = cursor.to;
      }
    } while (cursor.nextSibling());

    if (targetTable && columnListStart > 0 && columnListEnd > 0) {
      insertStatements.push({ targetTable, columnListStart, columnListEnd });
    }
  }

  // Validate asynchronously
  for (const stmt of insertStatements) {
    try {
      const validColumns = await provider.listFields(stmt.targetTable, defaultSchema);
      const validColumnNames = new Set(validColumns.map(c => c.name.toLowerCase()));

      const columnListText = state.sliceDoc(stmt.columnListStart, stmt.columnListEnd);
      const columnNames = columnListText
        .replace(/[()"`[\]]/g, "")
        .split(",")
        .map(c => c.trim())
        .filter(c => c.length > 0);

      for (const colName of columnNames) {
        if (!validColumnNames.has(colName.toLowerCase())) {
          const colIndex = state.doc.toString().indexOf(colName, stmt.columnListStart);
          if (colIndex >= 0) {
            diagnostics.push({
              from: colIndex,
              to: colIndex + colName.length,
              severity: "error",
              message: `Column '${colName}' does not exist in table '${stmt.targetTable}'`,
            });
          }
        }
      }
    } catch {
      // Skip validation if table doesn't exist
    }
  }

  return diagnostics;
}

/**
 * Validate columns in UPDATE statement using pre-collected nodes
 */
async function validateUpdateColumns(
  state: EditorState,
  provider: MetadataProvider,
  updateNodes: Array<{ from: number; to: number; node: SyntaxNode }>,
  defaultSchema?: string
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  if (updateNodes.length === 0) return diagnostics;

  // Extract UPDATE info from pre-collected nodes
  const updateStatements: Array<{ targetTable: string; stmtFrom: number; stmtTo: number }> = [];

  for (const { from, to, node } of updateNodes) {
    const cursor = node.cursor();
    cursor.firstChild();

    let targetTable: string | undefined;

    do {
      if (cursor.name === "Identifier" && !targetTable) {
        const text = state.sliceDoc(cursor.from, cursor.to);
        const prevText = state.sliceDoc(Math.max(0, cursor.from - 10), cursor.from).toUpperCase();
        if (prevText.includes("UPDATE")) {
          const nextSibling = cursor.node.nextSibling;
          if (nextSibling?.name === ".") continue;
          targetTable = text.replace(/["`[\]]/g, "");
          break;
        }
      }
    } while (cursor.nextSibling());

    if (targetTable) {
      updateStatements.push({ targetTable, stmtFrom: from, stmtTo: to });
    }
  }

  // Validate asynchronously
  for (const stmt of updateStatements) {
    try {
      const validColumns = await provider.listFields(stmt.targetTable, defaultSchema);
      const validColumnNames = new Set(validColumns.map(c => c.name.toLowerCase()));

      // Traverse within the statement node directly
      const stmtNode = updateNodes.find(n => n.from === stmt.stmtFrom)?.node;
      if (!stmtNode) continue;

      let inSetClause = false;
      let inWhereClause = false;

      stmtNode.cursor().iterate((child) => {
        const text = state.sliceDoc(child.from, child.to).toUpperCase();

        if (text === "SET") inSetClause = true;
        if (text === "WHERE") {
          inSetClause = false;
          inWhereClause = true;
        }

        if ((inSetClause || inWhereClause) && (child.name === "Identifier" || child.name === "QuotedIdentifier")) {
          const colName = state.sliceDoc(child.from, child.to).replace(/["`[\]]/g, "");

          if (isSqlKeyword(colName)) return;

          if (!validColumnNames.has(colName.toLowerCase())) {
            diagnostics.push({
              from: child.from,
              to: child.to,
              severity: "error",
              message: `Column '${colName}' does not exist in table '${stmt.targetTable}'`,
            });
          }
        }
      });
    } catch {
      // Skip validation if table doesn't exist
    }
  }

  return diagnostics;
}

/**
 * Validate columns in DELETE statement using pre-collected nodes
 */
async function validateDeleteColumns(
  state: EditorState,
  provider: MetadataProvider,
  deleteNodes: Array<{ from: number; to: number; node: SyntaxNode }>,
  defaultSchema?: string
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  if (deleteNodes.length === 0) return diagnostics;

  // Extract DELETE info from pre-collected nodes
  const deleteStatements: Array<{ targetTable: string; stmtFrom: number; stmtTo: number }> = [];

  for (const { from, to, node } of deleteNodes) {
    const cursor = node.cursor();
    cursor.firstChild();

    let targetTable: string | undefined;

    do {
      if (cursor.name === "Identifier" && !targetTable) {
        const text = state.sliceDoc(cursor.from, cursor.to);
        const prevText = state.sliceDoc(Math.max(0, cursor.from - 15), cursor.from).toUpperCase();
        if (prevText.includes("FROM")) {
          const nextSibling = cursor.node.nextSibling;
          if (nextSibling?.name === ".") continue;
          targetTable = text.replace(/["`[\]]/g, "");
          break;
        }
      }
    } while (cursor.nextSibling());

    if (targetTable) {
      deleteStatements.push({ targetTable, stmtFrom: from, stmtTo: to });
    }
  }

  // Validate asynchronously
  for (const stmt of deleteStatements) {
    try {
      const validColumns = await provider.listFields(stmt.targetTable, defaultSchema);
      const validColumnNames = new Set(validColumns.map(c => c.name.toLowerCase()));

      const stmtNode = deleteNodes.find(n => n.from === stmt.stmtFrom)?.node;
      if (!stmtNode) continue;

      let inWhereClause = false;

      stmtNode.cursor().iterate((child) => {
        const text = state.sliceDoc(child.from, child.to).toUpperCase();
        if (text === "WHERE") inWhereClause = true;

        if (inWhereClause && (child.name === "Identifier" || child.name === "QuotedIdentifier")) {
          const colName = state.sliceDoc(child.from, child.to).replace(/["`[\]]/g, "");

          if (isSqlKeyword(colName)) return;

          if (!validColumnNames.has(colName.toLowerCase())) {
            diagnostics.push({
              from: child.from,
              to: child.to,
              severity: "error",
              message: `Column '${colName}' does not exist in table '${stmt.targetTable}'`,
            });
          }
        }
      });
    } catch {
      // Skip validation if table doesn't exist
    }
  }

  return diagnostics;
}

/**
 * Validate columns in ALTER TABLE statements using pre-collected nodes
 */
async function validateDDLColumns(
  state: EditorState,
  provider: MetadataProvider,
  alterNodes: Array<{ from: number; to: number; node: SyntaxNode }>,
  defaultSchema?: string
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  if (alterNodes.length === 0) return diagnostics;

  // Extract ALTER info from pre-collected nodes
  const alterStatements: Array<{ targetTable: string; stmtFrom: number; stmtTo: number }> = [];

  for (const { from, to, node } of alterNodes) {
    const cursor = node.cursor();
    cursor.firstChild();

    let targetTable: string | undefined;

    do {
      if (cursor.name === "Identifier" && !targetTable) {
        const text = state.sliceDoc(cursor.from, cursor.to);
        const prevText = state.sliceDoc(Math.max(0, cursor.from - 20), cursor.from).toUpperCase();
        if (prevText.includes("TABLE")) {
          const nextSibling = cursor.node.nextSibling;
          if (nextSibling?.name === ".") continue;
          targetTable = text.replace(/["`[\]]/g, "");
          break;
        }
      }
    } while (cursor.nextSibling());

    if (targetTable) {
      alterStatements.push({ targetTable, stmtFrom: from, stmtTo: to });
    }
  }

  // Validate asynchronously
  for (const stmt of alterStatements) {
    try {
      const validColumns = await provider.listFields(stmt.targetTable, defaultSchema);
      const validColumnNames = new Set(validColumns.map(c => c.name.toLowerCase()));

      const stmtNode = alterNodes.find(n => n.from === stmt.stmtFrom)?.node;
      if (!stmtNode) continue;

      let inDropColumn = false;
      let inModifyColumn = false;

      stmtNode.cursor().iterate((child) => {
        const text = state.sliceDoc(child.from, child.to).toUpperCase();

        if (text === "DROP" || text.includes("DROP")) inDropColumn = true;
        if (text === "MODIFY" || text === "CHANGE" || text === "ALTER") inModifyColumn = true;
        if (text === "ADD") {
          inDropColumn = false;
          inModifyColumn = false;
        }

        if ((inDropColumn || inModifyColumn) && (child.name === "Identifier" || child.name === "QuotedIdentifier")) {
          const colName = state.sliceDoc(child.from, child.to).replace(/["`[\]]/g, "");

          if (isSqlKeyword(colName)) return;

          if (!validColumnNames.has(colName.toLowerCase())) {
            diagnostics.push({
              from: child.from,
              to: child.to,
              severity: "error",
              message: `Column '${colName}' does not exist in table '${stmt.targetTable}'`,
            });
          }
        }
      });
    } catch {
      // Table might not exist yet - skip validation
    }
  }

  return diagnostics;
}

/**
 * Collect semantic diagnostics for SQL using single-pass AST collection
 * Validates table/column existence, alias references, and type compatibility
 */
const collectSemanticDiagnostics = async (
  state: EditorState,
  provider: MetadataProvider,
  defaultSchema?: string
) => {
  const diagnostics: Diagnostic[] = [];

  // SINGLE-PASS: Collect all nodes we need in one tree iteration
  const collected = collectNodesInSinglePass(state);

  // Run all validation functions in parallel using pre-collected nodes
  const validationPromises: Promise<Diagnostic[]>[] = [];
  const processedStatements = new Set<string>();

  // Validate DML statements using pre-collected nodes
  validationPromises.push(validateInsertColumns(state, provider, collected.insertStatements, defaultSchema));
  validationPromises.push(validateUpdateColumns(state, provider, collected.updateStatements, defaultSchema));
  validationPromises.push(validateDeleteColumns(state, provider, collected.deleteStatements, defaultSchema));
  validationPromises.push(validateDDLColumns(state, provider, collected.alterStatements, defaultSchema));

  // Process pre-collected identifiers
  const checkedIdentifiers = new Set<string>();
  const identifiersToCheck: Array<{
    from: number;
    to: number;
    text: string;
    isQualified: boolean;
    qualifier?: string;
  }> = [];

  for (const { from, to, node } of collected.identifiers) {
    const text = state.doc.sliceString(from, to).replace(/["`[\]]/g, "");

    if (isSqlKeyword(text)) continue;
    if (text.length < 2) continue;

    const prevSibling = node.prevSibling;
    const isQualified = prevSibling?.type.name === ".";

    const nextSibling = node.nextSibling;
    const isSchemaQualifier = nextSibling?.type.name === ".";

    if (isSchemaQualifier) continue;

    let qualifier: string | undefined;
    if (isQualified && prevSibling?.prevSibling) {
      qualifier = state.doc
        .sliceString(prevSibling.prevSibling.from, prevSibling.prevSibling.to)
        .replace(/["`[\]]/g, "");
    }

    const key = `${from}-${text}`;
    if (checkedIdentifiers.has(key)) continue;
    checkedIdentifiers.add(key);

    identifiersToCheck.push({ from, to, text, isQualified, qualifier });
  }

  // Batch check identifiers
  for (const identifier of identifiersToCheck) {
    const mockContext = {
      state,
      pos: identifier.from,
      explicit: false,
      matchBefore: (pattern: RegExp) => {
        const line = state.doc.lineAt(identifier.from);
        const before = line.text.slice(0, identifier.from - line.from);
        return before.match(pattern);
      },
    };

    try {
      const analysis = analyzeSqlContext(mockContext as any, defaultSchema);

      if (identifier.isQualified && identifier.qualifier) {
        const aliasExists = analysis.activeStatementTables.some(
          (t: TableRef) =>
            t.alias?.toLowerCase() === identifier.qualifier!.toLowerCase() ||
            t.name.toLowerCase() === identifier.qualifier!.toLowerCase()
        );

        if (!aliasExists) {
          diagnostics.push({
            from: identifier.from - identifier.qualifier.length - 1,
            to: identifier.from - 1,
            severity: "error",
            message: `Unknown table or alias '${identifier.qualifier}' in this scope`,
          });
        }
      }

      if (analysis.intent === "table" && !identifier.isQualified) {
        // Check if it's a CTE or subquery alias in scope first
        const isCteOrAlias = analysis.activeStatementTables.some(
          (t) =>
            t.name.toLowerCase() === identifier.text.toLowerCase() ||
            t.alias?.toLowerCase() === identifier.text.toLowerCase()
        );

        if (!isCteOrAlias) {
          const exists = await checkEntityExists(provider, identifier.text, defaultSchema);
          if (!exists) {
            diagnostics.push({
              from: identifier.from,
              to: identifier.to,
              severity: "error",
              message: `Table '${identifier.text}' does not exist`,
            });
          }
        }
      }

      if (analysis.activeStatementTables.length > 0) {
        const statement = getStatementAtPosition(state, identifier.from);
        const statementKey = statement
          ? `${statement.from}-${statement.to}`
          : "unknown";

        if (!processedStatements.has(statementKey)) {
          processedStatements.add(statementKey);

          // Use pre-collected SELECT and comparison nodes
          validationPromises.push(
            validateSelectColumns(
              state,
              provider,
              analysis.activeStatementTables,
              collected.selectStatements,
              defaultSchema
            ),
            findTypeViolations(
              state,
              provider,
              analysis.activeStatementTables,
              collected.comparisons,
              defaultSchema
            )
          );
        }
      }
    } catch {
      // Skip this identifier if context analysis fails
    }
  }

  const allResults = await Promise.all(validationPromises);

  for (const result of allResults) {
    diagnostics.push(...result);
  }

  // Deduplicate diagnostics
  const deduped: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const diag of diagnostics) {
    const key = `${diag.from}-${diag.to}-${diag.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(diag);
  }

  return deduped;
};

/**
 * Create a semantic SQL linter that validates table/column existence
 * @param provider - MetadataProvider for checking entity existence
 * @param defaultSchema - Default schema for unqualified table names
 * @returns CodeMirror linter extension
 */
export const createSemanticLinter = (
  provider: MetadataProvider,
  defaultSchema?: string
): Extension =>
  linter(
    async (view) => {
      // Skip semantic linting for short content - not worth the overhead
      if (view.state.doc.length < 20) return [];
      return collectSemanticDiagnostics(view.state, provider, defaultSchema);
    },
    {
      // Semantic linting has higher base delay since it's async and less time-critical
      // Large documents get even longer delays to prevent overwhelming the provider
      delay: 2000,
      needsRefresh: (update) => update.docChanged,
    }
  );

/**
 * Clear the entity existence and column type caches
 * Call this when schema metadata is refreshed
 */
export const clearSemanticLinterCache = (): void => {
  entityExistsCache.clear();
  columnTypeCache.clear();
};
