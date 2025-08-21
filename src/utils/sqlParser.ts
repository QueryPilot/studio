/**
 * SQL Parser Utilities
 * Handles splitting and parsing SQL statements
 */

/**
 * Split SQL query into individual statements
 * Handles semicolons correctly, accounting for:
 * - Strings (single and double quotes)
 * - Comments (-- and block comments)
 * - Escaped quotes
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let currentStatement = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];
    
    // Handle escape sequences
    if (escaped) {
      currentStatement += char;
      escaped = false;
      continue;
    }
    
    if (char === '\\') {
      escaped = true;
      currentStatement += char;
      continue;
    }
    
    // Handle line comments
    if (!inSingleQuote && !inDoubleQuote && !inBlockComment) {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
      }
    }
    
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      currentStatement += char;
      continue;
    }
    
    // Handle block comments
    if (!inSingleQuote && !inDoubleQuote && !inLineComment) {
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        currentStatement += char;
        continue;
      }
    }
    
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        currentStatement += char;
        currentStatement += nextChar;
        i++; // Skip next char
        continue;
      }
      currentStatement += char;
      continue;
    }
    
    // Handle quotes
    if (!inLineComment && !inBlockComment) {
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      }
    }
    
    // Handle statement separator
    if (char === ';' && !inSingleQuote && !inDoubleQuote && !inLineComment && !inBlockComment) {
      // Found a statement separator
      const trimmed = currentStatement.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      currentStatement = '';
    } else {
      currentStatement += char;
    }
  }
  
  // Add the last statement if any
  const trimmed = currentStatement.trim();
  if (trimmed) {
    statements.push(trimmed);
  }
  
  return statements;
}

/**
 * Determine the type of SQL statement
 */
export function getStatementType(sql: string): 'select' | 'insert' | 'update' | 'delete' | 'ddl' | 'other' {
  const trimmed = sql.trim().toLowerCase();
  
  if (trimmed.startsWith('select') || trimmed.startsWith('with')) {
    return 'select';
  } else if (trimmed.startsWith('insert')) {
    return 'insert';
  } else if (trimmed.startsWith('update')) {
    return 'update';
  } else if (trimmed.startsWith('delete')) {
    return 'delete';
  } else if (
    trimmed.startsWith('create') ||
    trimmed.startsWith('alter') ||
    trimmed.startsWith('drop') ||
    trimmed.startsWith('truncate')
  ) {
    return 'ddl';
  }
  
  return 'other';
}

/**
 * Check if a query contains multiple statements
 */
export function hasMultipleStatements(sql: string): boolean {
  const statements = splitSqlStatements(sql);
  return statements.length > 1;
}

/**
 * Clean SQL statement by removing comments and extra whitespace
 */
export function cleanSqlStatement(sql: string): string {
  // Remove line comments
  let cleaned = sql.replace(/--.*$/gm, '');
  
  // Remove block comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Replace multiple whitespaces with single space
  cleaned = cleaned.replace(/\s+/g, ' ');
  
  // Trim
  return cleaned.trim();
}