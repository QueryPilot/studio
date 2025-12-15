/**
 * SQL Statement Parser Utility
 * 
 * Parses SQL text into individual statements for multi-query execution.
 * Handles semicolon delimiters while respecting strings, comments, and dollar-quoted blocks.
 */

export interface ParsedStatement {
  /** The SQL text (trimmed, without trailing semicolon) */
  text: string;
  /** Original position in the source text */
  offset: number;
  /** Statement index (0-based) */
  index: number;
}

/**
 * Parse SQL text into individual statements.
 * Splits on semicolons while respecting:
 * - Single-quoted strings ('...')
 * - Double-quoted identifiers ("...")
 * - Line comments (-- ...)
 * - Block comments (/* ... *\/)
 * - Dollar-quoted strings ($$...$$, $tag$...$tag$)
 */
export function parseSqlStatements(sql: string): ParsedStatement[] {
  const statements: ParsedStatement[] = [];
  let currentStatement = "";
  let currentOffset = 0;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    // Handle line comments: -- ...\n
    if (char === "-" && nextChar === "-") {
      const commentStart = i;
      i += 2;
      // Skip until newline
      while (i < sql.length && sql[i] !== "\n") {
        i++;
      }
      currentStatement += sql.substring(commentStart, i + 1);
      i++;
      continue;
    }

    // Handle block comments: /* ... */
    if (char === "/" && nextChar === "*") {
      const commentStart = i;
      i += 2;
      // Skip until */
      while (i < sql.length - 1) {
        if (sql[i] === "*" && sql[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      currentStatement += sql.substring(commentStart, i);
      continue;
    }

    // Handle single-quoted strings: '...'
    if (char === "'") {
      const stringStart = i;
      i++;
      // Skip until closing quote (handle escaped quotes '')
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            // Escaped quote
            i += 2;
          } else {
            // End of string
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      currentStatement += sql.substring(stringStart, i);
      continue;
    }

    // Handle double-quoted identifiers: "..."
    if (char === '"') {
      const identStart = i;
      i++;
      // Skip until closing quote (handle escaped quotes "")
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            // Escaped quote
            i += 2;
          } else {
            // End of identifier
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      currentStatement += sql.substring(identStart, i);
      continue;
    }

    // Handle dollar-quoted strings: $$...$$ or $tag$...$tag$
    if (char === "$") {
      // Look ahead to find the tag
      let tagEnd = i + 1;
      while (tagEnd < sql.length) {
        const nextChar = sql[tagEnd];
        if (nextChar && /[a-zA-Z0-9_]/.test(nextChar)) {
          tagEnd++;
        } else {
          break;
        }
      }
      
      if (tagEnd < sql.length && sql[tagEnd] === "$") {
        // Found opening delimiter
        const dollarStart = i;
        const openTag = sql.substring(i, tagEnd + 1); // e.g., "$$" or "$func$"
        i = tagEnd + 1;
        
        // Find matching closing delimiter
        while (i < sql.length) {
          if (sql.substring(i, i + openTag.length) === openTag) {
            i += openTag.length;
            break;
          }
          i++;
        }
        currentStatement += sql.substring(dollarStart, i);
        continue;
      }
    }

    // Check for statement delimiter: semicolon
    if (char === ";") {
      const trimmed = currentStatement.trim();
      if (trimmed) {
        statements.push({
          text: trimmed,
          offset: currentOffset,
          index: statements.length,
        });
      }
      currentStatement = "";
      currentOffset = i + 1;
      i++;
      continue;
    }

    // Regular character
    currentStatement += char;
    i++;
  }

  // Add final statement if not empty
  const finalTrimmed = currentStatement.trim();
  if (finalTrimmed) {
    statements.push({
      text: finalTrimmed,
      offset: currentOffset,
      index: statements.length,
    });
  }

  return statements;
}

/**
 * Check if SQL text contains multiple statements.
 */
export function hasMultipleStatements(sql: string): boolean {
  return parseSqlStatements(sql).length > 1;
}

