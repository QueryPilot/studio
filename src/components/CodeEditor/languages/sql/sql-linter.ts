import { syntaxTree } from "@codemirror/language";
import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension, EditorState } from "@codemirror/state";
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
    delay: 400,
    needsRefresh: (update) => update.docChanged,
  });

// Cache for entity existence checks to avoid repeated async calls
const entityExistsCache = new Map<string, { exists: boolean; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

const checkEntityExists = async (
  provider: MetadataProvider,
  entityName: string,
  schema?: string
): Promise<boolean> => {
  const cacheKey = `${schema || "default"}:${entityName.toLowerCase()}`;
  const cached = entityExistsCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.exists;
  }

  try {
    const entities = await provider.listEntities(schema);
    const exists = entities.some(
      (e) => e.name.toLowerCase() === entityName.toLowerCase()
    );
    entityExistsCache.set(cacheKey, { exists, timestamp: Date.now() });
    return exists;
  } catch {
    // On error, assume entity exists to avoid false positives
    return true;
  }
};

/**
 * Collect semantic diagnostics for SQL
 * Validates table/column existence and alias references
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
      delay: 800, // Longer delay for async operations
      needsRefresh: (update) => update.docChanged,
    }
  );

/**
 * Clear the entity existence cache
 * Call this when schema metadata is refreshed
 */
export const clearSemanticLinterCache = (): void => {
  entityExistsCache.clear();
};
