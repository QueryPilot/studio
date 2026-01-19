/**
 * KeyValue (Redis) Filter Parser
 *
 * Parses filter expressions for Redis key-value data.
 * Supports:
 * - Search mode: text search across fields/values (client-side)
 * - Pattern mode: Redis wildcards (* and ?) for field/member names
 *
 * Note: Query mode and AI mode are NOT supported for Redis since
 * Redis is a key-value store without a query language.
 */

// ============================================================================
// Types
// ============================================================================

export type KeyValueFilterMode = 'search' | 'pattern';

export interface KeyValueFilter {
  mode: KeyValueFilterMode;
  /** Search text for client-side filtering */
  searchText?: string;
  /** Pattern with wildcards (* or ?) for field/member name matching */
  pattern?: string;
  /** Human-readable description */
  description?: string;
}

export interface KeyValueFilterParseResult {
  success: boolean;
  filter?: KeyValueFilter;
  error?: string;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse a filter string for Redis data.
 *
 * Syntax:
 * - Pattern: user:* or field* (wildcards * and ? for field/member names)
 * - Search: any text without wildcards (searches across all values)
 *
 * Note: Query mode (?) and AI mode (#) are not supported for Redis.
 */
export function parseKeyValueFilter(input: string): KeyValueFilterParseResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { success: true, filter: undefined };
  }

  // Pattern mode: contains * or ? wildcards
  if (containsWildcard(trimmed)) {
    return {
      success: true,
      filter: {
        mode: 'pattern',
        pattern: trimmed,
        description: `Pattern: ${trimmed}`,
      },
    };
  }

  // Search mode (client-side text search)
  return {
    success: true,
    filter: {
      mode: 'search',
      searchText: trimmed,
      description: `Search: "${trimmed}"`,
    },
  };
}

function containsWildcard(str: string): boolean {
  // Check for Redis pattern wildcards: * and ?
  // But not if they're inside quotes
  let inQuote = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' || char === "'") {
      inQuote = !inQuote;
    }
    if (!inQuote && (char === '*' || char === '?')) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Client-Side Search Filter
// ============================================================================

/**
 * Filter row data by search text (client-side).
 * Works for all Redis types.
 */
export function applyKeyValueSearch<T extends Record<string, unknown>>(
  rows: T[],
  searchText: string
): T[] {
  if (!searchText.trim()) {
    return rows;
  }

  const searchLower = searchText.toLowerCase();
  const terms = searchLower.split(/\s+/).filter(Boolean);

  return rows.filter(row => {
    return terms.every(term => {
      // Check if term has column prefix (e.g., field:value)
      const colonIndex = term.indexOf(':');
      if (colonIndex > 0 && colonIndex < term.length - 1) {
        const columnName = term.slice(0, colonIndex);
        const searchValue = term.slice(colonIndex + 1);
        return matchRowField(row, columnName, searchValue);
      }

      // Global search across all fields
      return Object.values(row).some(cellValue => {
        const value = extractCellValue(cellValue);
        return matchValueContains(value, term);
      });
    });
  });
}

/**
 * Filter rows by pattern matching (for field names).
 * Pattern supports * (any chars) and ? (single char).
 */
export function applyKeyValuePattern<T extends Record<string, unknown>>(
  rows: T[],
  pattern: string,
  fieldColumn: string = 'col_0' // Usually the first column (field/member)
): T[] {
  if (!pattern || pattern === '*') {
    return rows;
  }

  const regex = patternToRegex(pattern);

  return rows.filter(row => {
    const cellValue = row[fieldColumn];
    const value = extractCellValue(cellValue);
    if (typeof value !== 'string') return false;
    return regex.test(value);
  });
}

// ============================================================================
// Helpers
// ============================================================================

function extractCellValue(cellValue: unknown): unknown {
  if (cellValue && typeof cellValue === 'object' && 'value' in cellValue) {
    return (cellValue as { value: unknown }).value;
  }
  return cellValue;
}

function matchRowField(
  row: Record<string, unknown>,
  columnName: string,
  searchValue: string
): boolean {
  // Try to find the column by name in the row
  for (const [key, cellValue] of Object.entries(row)) {
    // Check if key matches column name pattern
    if (key.toLowerCase().includes(columnName.toLowerCase())) {
      const value = extractCellValue(cellValue);
      if (matchValueContains(value, searchValue)) {
        return true;
      }
    }
  }

  // Also check if any cell contains a field name matching columnName
  // (for hash type where field name is in the value)
  return Object.values(row).some(cellValue => {
    const value = extractCellValue(cellValue);
    if (typeof value === 'string' && value.toLowerCase() === columnName.toLowerCase()) {
      return true;
    }
    return false;
  });
}

function matchValueContains(value: unknown, term: string): boolean {
  if (value === null || value === undefined) return false;

  const strValue = typeof value === 'object'
    ? JSON.stringify(value)
    : String(value);

  return strValue.toLowerCase().includes(term.toLowerCase());
}

/**
 * Convert Redis pattern to regex.
 * * -> .* (any characters)
 * ? -> . (single character)
 * [ ] -> character class
 */
function patternToRegex(pattern: string): RegExp {
  let regex = pattern
    // Escape regex special chars (except * ? [ ])
    .replace(/[.+^${}()|\\]/g, '\\$&')
    // Convert Redis wildcards
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  // Anchor the pattern
  regex = '^' + regex + '$';

  return new RegExp(regex, 'i');
}
