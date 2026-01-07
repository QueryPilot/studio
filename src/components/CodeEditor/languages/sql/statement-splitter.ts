export interface StatementRange {
  from: number;
  to: number;
  text: string;
}

export function splitStatements(sql: string): StatementRange[] {
  const statements: StatementRange[] = [];
  let currentStart = 0;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];

    // Skip single-quoted strings
    if (char === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2; // Skip escaped quote
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      continue;
    }

    // Skip double-quoted identifiers
    if (char === '"') {
      i++;
      while (i < sql.length && sql[i] !== '"') i++;
      i++;
      continue;
    }

    // Skip dollar quotes (PostgreSQL)
    if (char === '$') {
      const tagMatch = sql.slice(i).match(/^\$([a-zA-Z_]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const endIndex = sql.indexOf(tag, i + tag.length);
        if (endIndex !== -1) {
          i = endIndex + tag.length;
          continue;
        }
      }
      i++;
      continue;
    }

    // Skip line comments
    if (char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      i++;
      continue;
    }

    // Skip block comments
    if (char === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // Statement terminator
    if (char === ';') {
      const rawText = sql.slice(currentStart, i);
      const text = rawText.trim();
      if (text) {
        // Find actual start position (skip leading whitespace)
        const leadingWhitespace = rawText.length - rawText.trimStart().length;
        const actualFrom = currentStart + leadingWhitespace;
        statements.push({ from: actualFrom, to: i, text });
      }
      currentStart = i + 1;
    }

    i++;
  }

  // Handle final statement without trailing semicolon
  const finalRaw = sql.slice(currentStart);
  const finalText = finalRaw.trim();
  if (finalText) {
    const leadingWhitespace = finalRaw.length - finalRaw.trimStart().length;
    const actualFrom = currentStart + leadingWhitespace;
    statements.push({ from: actualFrom, to: sql.length, text: finalText });
  }

  return statements;
}

export function getStatementAt(sql: string, pos: number): StatementRange | null {
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    if (pos >= stmt.from && pos <= stmt.to) {
      return stmt;
    }
  }
  return null;
}
