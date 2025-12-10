/**
 * Semantic Highlighting Extension for SQL
 *
 * Provides context-aware syntax highlighting beyond basic token highlighting:
 * - Tables: highlighted distinctly from other identifiers
 * - Columns: highlighted based on context (qualified vs unqualified)
 * - CTEs: highlighted as user-defined types
 * - Aliases: highlighted to show they reference tables
 * - Keywords: already handled by base theme, enhanced here for SQL-specific
 *
 * Performance optimizations:
 * - Debounced analysis to avoid blocking on every keystroke
 * - LRU cache for parsed semantic tokens
 * - Incremental updates when possible
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";

// Semantic token types
type SemanticTokenType =
  | "table"
  | "column"
  | "alias"
  | "cte"
  | "function"
  | "parameter"
  | "schema";

interface SemanticToken {
  from: number;
  to: number;
  type: SemanticTokenType;
}

// Decoration marks for each semantic type
const decorations = {
  table: Decoration.mark({ class: "cm-sql-table" }),
  column: Decoration.mark({ class: "cm-sql-column" }),
  alias: Decoration.mark({ class: "cm-sql-alias" }),
  cte: Decoration.mark({ class: "cm-sql-cte" }),
  function: Decoration.mark({ class: "cm-sql-function" }),
  parameter: Decoration.mark({ class: "cm-sql-parameter" }),
  schema: Decoration.mark({ class: "cm-sql-schema" }),
};

// Keywords that precede table names
const TABLE_KEYWORDS = new Set([
  "from",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "outer",
  "update",
  "into",
  "table",
]);

// SQL aggregate/scalar functions for function highlighting
const SQL_FUNCTIONS = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "coalesce",
  "nullif",
  "cast",
  "convert",
  "substring",
  "trim",
  "upper",
  "lower",
  "length",
  "concat",
  "replace",
  "round",
  "floor",
  "ceil",
  "abs",
  "now",
  "current_date",
  "current_timestamp",
  "date",
  "year",
  "month",
  "day",
  "extract",
  "dateadd",
  "datediff",
  "row_number",
  "rank",
  "dense_rank",
  "lead",
  "lag",
  "first_value",
  "last_value",
  "ntile",
  "listagg",
  "string_agg",
  "array_agg",
  "json_agg",
  "jsonb_agg",
  "exists",
  "any",
  "all",
  "case",
  "when",
  "then",
  "else",
  "end",
  "iif",
  "ifnull",
  "if",
]);

// Cache for semantic tokens
interface TokenCache {
  docVersion: number;
  tokens: SemanticToken[];
}

let tokenCache: TokenCache | null = null;

/**
 * Extract CTE names from the document
 */
function extractCTENames(view: EditorView): Set<string> {
  const cteNames = new Set<string>();
  const doc = view.state.doc.toString();

  // Match WITH ... AS patterns
  const withMatch = doc.match(/\bWITH\s+/i);
  if (!withMatch) return cteNames;

  // Simple CTE name extraction: name AS (
  const ctePattern = /(\w+)\s+AS\s*\(/gi;
  let match;
  while ((match = ctePattern.exec(doc)) !== null) {
    if (match[1]) {
      cteNames.add(match[1].toLowerCase());
    }
  }

  return cteNames;
}

/**
 * Extract table aliases from the document
 */
function extractAliases(view: EditorView): Map<string, string> {
  const aliases = new Map<string, string>(); // alias -> table
  const doc = view.state.doc.toString();

  // Pattern: table_name [AS] alias (not followed by '(' to exclude functions)
  // FROM users u, FROM users AS u
  const aliasPattern =
    /\b(?:FROM|JOIN)\s+(?:(\w+)\.)?(\w+)\s+(?:AS\s+)?(\w+)(?!\s*\()/gi;
  let match;

  while ((match = aliasPattern.exec(doc)) !== null) {
    const tableName = match[2];
    const alias = match[3];
    if (tableName && alias && alias.toLowerCase() !== "on") {
      aliases.set(alias.toLowerCase(), tableName);
    }
  }

  return aliases;
}

/**
 * Analyze the syntax tree and extract semantic tokens
 */
function analyzeSemanticTokens(view: EditorView): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  const tree = syntaxTree(view.state);
  const doc = view.state.doc.toString();
  const cteNames = extractCTENames(view);
  const aliases = extractAliases(view);

  // Track seen positions to avoid duplicates
  const seen = new Set<string>();

  const cursor = tree.cursor();

  while (cursor.next()) {
    const node = cursor.node;
    const nodeText = doc.slice(node.from, node.to);
    const lowerText = nodeText.toLowerCase().replace(/["`[\]]/g, "");
    const key = `${node.from}:${node.to}`;

    if (seen.has(key)) continue;

    // Handle identifiers
    if (cursor.name === "Identifier" || cursor.name === "QuotedIdentifier") {
      const prevSibling = node.prevSibling;
      const nextSibling = node.nextSibling;
      const parent = node.parent;

      // Check if this is a function call (followed by parenthesis)
      if (nextSibling?.name === "(" || SQL_FUNCTIONS.has(lowerText)) {
        tokens.push({ from: node.from, to: node.to, type: "function" });
        seen.add(key);
        continue;
      }

      // Check if previous token is a dot (qualified identifier)
      if (prevSibling?.name === ".") {
        // This is a column in qualified access (table.column)
        tokens.push({ from: node.from, to: node.to, type: "column" });
        seen.add(key);

        // Also mark the qualifier (table/alias) if not already marked
        const qualifier = prevSibling.prevSibling;
        if (qualifier) {
          const qualKey = `${qualifier.from}:${qualifier.to}`;
          if (!seen.has(qualKey)) {
            const qualText = doc
              .slice(qualifier.from, qualifier.to)
              .toLowerCase()
              .replace(/["`[\]]/g, "");
            if (aliases.has(qualText)) {
              tokens.push({
                from: qualifier.from,
                to: qualifier.to,
                type: "alias",
              });
            } else if (cteNames.has(qualText)) {
              tokens.push({
                from: qualifier.from,
                to: qualifier.to,
                type: "cte",
              });
            } else {
              tokens.push({
                from: qualifier.from,
                to: qualifier.to,
                type: "table",
              });
            }
            seen.add(qualKey);
          }
        }
        continue;
      }

      // Check if next token is a dot (this is a qualifier - table or schema)
      if (nextSibling?.name === ".") {
        // Could be schema.table or table.column
        const afterDot = nextSibling.nextSibling;
        if (afterDot) {
          const afterDotNext = afterDot.nextSibling;
          // If there's another dot after, this is schema.table.column
          if (afterDotNext?.name === ".") {
            tokens.push({ from: node.from, to: node.to, type: "schema" });
          } else if (aliases.has(lowerText)) {
            tokens.push({ from: node.from, to: node.to, type: "alias" });
          } else if (cteNames.has(lowerText)) {
            tokens.push({ from: node.from, to: node.to, type: "cte" });
          } else {
            tokens.push({ from: node.from, to: node.to, type: "table" });
          }
          seen.add(key);
          continue;
        }
      }

      // Check context from previous keyword
      if (prevSibling?.name === "Keyword") {
        const keyword = doc
          .slice(prevSibling.from, prevSibling.to)
          .toLowerCase();

        if (TABLE_KEYWORDS.has(keyword)) {
          // This is a table name
          if (cteNames.has(lowerText)) {
            tokens.push({ from: node.from, to: node.to, type: "cte" });
          } else {
            tokens.push({ from: node.from, to: node.to, type: "table" });
          }
          seen.add(key);
          continue;
        }
      }

      // Check if this is an alias definition (right after a table name)
      if (prevSibling) {
        const prevPrev = prevSibling.prevSibling;
        if (prevPrev) {
          // table_name alias or table_name AS alias
          const isPotentialAlias =
            prevSibling.name === "Keyword" &&
            doc.slice(prevSibling.from, prevSibling.to).toLowerCase() === "as";
          const isImplicitAlias =
            prevSibling.name === "Identifier" ||
            prevSibling.name === "QuotedIdentifier";

          if (isPotentialAlias || isImplicitAlias) {
            // Check if the previous identifier follows a table keyword
            const checkNode = isPotentialAlias ? prevPrev : prevSibling;
            if (
              checkNode.name === "Identifier" ||
              checkNode.name === "QuotedIdentifier"
            ) {
              const beforeCheck = checkNode.prevSibling;
              if (beforeCheck?.name === "Keyword") {
                const kw = doc
                  .slice(beforeCheck.from, beforeCheck.to)
                  .toLowerCase();
                if (TABLE_KEYWORDS.has(kw)) {
                  tokens.push({ from: node.from, to: node.to, type: "alias" });
                  seen.add(key);
                  continue;
                }
              }
            }
          }
        }
      }

      // Check parent context for column identification
      if (parent) {
        const parentName = parent.name;
        if (
          [
            "SelectClause",
            "WhereClause",
            "HavingClause",
            "GroupByClause",
            "OrderByClause",
            "SetClause",
          ].includes(parentName)
        ) {
          // Unqualified identifier in column context
          if (aliases.has(lowerText)) {
            tokens.push({ from: node.from, to: node.to, type: "alias" });
          } else if (cteNames.has(lowerText)) {
            tokens.push({ from: node.from, to: node.to, type: "cte" });
          }
          // Don't mark unqualified columns to avoid over-highlighting
          seen.add(key);
          continue;
        }
      }
    }

    // Handle parameters ($1, :param, @param)
    if (cursor.name === "Parameter" || cursor.name === "NamedParameter") {
      tokens.push({ from: node.from, to: node.to, type: "parameter" });
      seen.add(key);
    }
  }

  return tokens;
}

/**
 * Build decorations from semantic tokens
 */
function buildDecorations(tokens: SemanticToken[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  // Sort tokens by position (required for RangeSetBuilder)
  const sorted = [...tokens].sort((a, b) => a.from - b.from);

  for (const token of sorted) {
    const deco = decorations[token.type];
    builder.add(token.from, token.to, deco);
  }

  return builder.finish();
}

/**
 * Create the semantic highlighting ViewPlugin
 */
function createSemanticHighlightingPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      pendingUpdate: ReturnType<typeof setTimeout> | null = null;

      constructor(view: EditorView) {
        this.decorations = this.analyze(view);
      }

      analyze(view: EditorView): DecorationSet {
        const docVersion = view.state.doc.length; // Simple version check

        // Check cache
        if (tokenCache && tokenCache.docVersion === docVersion) {
          return buildDecorations(tokenCache.tokens);
        }

        // Analyze and cache
        const tokens = analyzeSemanticTokens(view);
        tokenCache = { docVersion, tokens };

        return buildDecorations(tokens);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          // Debounce updates to avoid blocking on rapid typing
          if (this.pendingUpdate) {
            clearTimeout(this.pendingUpdate);
          }

          this.pendingUpdate = setTimeout(() => {
            this.decorations = this.analyze(update.view);
            this.pendingUpdate = null;
          }, 100);
        }
      }

      destroy() {
        if (this.pendingUpdate) {
          clearTimeout(this.pendingUpdate);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * CSS theme for semantic highlighting
 */
const semanticHighlightingTheme = EditorView.baseTheme({
  // Tables - blue tint
  ".cm-sql-table": {
    color: "#60A5FA",
    fontWeight: "500",
  },

  // Columns - purple tint (when qualified)
  ".cm-sql-column": {
    color: "#A78BFA",
  },

  // Aliases - cyan/teal
  ".cm-sql-alias": {
    color: "#2DD4BF",
    fontStyle: "italic",
  },

  // CTEs - orange (user-defined types)
  ".cm-sql-cte": {
    color: "#FB923C",
    fontWeight: "500",
  },

  // Functions - yellow/amber
  ".cm-sql-function": {
    color: "#FBBF24",
  },

  // Parameters - pink/magenta
  ".cm-sql-parameter": {
    color: "#F472B6",
    fontWeight: "500",
  },

  // Schema - muted blue
  ".cm-sql-schema": {
    color: "#94A3B8",
  },

  // Light theme overrides
  "&light .cm-sql-table": {
    color: "#2563EB",
  },
  "&light .cm-sql-column": {
    color: "#7C3AED",
  },
  "&light .cm-sql-alias": {
    color: "#0D9488",
    fontStyle: "italic",
  },
  "&light .cm-sql-cte": {
    color: "#EA580C",
  },
  "&light .cm-sql-function": {
    color: "#D97706",
  },
  "&light .cm-sql-parameter": {
    color: "#DB2777",
  },
  "&light .cm-sql-schema": {
    color: "#64748B",
  },
});

/**
 * Create the semantic highlighting extension
 */
export function createSemanticHighlightingExtension() {
  return [createSemanticHighlightingPlugin(), semanticHighlightingTheme];
}

/**
 * Clear the semantic token cache (useful when schema changes)
 */
export function clearSemanticCache(): void {
  tokenCache = null;
}
