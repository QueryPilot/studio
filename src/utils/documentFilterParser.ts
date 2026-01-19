/**
 * Document Filter Parser
 *
 * Parses filter expressions for MongoDB documents.
 * Supports:
 * - JSON query syntax: { status: "active" }
 * - Simple syntax: status = "active", age > 18
 * - Search mode: text search across fields (client-side)
 */

// ============================================================================
// Types
// ============================================================================

export type DocumentFilterMode = 'search' | 'query';

export interface DocumentFilter {
  mode: DocumentFilterMode;
  /** Search text for client-side filtering */
  searchText?: string;
  /** MongoDB query object for server-side filtering */
  mongoQuery?: Record<string, unknown>;
  /** Human-readable description of the filter */
  description?: string;
}

export interface DocumentFilterParseResult {
  success: boolean;
  filter?: DocumentFilter;
  error?: string;
}

// ============================================================================
// MongoDB Query Parser
// ============================================================================

/**
 * Parse a filter string into a DocumentFilter.
 *
 * Syntax:
 * - JSON query: ?{ status: "active" } or ?{ age: { $gt: 18 } }
 * - Simple query: ?status = "active" or ?age > 18
 * - Search: any text without ? prefix
 */
export function parseDocumentFilter(input: string): DocumentFilterParseResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { success: true, filter: undefined };
  }

  // Check for query mode prefix
  if (trimmed.startsWith('?')) {
    const queryPart = trimmed.slice(1).trim();

    if (!queryPart) {
      return { success: true, filter: undefined };
    }

    // Try JSON query first
    if (queryPart.startsWith('{')) {
      return parseJsonQuery(queryPart);
    }

    // Try simple query syntax
    return parseSimpleQuery(queryPart);
  }

  // Search mode (client-side)
  return {
    success: true,
    filter: {
      mode: 'search',
      searchText: trimmed,
      description: `Search: "${trimmed}"`,
    },
  };
}

/**
 * Parse JSON MongoDB query syntax.
 * Example: { status: "active", age: { $gt: 18 } }
 */
function parseJsonQuery(queryStr: string): DocumentFilterParseResult {
  try {
    // Handle MongoDB-style queries with unquoted field names
    // Convert: { status: "active" } to valid JSON
    const jsonStr = convertToValidJson(queryStr);
    const query = JSON.parse(jsonStr);

    if (typeof query !== 'object' || query === null || Array.isArray(query)) {
      return { success: false, error: 'Query must be an object' };
    }

    return {
      success: true,
      filter: {
        mode: 'query',
        mongoQuery: query as Record<string, unknown>,
        description: `Query: ${queryStr}`,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Invalid JSON query: ${err instanceof Error ? err.message : 'Parse error'}`,
    };
  }
}

/**
 * Convert MongoDB-style query to valid JSON.
 * Handles unquoted field names and $operators.
 */
function convertToValidJson(input: string): string {
  // Replace unquoted keys with quoted keys
  // Matches: { key: or , key: or $key:
  // But not already quoted keys: "key":
  return input.replace(
    /([{,]\s*)(\$?[a-zA-Z_][a-zA-Z0-9_.]*)(\s*:)/g,
    '$1"$2"$3'
  );
}

/**
 * Parse simple query syntax into MongoDB query.
 *
 * Supported operators:
 * - = (equals): status = "active" → { status: "active" }
 * - != (not equals): status != "deleted" → { status: { $ne: "deleted" } }
 * - > (greater than): age > 18 → { age: { $gt: 18 } }
 * - >= (greater or equal): age >= 18 → { age: { $gte: 18 } }
 * - < (less than): age < 65 → { age: { $lt: 65 } }
 * - <= (less or equal): age <= 65 → { age: { $lte: 65 } }
 * - LIKE (pattern match): name LIKE "john%" → { name: { $regex: "^john", $options: "i" } }
 * - IN: status IN ("active", "pending") → { status: { $in: ["active", "pending"] } }
 * - IS NULL: deletedAt IS NULL → { deletedAt: null }
 * - IS NOT NULL: email IS NOT NULL → { email: { $ne: null } }
 * - AND: status = "active" AND age > 18 → { $and: [...] }
 * - OR: status = "active" OR status = "pending" → { $or: [...] }
 */
function parseSimpleQuery(queryStr: string): DocumentFilterParseResult {
  try {
    const query = parseExpression(queryStr.trim());
    return {
      success: true,
      filter: {
        mode: 'query',
        mongoQuery: query,
        description: `Query: ${queryStr}`,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Parse error',
    };
  }
}

/**
 * Parse a query expression (handles AND/OR)
 */
function parseExpression(expr: string): Record<string, unknown> {
  // Check for OR (lower precedence)
  const orParts = splitByOperator(expr, ' OR ');
  if (orParts.length > 1) {
    return {
      $or: orParts.map(part => parseExpression(part.trim())),
    };
  }

  // Check for AND
  const andParts = splitByOperator(expr, ' AND ');
  if (andParts.length > 1) {
    return {
      $and: andParts.map(part => parseExpression(part.trim())),
    };
  }

  // Single condition
  return parseCondition(expr);
}

/**
 * Split by operator, respecting parentheses and quotes
 */
function splitByOperator(expr: string, operator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inQuote = false;
  let quoteChar = '';
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    // Handle quotes
    if ((char === '"' || char === "'") && (i === 0 || expr[i - 1] !== '\\')) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
      }
    }

    // Handle parentheses
    if (!inQuote) {
      if (char === '(' || char === '[') depth++;
      if (char === ')' || char === ']') depth--;
    }

    // Check for operator
    if (depth === 0 && !inQuote) {
      const remaining = expr.slice(i).toUpperCase();
      if (remaining.startsWith(operator.toUpperCase())) {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = '';
        i += operator.length;
        continue;
      }
    }

    current += char;
    i++;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Parse a single condition (field operator value)
 */
function parseCondition(condition: string): Record<string, unknown> {
  const trimmed = condition.trim();

  // Handle parentheses
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return parseExpression(trimmed.slice(1, -1));
  }

  // IS NULL / IS NOT NULL
  const isNullMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s+IS\s+(NOT\s+)?NULL$/i);
  if (isNullMatch) {
    const field = isNullMatch[1];
    const isNotNull = !!isNullMatch[2];
    return { [field!]: isNotNull ? { $ne: null } : null };
  }

  // IN operator: field IN (value1, value2)
  const inMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s+(NOT\s+)?IN\s*\((.+)\)$/i);
  if (inMatch) {
    const field = inMatch[1];
    const notIn = !!inMatch[2];
    const valuesStr = inMatch[3];
    const values = parseInValues(valuesStr!);
    return { [field!]: notIn ? { $nin: values } : { $in: values } };
  }

  // LIKE operator: field LIKE "pattern"
  const likeMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s+(NOT\s+)?LIKE\s+["'](.+)["']$/i);
  if (likeMatch) {
    const field = likeMatch[1];
    const notLike = !!likeMatch[2];
    const pattern = likeMatch[3];
    const regex = likePatternToRegex(pattern!);
    const condition = { $regex: regex, $options: 'i' };
    return { [field!]: notLike ? { $not: condition } : condition };
  }

  // Comparison operators: =, !=, <, <=, >, >=
  const compMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s*(!=|<>|<=|>=|<|>|=)\s*(.+)$/);
  if (compMatch) {
    const field = compMatch[1];
    const op = compMatch[2];
    const valueStr = compMatch[3]!.trim();
    const value = parseValue(valueStr);

    switch (op) {
      case '=':
        return { [field!]: value };
      case '!=':
      case '<>':
        return { [field!]: { $ne: value } };
      case '>':
        return { [field!]: { $gt: value } };
      case '>=':
        return { [field!]: { $gte: value } };
      case '<':
        return { [field!]: { $lt: value } };
      case '<=':
        return { [field!]: { $lte: value } };
    }
  }

  throw new Error(`Invalid condition: ${condition}`);
}

/**
 * Parse IN clause values: ("a", "b", 1, true)
 */
function parseInValues(valuesStr: string): unknown[] {
  const values: unknown[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];

    if ((char === '"' || char === "'") && (i === 0 || valuesStr[i - 1] !== '\\')) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
      }
      current += char;
    } else if (char === ',' && !inQuote) {
      if (current.trim()) {
        values.push(parseValue(current.trim()));
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    values.push(parseValue(current.trim()));
  }

  return values;
}

/**
 * Parse a value (string, number, boolean, null)
 */
function parseValue(valueStr: string): unknown {
  const trimmed = valueStr.trim();

  // Quoted string
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\(['"])/g, '$1');
  }

  // Boolean
  if (trimmed.toLowerCase() === 'true') return true;
  if (trimmed.toLowerCase() === 'false') return false;

  // Null
  if (trimmed.toLowerCase() === 'null') return null;

  // Number
  const num = Number(trimmed);
  if (!isNaN(num)) return num;

  // Unquoted string (field reference or literal)
  return trimmed;
}

/**
 * Convert SQL LIKE pattern to regex.
 * % -> .* (match any characters)
 * _ -> . (match single character)
 */
function likePatternToRegex(pattern: string): string {
  // Escape regex special characters except % and _
  let regex = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Convert LIKE wildcards to regex
  regex = regex.replace(/%/g, '.*');
  regex = regex.replace(/_/g, '.');
  // Anchor if no leading wildcard
  if (!pattern.startsWith('%')) {
    regex = '^' + regex;
  }
  // Anchor if no trailing wildcard
  if (!pattern.endsWith('%')) {
    regex = regex + '$';
  }
  return regex;
}

// ============================================================================
// Client-Side Search Filter
// ============================================================================

/**
 * Apply a search filter to documents (client-side).
 * Searches across all string fields.
 */
export function applyDocumentSearch<T extends Record<string, unknown>>(
  documents: T[],
  searchText: string
): T[] {
  if (!searchText.trim()) {
    return documents;
  }

  const searchLower = searchText.toLowerCase();
  const terms = searchLower.split(/\s+/).filter(Boolean);

  return documents.filter(doc => {
    // Check if any term matches any field value
    return terms.every(term => {
      return Object.values(doc).some(value => {
        if (value === null || value === undefined) return false;
        const strValue = typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
        return strValue.toLowerCase().includes(term);
      });
    });
  });
}

/**
 * Apply column-specific search filter.
 * Supports column:value syntax.
 */
export function applyDocumentColumnSearch<T extends Record<string, unknown>>(
  documents: T[],
  searchText: string
): T[] {
  if (!searchText.trim()) {
    return documents;
  }

  // Parse column:value patterns
  const patterns = parseSearchPatterns(searchText);

  return documents.filter(doc => {
    return patterns.every(pattern => {
      if (pattern.column) {
        // Column-specific search
        const value = getNestedValue(doc, pattern.column);
        return matchValue(value, pattern.term, pattern.negate);
      } else {
        // Global search across all fields
        const matches = Object.values(doc).some(value => {
          return matchValue(value, pattern.term, false);
        });
        return pattern.negate ? !matches : matches;
      }
    });
  });
}

interface SearchPattern {
  column?: string;
  term: string;
  negate: boolean;
}

function parseSearchPatterns(searchText: string): SearchPattern[] {
  const patterns: SearchPattern[] = [];
  const parts = searchText.split(/\s+/);

  for (const part of parts) {
    if (!part) continue;

    let negate = false;
    let term = part;

    if (term.startsWith('-')) {
      negate = true;
      term = term.slice(1);
    }

    const colonIndex = term.indexOf(':');
    if (colonIndex > 0 && colonIndex < term.length - 1) {
      patterns.push({
        column: term.slice(0, colonIndex),
        term: term.slice(colonIndex + 1),
        negate,
      });
    } else {
      patterns.push({ term, negate });
    }
  }

  return patterns;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function matchValue(value: unknown, term: string, negate: boolean): boolean {
  if (value === null || value === undefined) {
    return negate;
  }

  const strValue = typeof value === 'object'
    ? JSON.stringify(value)
    : String(value);

  const matches = strValue.toLowerCase().includes(term.toLowerCase());
  return negate ? !matches : matches;
}
