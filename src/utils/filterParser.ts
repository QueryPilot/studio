import type {
  FilterCondition,
  FilterConfig,
  FilterOperator,
  FilterGroup,
} from "@/types/filter";
import type { ColumnMeta } from "@/types/schema";

// Re-export ColumnMeta for backwards compatibility with existing imports
export type { ColumnMeta };

export type FilterMode = "search" | "where" | "ai";

// ============================================================================
// Search Pattern Types
// ============================================================================

/** Pattern type for search terms */
export type PatternType =
  | "contains"
  | "startsWith"
  | "endsWith"
  | "exact"
  | "regex";

/** Token types for search query parsing */
export type TokenType =
  | "term"
  | "and"
  | "or"
  | "not"
  | "group"
  | "lparen"
  | "rparen";

/** A parsed search token */
export interface SearchToken {
  type: TokenType;
  value?: string;
  caseSensitive?: boolean;
  patternType?: PatternType;
  regexFlags?: string;
  children?: SearchToken[];
  /** Target column name for column:value syntax */
  targetColumn?: string;
}

/** Validation limits for search queries */
export interface SearchLimits {
  maxTerms: number;
  maxGroupDepth: number;
  maxRegexPatterns: number;
  minTermLength: number;
}

/** Default search limits */
export const DEFAULT_SEARCH_LIMITS: SearchLimits = {
  maxTerms: 10,
  maxGroupDepth: 3,
  maxRegexPatterns: 3,
  minTermLength: 1,
};

/** Validation result for search queries */
export interface SearchValidation {
  valid: boolean;
  error?: string;
  termCount?: number;
  depth?: number;
  regexCount?: number;
}

// ============================================================================
// Search Pattern Tokenizer
// ============================================================================

// Pre-compiled regex for column:value detection (sticky flag for performance)
const COLUMN_PREFIX_REGEX = /([a-zA-Z_][a-zA-Z0-9_]*):/y;

/**
 * Tokenize a search query string into tokens.
 * Handles: terms, quoted phrases, operators (|, &, -), parentheses, patterns (^, $, /regex/)
 */
export function tokenizeSearch(input: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const char = input[i];

    // Skip whitespace
    if (char === undefined || /\s/.test(char)) {
      i++;
      continue;
    }

    // Parentheses
    if (char === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }

    // OR operator: |
    if (char === "|") {
      tokens.push({ type: "or" });
      i++;
      continue;
    }

    // AND operator: & (explicit)
    if (char === "&") {
      tokens.push({ type: "and" });
      i++;
      continue;
    }

    // NOT operator: - (must be followed by term, not standalone)
    const nextChar = input[i + 1];
    if (
      char === "-" &&
      i + 1 < len &&
      nextChar !== undefined &&
      !/\s/.test(nextChar)
    ) {
      tokens.push({ type: "not" });
      i++;
      continue;
    }

    // Quoted phrase: "..." or '...'
    if (char === '"' || char === "'") {
      const quote = char;
      let phrase = "";
      i++; // skip opening quote
      while (i < len && input[i] !== quote) {
        if (input[i] === "\\" && i + 1 < len) {
          phrase += input[i + 1];
          i += 2;
        } else {
          phrase += input[i];
          i++;
        }
      }
      i++; // skip closing quote
      if (phrase) {
        tokens.push({
          type: "term",
          value: phrase,
          caseSensitive: false,
          patternType: "contains",
        });
      }
      continue;
    }

    // Regex pattern: /.../ or /.../i
    if (char === "/") {
      let regex = "";
      i++; // skip opening /
      while (i < len) {
        const c = input[i];
        if (c === "/") break;
        if (c === "\\" && i + 1 < len) {
          regex += c + (input[i + 1] ?? "");
          i += 2;
        } else {
          regex += c ?? "";
          i++;
        }
      }
      i++; // skip closing /
      // Check for flags (i)
      let flags = "";
      while (i < len) {
        const c = input[i];
        if (c === undefined || !/[gimsuy]/.test(c)) break;
        flags += c;
        i++;
      }
      if (regex) {
        tokens.push({
          type: "term",
          value: regex,
          caseSensitive: !flags.includes("i"),
          patternType: "regex",
          regexFlags: flags,
        });
      }
      continue;
    }

    // Case-sensitive prefix: !
    let caseSensitive = false;
    const peekChar = input[i + 1];
    if (
      char === "!" &&
      i + 1 < len &&
      peekChar !== undefined &&
      !/[\s|&()]/.test(peekChar)
    ) {
      caseSensitive = true;
      i++;
    }

    // Check for column:value syntax (e.g., name:john or status:active|pending)
    // Escape with \: to search for literal colon (e.g., "time\:10:30" searches for "time:10:30")
    // Look ahead for column name followed by colon (but not escaped colon)
    // Use sticky regex to avoid slice() allocation
    let targetColumn: string | undefined;
    COLUMN_PREFIX_REGEX.lastIndex = i;
    const colonMatch = COLUMN_PREFIX_REGEX.exec(input);
    // Check if colon is escaped (preceded by backslash)
    const isEscapedColon = i > 0 && input[i - 1] === "\\";
    if (colonMatch && colonMatch.index === i && !isEscapedColon) {
      targetColumn = colonMatch[1];
      i += colonMatch[0].length; // skip "column:"

      // Parse column-targeted value(s) - can be val1|val2|val3
      const columnValues: SearchToken[] = [];

      while (i < len) {
        // Check for regex in column context
        if (input[i] === "/") {
          let regex = "";
          i++; // skip opening /
          while (i < len) {
            const c = input[i];
            if (c === "/") break;
            if (c === "\\" && i + 1 < len) {
              regex += c + (input[i + 1] ?? "");
              i += 2;
            } else {
              regex += c ?? "";
              i++;
            }
          }
          i++; // skip closing /
          let flags = "";
          while (i < len) {
            const c = input[i];
            if (c === undefined || !/[gimsuy]/.test(c)) break;
            flags += c;
            i++;
          }
          if (regex) {
            columnValues.push({
              type: "term",
              value: regex,
              caseSensitive: !flags.includes("i"),
              patternType: "regex",
              regexFlags: flags,
              targetColumn,
            });
          }
        } else {
          // Parse regular value with optional anchors
          let colValue = "";
          let colPatternType: PatternType = "contains";
          let colHasStart = false;
          let colHasEnd = false;

          if (input[i] === "^") {
            colHasStart = true;
            i++;
          }

          while (i < len) {
            const c = input[i];
            // Stop at space, &, (, ), or | (pipe separates values within column)
            if (c === undefined || /[\s&()]/.test(c)) break;
            // | within column:val1|val2 context separates values
            if (c === "|") break;
            // $ anchor
            const afterC = input[i + 1];
            if (
              c === "$" &&
              (i + 1 >= len || afterC === undefined || /[\s|&()]/.test(afterC))
            ) {
              colHasEnd = true;
              i++;
              break;
            }
            colValue += c;
            i++;
          }

          if (colHasStart && colHasEnd) colPatternType = "exact";
          else if (colHasStart) colPatternType = "startsWith";
          else if (colHasEnd) colPatternType = "endsWith";

          if (colValue) {
            columnValues.push({
              type: "term",
              value: colValue,
              caseSensitive,
              patternType: colPatternType,
              targetColumn,
            });
          }
        }

        // Check for | to continue with more values
        if (i < len && input[i] === "|") {
          i++; // consume |
          continue;
        }
        break;
      }

      // Add tokens based on number of values
      if (columnValues.length === 1) {
        tokens.push(columnValues[0]!);
      } else if (columnValues.length > 1) {
        // Wrap multiple values in a group with OR
        tokens.push({
          type: "group",
          children: [
            {
              type: "or",
              children: columnValues,
            },
          ],
        });
      }
      continue;
    }

    // Regular term (may have ^ or $ anchors)
    let term = "";
    let patternType: PatternType = "contains";
    let hasStartAnchor = false;
    let hasEndAnchor = false;

    // Check for start anchor
    if (i < len && input[i] === "^") {
      hasStartAnchor = true;
      i++;
    }

    // Read term characters
    while (i < len) {
      const c = input[i];
      if (c === undefined || /[\s|&()"]/.test(c)) break;
      // Handle escape sequences: \: for literal colon, \| for literal pipe, etc.
      if (c === "\\" && i + 1 < len) {
        const escaped = input[i + 1];
        if (escaped && /[:|&()\\]/.test(escaped)) {
          term += escaped;
          i += 2;
          continue;
        }
      }
      // Check for end anchor (only if at end or followed by operator/space)
      const afterC = input[i + 1];
      if (
        c === "$" &&
        (i + 1 >= len || afterC === undefined || /[\s|&()]/.test(afterC))
      ) {
        hasEndAnchor = true;
        i++;
        break;
      }
      term += c;
      i++;
    }

    // Determine pattern type from anchors
    if (hasStartAnchor && hasEndAnchor) {
      patternType = "exact";
    } else if (hasStartAnchor) {
      patternType = "startsWith";
    } else if (hasEndAnchor) {
      patternType = "endsWith";
    }

    if (term) {
      tokens.push({
        type: "term",
        value: term,
        caseSensitive,
        patternType,
      });
    }
  }

  return tokens;
}

// ============================================================================
// Search Pattern Parser (tokens -> AST)
// ============================================================================

/**
 * Parse tokens into an AST with proper precedence:
 * 1. () grouping (highest)
 * 2. - NOT
 * 3. & / space AND
 * 4. | OR (lowest)
 */
export function parseSearchTokens(tokens: SearchToken[]): SearchToken | null {
  if (tokens.length === 0) return null;

  let pos = 0;

  function currentToken(): SearchToken | undefined {
    return tokens[pos];
  }

  function parseOr(): SearchToken | null {
    const left = parseAnd();
    if (!left) return null;

    const children: SearchToken[] = [left];
    while (pos < tokens.length && currentToken()?.type === "or") {
      pos++; // consume |
      const right = parseAnd();
      if (right) children.push(right);
    }

    if (children.length === 1) return children[0] ?? null;
    return { type: "or", children };
  }

  function parseAnd(): SearchToken | null {
    const left = parseNot();
    if (!left) return null;

    const children: SearchToken[] = [left];
    // AND is implicit (space) or explicit (&)
    while (pos < tokens.length) {
      const token = currentToken();
      if (!token) break;
      if (token.type === "and") {
        pos++; // consume &
      } else if (
        token.type === "term" ||
        token.type === "not" ||
        token.type === "lparen" ||
        token.type === "group"
      ) {
        // implicit AND - also allow pre-parsed groups
      } else {
        break;
      }
      const right = parseNot();
      if (right) children.push(right);
      else break;
    }

    if (children.length === 1) return children[0] ?? null;
    return { type: "and", children };
  }

  function parseNot(): SearchToken | null {
    const token = currentToken();
    if (pos < tokens.length && token?.type === "not") {
      pos++; // consume -
      const child = parsePrimary();
      if (child) {
        return { type: "not", children: [child] };
      }
      return null;
    }
    return parsePrimary();
  }

  function parsePrimary(): SearchToken | null {
    if (pos >= tokens.length) return null;

    const token = currentToken();
    if (!token) return null;

    if (token.type === "lparen") {
      pos++; // consume (
      const inner = parseOr();
      if (pos < tokens.length && currentToken()?.type === "rparen") {
        pos++; // consume )
      }
      if (inner) {
        return { type: "group", children: [inner] };
      }
      return null;
    }

    // Handle pre-parsed group tokens (from column:val1|val2 syntax)
    if (token.type === "group") {
      pos++;
      return token;
    }

    if (token.type === "term") {
      pos++;
      return token;
    }

    return null;
  }

  return parseOr();
}

// ============================================================================
// Search Validation
// ============================================================================

function countTokensInAst(node: SearchToken | null): {
  terms: number;
  regex: number;
} {
  if (!node) return { terms: 0, regex: 0 };

  if (node.type === "term") {
    return {
      terms: 1,
      regex: node.patternType === "regex" ? 1 : 0,
    };
  }

  if (node.children) {
    return node.children.reduce(
      (acc, child) => {
        const counts = countTokensInAst(child);
        return {
          terms: acc.terms + counts.terms,
          regex: acc.regex + counts.regex,
        };
      },
      { terms: 0, regex: 0 },
    );
  }

  return { terms: 0, regex: 0 };
}

function measureDepth(node: SearchToken | null, current: number = 0): number {
  if (!node) return current;

  if (node.type === "group" && node.children && node.children.length > 0) {
    return Math.max(...node.children.map((c) => measureDepth(c, current + 1)));
  }

  if (node.type === "group") {
    return current + 1;
  }

  if (node.children && node.children.length > 0) {
    return Math.max(...node.children.map((c) => measureDepth(c, current)));
  }

  return current;
}

export function validateSearchAst(
  ast: SearchToken | null,
  limits: SearchLimits = DEFAULT_SEARCH_LIMITS,
): SearchValidation {
  if (!ast) return { valid: true, termCount: 0, depth: 0, regexCount: 0 };

  const { terms, regex } = countTokensInAst(ast);
  const depth = measureDepth(ast);

  if (terms > limits.maxTerms) {
    return {
      valid: false,
      error: `Max ${limits.maxTerms} search terms allowed (found ${terms})`,
      termCount: terms,
      depth,
      regexCount: regex,
    };
  }

  if (depth > limits.maxGroupDepth) {
    return {
      valid: false,
      error: `Max nesting depth is ${limits.maxGroupDepth} (found ${depth})`,
      termCount: terms,
      depth,
      regexCount: regex,
    };
  }

  if (regex > limits.maxRegexPatterns) {
    return {
      valid: false,
      error: `Max ${limits.maxRegexPatterns} regex patterns allowed (found ${regex})`,
      termCount: terms,
      depth,
      regexCount: regex,
    };
  }

  return { valid: true, termCount: terms, depth, regexCount: regex };
}

// ============================================================================
// AST to FilterConfig conversion
// ============================================================================

function patternToOperatorAndValue(
  pattern: PatternType,
  value: string,
  caseSensitive: boolean,
): { operator: FilterOperator; value: string } {
  switch (pattern) {
    case "regex":
      return {
        operator: caseSensitive ? "REGEX" : "REGEX_I",
        value,
      };
    case "startsWith":
      return {
        operator: caseSensitive ? "LIKE" : "ILIKE",
        value: `${escapeWildcards(value)}%`,
      };
    case "endsWith":
      return {
        operator: caseSensitive ? "LIKE" : "ILIKE",
        value: `%${escapeWildcards(value)}`,
      };
    case "exact":
      return {
        operator: caseSensitive ? "LIKE" : "ILIKE",
        value: escapeWildcards(value),
      };
    case "contains":
    default:
      return {
        operator: caseSensitive ? "LIKE" : "ILIKE",
        value: `%${escapeWildcards(value)}%`,
      };
  }
}

/** Escape SQL LIKE wildcards, but preserve user wildcards (* and _) */
function escapeWildcards(value: string): string {
  // First escape actual SQL wildcards that user might have typed literally
  // Then convert user wildcards to SQL wildcards
  return value
    .replace(/\*/g, "%") // * -> %
    .replace(/_/g, "_"); // _ stays as _ (SQL single char wildcard)
}

/**
 * Simplified column info for filter parsing.
 * Uses a subset of ColumnMeta fields.
 */
export interface FilterColumnInfo {
  name: string;
  dataType: string;
  nullable?: boolean;
  enumValues?: string[];
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  foreignTable?: string;
  foreignColumn?: string;
}

/**
 * Convert schema ColumnMeta to FilterColumnInfo
 */
export function toFilterColumnInfo(col: ColumnMeta): FilterColumnInfo {
  return {
    name: col.name,
    dataType: col.db_type,
    nullable: col.nullable,
    enumValues: col.enum_values,
    isPrimaryKey: col.is_pk,
    isForeignKey: col.is_fk,
  };
}

export interface ParseResult {
  success: boolean;
  filter?: FilterConfig;
  error?: string;
}

function isTextType(dataType: string): boolean {
  const textTypes = [
    "text",
    "varchar",
    "char",
    "character",
    "string",
    "nvarchar",
    "nchar",
    "ntext",
    "citext",
  ];
  return textTypes.some((t) => dataType.toLowerCase().includes(t));
}

// For simple search, we want to search across most column types
// Exclude only binary/blob types that can't be meaningfully searched
function isSearchableType(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  const unsearchable = [
    "bytea",
    "blob",
    "binary",
    "varbinary",
    "image",
    "geometry",
    "geography",
  ];
  return !unsearchable.some((t) => lower.includes(t));
}

/** Result of parsing a search query */
export interface SearchParseResult {
  success: boolean;
  filter?: FilterConfig;
  error?: string;
  validation?: SearchValidation;
}

// LRU cache for parsed search results (performance optimization)
const PARSE_CACHE_SIZE = 50;
const parseCache = new Map<string, SearchParseResult>();

// ID counter for filter conditions (avoids string concatenation)
let idCounter = 0;
function nextId(): string {
  return `f${++idCounter}`;
}

function getCacheKey(text: string, columnNames: string[]): string {
  return `${text}|${columnNames.join(",")}`;
}

function getCachedResult(key: string): SearchParseResult | undefined {
  const result = parseCache.get(key);
  if (result) {
    // Move to end (most recently used)
    parseCache.delete(key);
    parseCache.set(key, result);
  }
  return result;
}

function setCachedResult(key: string, result: SearchParseResult): void {
  // Evict oldest if at capacity
  if (parseCache.size >= PARSE_CACHE_SIZE) {
    const firstKey = parseCache.keys().next().value;
    if (firstKey) parseCache.delete(firstKey);
  }
  parseCache.set(key, result);
}

/** Clear parse cache (useful for testing) */
export function clearParseCache(): void {
  parseCache.clear();
}

/**
 * Parse a search query with pattern support.
 * Supports: wildcards (*, _), anchors (^, $), regex (/pattern/), boolean (|, &, -), grouping (())
 */
export function parseSimpleSearch(
  text: string,
  columns: FilterColumnInfo[],
  limits: SearchLimits = DEFAULT_SEARCH_LIMITS,
): FilterConfig {
  const result = parseSearchQuery(text, columns, limits);
  return result.filter ?? createEmptyFilter();
}

/**
 * Parse a search query with full result including validation.
 * Results are cached for performance.
 */
export function parseSearchQuery(
  text: string,
  columns: FilterColumnInfo[],
  limits: SearchLimits = DEFAULT_SEARCH_LIMITS,
): SearchParseResult {
  const searchValue = text.trim();
  if (!searchValue) {
    return { success: true, filter: createEmptyFilter() };
  }

  // Search across all searchable columns (exclude binary/blob types)
  const searchableColumns = columns.filter((c) => isSearchableType(c.dataType));
  if (searchableColumns.length === 0) {
    return { success: true, filter: createEmptyFilter() };
  }

  // Check cache first
  const cacheKey = getCacheKey(
    searchValue,
    searchableColumns.map((c) => c.name),
  );
  const cached = getCachedResult(cacheKey);
  if (cached) {
    return cached;
  }

  // Tokenize and parse
  const tokens = tokenizeSearch(searchValue);
  if (tokens.length === 0) {
    const result: SearchParseResult = {
      success: true,
      filter: createEmptyFilter(),
    };
    setCachedResult(cacheKey, result);
    return result;
  }

  const ast = parseSearchTokens(tokens);
  if (!ast) {
    return { success: false, error: "Invalid search query syntax" };
  }

  // Validate limits
  const validation = validateSearchAst(ast, limits);
  if (!validation.valid) {
    return { success: false, error: validation.error, validation };
  }

  // Convert AST to FilterConfig
  const filter = astToFilterConfig(ast, searchableColumns);

  const result: SearchParseResult = { success: true, filter, validation };
  setCachedResult(cacheKey, result);
  return result;
}

/**
 * Convert a search AST to FilterConfig
 */
function astToFilterConfig(
  ast: SearchToken,
  columns: FilterColumnInfo[],
): FilterConfig {
  const root = astNodeToFilterGroup(ast, columns);
  return { root };
}

/**
 * Convert an AST node to a FilterGroup or set of conditions
 */
function astNodeToFilterGroup(
  node: SearchToken,
  columns: FilterColumnInfo[],
): FilterGroup {
  switch (node.type) {
    case "term":
      return termToFilterGroup(node, columns);

    case "and":
      return {
        id: nextId(),
        type: "group",
        logical: "AND",
        conditions:
          node.children?.map((child) => astNodeToFilterGroup(child, columns)) ??
          [],
      };

    case "or":
      return {
        id: nextId(),
        type: "group",
        logical: "OR",
        conditions:
          node.children?.map((child) => astNodeToFilterGroup(child, columns)) ??
          [],
      };

    case "not":
      if (node.children?.[0]) {
        const innerGroup = astNodeToFilterGroup(node.children[0], columns);
        // Mark all conditions in this group as negated
        markGroupNegated(innerGroup);
        return innerGroup;
      }
      return createEmptyGroup();

    case "group":
      if (node.children?.[0]) {
        return astNodeToFilterGroup(node.children[0], columns);
      }
      return createEmptyGroup();

    default:
      return createEmptyGroup();
  }
}

/**
 * Convert a term token to a FilterGroup that searches columns
 * If targetColumn is set, only search that column; otherwise search all columns
 */
function termToFilterGroup(
  term: SearchToken,
  columns: FilterColumnInfo[],
): FilterGroup {
  const { operator, value } = patternToOperatorAndValue(
    term.patternType ?? "contains",
    term.value ?? "",
    term.caseSensitive ?? false,
  );

  // If targeting a specific column, only create condition for that column
  if (term.targetColumn) {
    const targetCol = columns.find(
      (c) => c.name.toLowerCase() === term.targetColumn!.toLowerCase(),
    );

    if (targetCol) {
      return {
        id: nextId(),
        type: "group",
        logical: "OR",
        conditions: [
          {
            id: nextId(),
            column: targetCol.name,
            operator,
            value,
            castToText: !isTextType(targetCol.dataType),
          },
        ],
      };
    }
    // Column not found - return empty (will match nothing)
    return createEmptyGroup();
  }

  // No target column - search across all searchable columns
  const conditions: FilterCondition[] = columns.map((col) => ({
    id: nextId(),
    column: col.name,
    operator,
    value,
    castToText: !isTextType(col.dataType),
  }));

  return {
    id: nextId(),
    type: "group",
    logical: "OR",
    conditions,
  };
}

/**
 * Mark all conditions in a group as negated (for NOT handling)
 */
function markGroupNegated(group: FilterGroup): void {
  for (const condition of group.conditions) {
    if ("type" in condition && condition.type === "group") {
      markGroupNegated(condition);
    } else {
      (condition as FilterCondition).negated = true;
    }
  }
}

function createEmptyGroup(): FilterGroup {
  return { id: nextId(), type: "group", logical: "AND", conditions: [] };
}

export function parseWhereClause(
  whereExpr: string,
  _columns: FilterColumnInfo[],
): ParseResult {
  let expr = whereExpr.trim();

  // Safety: always strip mode prefixes if present
  if (expr.startsWith("?") || expr.startsWith("#") || expr.startsWith("!")) {
    expr = expr.slice(1).trim();
  }

  if (!expr) {
    return { success: true, filter: undefined };
  }

  // Basic syntax validation only - let database handle complex validation
  const syntaxError = validateBasicSyntax(expr);
  if (syntaxError) {
    return { success: false, error: syntaxError };
  }

  // Return raw clause - database will validate column names and SQL syntax
  return {
    success: true,
    filter: {
      root: {
        id: "root",
        type: "group",
        logical: "AND",
        conditions: [],
      },
      rawWhereClause: expr,
    },
  };
}

// Basic syntax validation - just catch obvious errors
function validateBasicSyntax(clause: string): string | null {
  // Check balanced parentheses
  let depth = 0;
  for (const char of clause) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (depth < 0) return "Unbalanced parentheses";
  }
  if (depth !== 0) return "Unbalanced parentheses";

  // Check balanced quotes
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < clause.length; i++) {
    const char = clause[i];
    const prevChar = i > 0 ? clause[i - 1] : "";

    if (char === "'" && prevChar !== "\\" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && prevChar !== "\\" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    }
  }
  if (inSingleQuote) return "Unclosed single quote";
  if (inDoubleQuote) return "Unclosed double quote";

  // Check has comparison operator
  const hasOperator = /[=<>!]|(?:LIKE|ILIKE|IN|IS|BETWEEN)\b/i.test(clause);
  if (!hasOperator) {
    return "Missing comparison operator";
  }

  return null;
}

export function sanitizeInput(input: string, mode: FilterMode): string {
  let sanitized = input.trim();

  // Handle escape sequences first: \? \# \! become literal characters
  if (sanitized.startsWith("\\")) {
    // Remove the backslash, keep the escaped character
    sanitized = sanitized.slice(1);
    return sanitized;
  }

  // Always strip mode prefixes based on current mode
  switch (mode) {
    case "where":
      if (sanitized.startsWith("?")) {
        sanitized = sanitized.slice(1).trim();
      }
      break;
    case "ai":
      if (sanitized.startsWith("#")) {
        sanitized = sanitized.slice(1).trim();
      }
      break;
    case "search":
      if (sanitized.startsWith("!")) {
        sanitized = sanitized.slice(1).trim();
      }
      break;
  }

  // Safety: strip any remaining mode prefixes
  if (
    sanitized.startsWith("?") ||
    sanitized.startsWith("#") ||
    sanitized.startsWith("!")
  ) {
    sanitized = sanitized.slice(1).trim();
  }

  return sanitized;
}

function createEmptyFilter(): FilterConfig {
  return {
    root: {
      id: "root",
      type: "group",
      logical: "AND",
      conditions: [],
    },
  };
}

export function detectFilterMode(input: string): FilterMode {
  const trimmed = input.trim();
  // Support escape sequences: \? \# \! to search literal characters
  if (trimmed.startsWith("\\")) return "search";
  if (trimmed.startsWith("#")) return "ai";
  if (trimmed.startsWith("?")) return "where";
  return "search";
}
