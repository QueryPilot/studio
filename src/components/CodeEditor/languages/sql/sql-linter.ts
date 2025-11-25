import { syntaxTree } from "@codemirror/language";
import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension, EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { SqlDialect, MetadataProvider } from "@/components/CodeEditor/types";
import { getDialectValidator, type SyntaxError } from "./dialect-validators";
import { analyzeSqlContext, type TableRef } from "./context";

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "ON",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "VALUES",
  "RETURNING",
  "WITH",
  "DISTINCT",
  "UNION",
  "EXCEPT",
  "INTERSECT",
];

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
  linter((view) => collectDiagnostics(view.state, dialect), {
    delay: 200,
    needsRefresh: (update) => update.docChanged,
  });

// LRU Cache implementation with TTL support
class LRUCache<T> {
  private cache = new Map<string, { value: T; timestamp: number }>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number = 1000, ttl: number = 30000) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Cache for entity existence checks with LRU eviction (max 1000 entries, 30s TTL)
// Cache constants
const CACHE_MAX_SIZE = 1000;
const CACHE_TTL_MS = 30000; // 30 seconds

const entityExistsCache = new LRUCache<boolean>(CACHE_MAX_SIZE, CACHE_TTL_MS);
const columnTypeCache = new LRUCache<string>(CACHE_MAX_SIZE, CACHE_TTL_MS);

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
 * Find comparisons in WHERE clauses and validate types using the syntax tree
 */
const findTypeViolations = async (
  state: EditorState,
  provider: MetadataProvider,
  tables: TableRef[],
  defaultSchema?: string
): Promise<Diagnostic[]> => {
  const diagnostics: Diagnostic[] = [];
  const tree = syntaxTree(state);

  // Find all comparison expressions in the tree
  const comparisons: Array<{
    left: SyntaxNode;
    right: SyntaxNode;
    operator: string;
  }> = [];

  tree.iterate({
    enter: (node) => {
      // Look for comparison operators
      if (node.name === "CompareOp" || node.name === "BinaryExpression") {
        const cursor = node.node.cursor();
        let left: SyntaxNode | null = null;
        let right: SyntaxNode | null = null;
        let operator = "";

        // For BinaryExpression, find left operand, operator, right operand
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

      // Also check for IN expressions
      if (node.name === "InExpression") {
        // TODO: Handle IN expressions for type checking
        // For now, we'll skip this
      }
    }
  });

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

/**
 * Collect semantic diagnostics for SQL
 * Validates table/column existence, alias references, and type compatibility
 */
const collectSemanticDiagnostics = async (
  state: EditorState,
  provider: MetadataProvider,
  defaultSchema?: string
): Promise<Diagnostic[]> => {
  const diagnostics: Diagnostic[] = [];
  const tree = syntaxTree(state);

  // Track checked identifiers to avoid duplicate warnings
  const checkedIdentifiers = new Set<string>();

  // Find all identifier nodes that could be table or column references
  const identifiersToCheck: Array<{
    from: number;
    to: number;
    text: string;
    isQualified: boolean;
    qualifier?: string;
  }> = [];

  tree.iterate({
    enter: (node) => {
      if (node.name === "Identifier" || node.name === "QuotedIdentifier") {
        const text = state.doc.sliceString(node.from, node.to).replace(/["`[\]]/g, "");

        // Skip SQL keywords
        const upperText = text.toUpperCase();
        if (SQL_KEYWORDS.includes(upperText)) return;

        // Skip short identifiers (likely aliases)
        if (text.length < 2) return;

        // Check if this is qualified (has a dot before it)
        const prevSibling = node.node.prevSibling;
        const isQualified = prevSibling?.type.name === ".";

        let qualifier: string | undefined;
        if (isQualified && prevSibling?.prevSibling) {
          qualifier = state.doc
            .sliceString(prevSibling.prevSibling.from, prevSibling.prevSibling.to)
            .replace(/["`[\]]/g, "");
        }

        // Skip if already checked
        const key = `${node.from}-${text}`;
        if (checkedIdentifiers.has(key)) return;
        checkedIdentifiers.add(key);

        identifiersToCheck.push({
          from: node.from,
          to: node.to,
          text,
          isQualified,
          qualifier,
        });
      }
    },
  });

  // Batch check identifiers
  for (const identifier of identifiersToCheck) {
    // Get context at this position to understand intent
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

      // If qualified, check if the qualifier (alias/table) exists in scope
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

      // If intent is "table", check if the table exists
      if (analysis.intent === "table" && !identifier.isQualified) {
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

      // Collect tables for type validation
      if (analysis.activeStatementTables.length > 0) {
        // Add type violation checks for this statement
        const typeViolations = await findTypeViolations(
          state,
          provider,
          analysis.activeStatementTables,
          defaultSchema
        );
        diagnostics.push(...typeViolations);
        break; // Only need to check once per statement
      }
    } catch {
      // Skip this identifier if context analysis fails
    }
  }

  return diagnostics;
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
      return collectSemanticDiagnostics(view.state, provider, defaultSchema);
    },
    {
      delay: 500, // Async operations need slightly longer delay
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
