/**
 * Web Worker for SQL Linting
 *
 * Runs expensive linting operations off the main thread to prevent UI blocking.
 * Handles syntax validation, keyword suggestions, and dialect-specific checks.
 */

// Message types for worker communication
export interface LinterWorkerRequest {
  id: number;
  type: 'lint';
  payload: {
    content: string;
    dialect?: string;
    viewportStart?: number;
    viewportEnd?: number;
  };
}

export interface LinterWorkerResponse {
  id: number;
  type: 'result' | 'error';
  payload: {
    diagnostics?: WorkerDiagnostic[];
    error?: string;
  };
}

export interface WorkerDiagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  actions?: Array<{
    name: string;
    replacement: string;
  }>;
}

// SQL Keywords for typo detection
const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET",
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "ON", "INSERT", "UPDATE",
  "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE", "VALUES", "RETURNING",
  "WITH", "DISTINCT", "UNION", "EXCEPT", "INTERSECT", "AND", "OR", "NOT",
  "NULL", "IS", "IN", "LIKE", "BETWEEN", "AS", "CASE", "WHEN", "THEN", "ELSE", "END"
];

const KEYWORD_SET = new Set(SQL_KEYWORDS);

// Optimized Levenshtein with early termination
const levenshteinOptimized = (a: string, b: string, maxDistance: number = 2): number => {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

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
    let rowMin = Infinity;

    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        currentRow[j] = matrix[i - 1]?.[j - 1] ?? 0;
      } else {
        const substitution = (matrix[i - 1]?.[j - 1] ?? 0) + 1;
        const insertion = (currentRow[j - 1] ?? 0) + 1;
        const deletion = (matrix[i - 1]?.[j] ?? 0) + 1;
        currentRow[j] = Math.min(substitution, insertion, deletion);
      }
      rowMin = Math.min(rowMin, currentRow[j] ?? Infinity);
    }

    // Early termination if all values in row exceed maxDistance
    if (rowMin > maxDistance) return maxDistance + 1;
  }

  return matrix[b.length]?.[a.length] ?? maxDistance + 1;
};

// Suggest keyword only for likely typos
const suggestKeyword = (identifier: string): string | null => {
  // Only check uppercase identifiers that look like keywords
  if (!identifier || identifier.length < 3 || identifier.length > 15) return null;
  if (identifier !== identifier.toUpperCase()) return null;
  if (!/^[A-Z_]+$/.test(identifier)) return null;
  if (KEYWORD_SET.has(identifier)) return null;

  let best: { keyword: string; distance: number } | null = null;

  for (const keyword of SQL_KEYWORDS) {
    // Skip if first char doesn't match or length difference > 2
    if (identifier[0] !== keyword[0]) continue;
    if (Math.abs(identifier.length - keyword.length) > 2) continue;

    const distance = levenshteinOptimized(identifier, keyword, 1);
    if (distance > 1) continue;

    if (!best || distance < best.distance) {
      best = { keyword, distance };
      if (distance === 0) break;
    }
  }

  return best?.keyword ?? null;
};

// Token types from simple lexer
type TokenType = 'keyword' | 'identifier' | 'string' | 'comment' | 'operator' | 'number' | 'punctuation';

interface Token {
  type: TokenType;
  value: string;
  from: number;
  to: number;
}

// Simple SQL lexer for worker (no AST dependency)
const tokenize = (content: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;

  while (i < content.length) {
    const char = content[i] || '';

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Line comment
    if (char === '-' && content[i + 1] === '-') {
      const start = i;
      while (i < content.length && content[i] !== '\n') i++;
      tokens.push({ type: 'comment', value: content.slice(start, i), from: start, to: i });
      continue;
    }

    // Block comment
    if (char === '/' && content[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) i++;
      i += 2;
      tokens.push({ type: 'comment', value: content.slice(start, i), from: start, to: i });
      continue;
    }

    // String literals
    if (char === "'" || char === '"') {
      const quote = char;
      const start = i;
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i++;
        i++;
      }
      i++;
      tokens.push({ type: 'string', value: content.slice(start, i), from: start, to: i });
      continue;
    }

    // Dollar quotes (PostgreSQL)
    if (char === '$') {
      const start = i;
      const tagMatch = content.slice(i).match(/^\$(\w*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        i += tag.length;
        const endTag = content.indexOf(tag, i);
        if (endTag !== -1) {
          i = endTag + tag.length;
        } else {
          i = content.length;
        }
        tokens.push({ type: 'string', value: content.slice(start, i), from: start, to: i });
        continue;
      }
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      const start = i;
      while (i < content.length && /[a-zA-Z0-9_]/.test(content[i] || '')) i++;
      const value = content.slice(start, i);
      const upper = value.toUpperCase();
      const type = KEYWORD_SET.has(upper) ? 'keyword' : 'identifier';
      tokens.push({ type, value, from: start, to: i });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(char)) {
      const start = i;
      while (i < content.length && /[0-9.]/.test(content[i] || '')) i++;
      tokens.push({ type: 'number', value: content.slice(start, i), from: start, to: i });
      continue;
    }

    // Operators and punctuation
    const start = i;
    i++;
    tokens.push({ type: 'punctuation', value: char || '', from: start, to: i });
  }

  return tokens;
};

// Dialect-specific validation
const validateDialect = (content: string, dialect: string): WorkerDiagnostic[] => {
  const diagnostics: WorkerDiagnostic[] = [];

  if (dialect === 'postgresql') {
    // Check for unmatched dollar quotes - optimized version
    const dollarQuoteRegex = /\$(\w*)\$/g;
    const quotes: Array<{ tag: string; pos: number; length: number }> = [];
    let match;

    while ((match = dollarQuoteRegex.exec(content)) !== null) {
      quotes.push({
        tag: match[1] || '',
        pos: match.index,
        length: match[0].length
      });
    }

    // Check for matching pairs
    const tagCounts = new Map<string, number>();
    for (const quote of quotes) {
      tagCounts.set(quote.tag, (tagCounts.get(quote.tag) || 0) + 1);
    }

    // Report unmatched (odd count means unmatched)
    for (const [tag, count] of tagCounts.entries()) {
      if (count % 2 !== 0) {
        const quote = quotes.find(q => q.tag === tag);
        if (quote) {
          diagnostics.push({
            from: quote.pos,
            to: quote.pos + quote.length,
            severity: 'error',
            message: `Unmatched dollar quote $${tag}$`
          });
        }
      }
    }
  }

  return diagnostics;
};

// Main lint function
const lint = (
  content: string,
  dialect: string = 'postgresql',
  viewportStart?: number,
  _viewportEnd?: number
): WorkerDiagnostic[] => {
  const diagnostics: WorkerDiagnostic[] = [];

  // Skip if content is too large without viewport
  const MAX_FULL_SCAN = 100000; // 100KB
  if (content.length > MAX_FULL_SCAN && viewportStart === undefined) {
    // Only scan first chunk for very large files
    content = content.slice(0, MAX_FULL_SCAN);
  }

  // Tokenize the content
  const tokens = tokenize(content);

  // Check identifiers for typos
  for (const token of tokens) {
    if (token.type === 'identifier') {
      const suggestion = suggestKeyword(token.value);
      if (suggestion) {
        diagnostics.push({
          from: token.from,
          to: token.to,
          severity: 'warning',
          message: `Unknown keyword "${token.value}". Did you mean "${suggestion}"?`,
          actions: [{
            name: `Replace with ${suggestion}`,
            replacement: suggestion
          }]
        });
      }
    }
  }

  // Dialect-specific validation
  diagnostics.push(...validateDialect(content, dialect));

  // Deduplicate
  const seen = new Set<string>();
  return diagnostics.filter(d => {
    const key = `${d.from}-${d.to}-${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Worker message handler
self.onmessage = (event: MessageEvent<LinterWorkerRequest>) => {
  const { id, type, payload } = event.data;

  if (type === 'lint') {
    try {
      const diagnostics = lint(
        payload.content,
        payload.dialect,
        payload.viewportStart,
        payload.viewportEnd
      );

      const response: LinterWorkerResponse = {
        id,
        type: 'result',
        payload: { diagnostics }
      };

      self.postMessage(response);
    } catch (error) {
      const response: LinterWorkerResponse = {
        id,
        type: 'error',
        payload: { error: error instanceof Error ? error.message : 'Unknown error' }
      };

      self.postMessage(response);
    }
  }
};

// Export types for TypeScript
export {};
