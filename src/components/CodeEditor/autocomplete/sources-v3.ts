import type {
  Completion,
  CompletionSource,
  CompletionContext,
} from "@codemirror/autocomplete";
import { schemaCache } from "@/services/schemaCache";
import type { QueryContext } from "./parser-v2-fixed";

type DbType = "PostgreSQL" | "MySQL" | "SQLite" | "MSSQL";

interface RankedCompletion extends Completion {
  score: number;
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL',
  'DISTINCT', 'AS', 'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN',
  'LIKE', 'IS', 'NULL', 'ASC', 'DESC', 'INSERT', 'INTO', 'VALUES',
  'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'INDEX', 'UNIQUE',
  'DEFAULT', 'CHECK', 'CONSTRAINT', 'CASCADE', 'RESTRICT', 'COUNT',
  'SUM', 'AVG', 'MIN', 'MAX', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
];

const DIALECT_CONFIG: Record<DbType, {
  quoteChar: string;
  escapeChar: string;
  identifierQuotes: [string, string] | string;
  hasSchemas: boolean;
  hasDatabases: boolean;
  defaultSchema: string | null;
  needsQuoting: (name: string) => boolean;
  keywords: string[];
}> = {
  PostgreSQL: {
    quoteChar: '"',
    escapeChar: '""',
    identifierQuotes: '"',
    hasSchemas: true,
    hasDatabases: true,
    defaultSchema: 'public',
    needsQuoting: (name: string) => {
      return /[A-Z]/.test(name) ||
             /^\d/.test(name) ||
             /[^a-z0-9_]/.test(name) ||
             isPostgreSQLKeyword(name);
    },
    keywords: ['RETURNING', 'ARRAY', 'JSON', 'JSONB']
  },
  MySQL: {
    quoteChar: '`',
    escapeChar: '``',
    identifierQuotes: '`',
    hasSchemas: true,
    hasDatabases: true,
    defaultSchema: null,
    needsQuoting: (name: string) => {
      return /[^a-zA-Z0-9_$]/.test(name) ||
             /^\d/.test(name) ||
             isMySQLKeyword(name);
    },
    keywords: ['AUTO_INCREMENT', 'UNSIGNED']
  },
  SQLite: {
    quoteChar: '"',
    escapeChar: '""',
    identifierQuotes: '"',
    hasSchemas: false,
    hasDatabases: false,
    defaultSchema: 'main',
    needsQuoting: (name: string) => {
      return /[^a-zA-Z0-9_]/.test(name) ||
             /^\d/.test(name) ||
             isSQLiteKeyword(name);
    },
    keywords: ['AUTOINCREMENT', 'PRAGMA']
  },
  MSSQL: {
    quoteChar: '[',
    escapeChar: ']]',
    identifierQuotes: ['[', ']'],
    hasSchemas: true,
    hasDatabases: true,
    defaultSchema: 'dbo',
    needsQuoting: (name: string) => {
      return /[^a-zA-Z0-9_]/.test(name) ||
             /^\d/.test(name) ||
             isMSSQLKeyword(name);
    },
    keywords: ['IDENTITY', 'TOP', 'OUTPUT']
  }
};

function isPostgreSQLKeyword(word: string): boolean {
  const keywords = new Set(['USER', 'TABLE', 'COLUMN', 'INDEX', 'VIEW']);
  return keywords.has(word.toUpperCase());
}

function isMySQLKeyword(word: string): boolean {
  const keywords = new Set(['KEY', 'INDEX', 'CHECK']);
  return keywords.has(word.toUpperCase());
}

function isSQLiteKeyword(word: string): boolean {
  const keywords = new Set(['ROWID', 'TEMP']);
  return keywords.has(word.toUpperCase());
}

function isMSSQLKeyword(word: string): boolean {
  const keywords = new Set(['IDENTITY', 'COMPUTED']);
  return keywords.has(word.toUpperCase());
}

function quoteIdentifier(name: string, dbType: DbType): string {
  const config = DIALECT_CONFIG[dbType];
  if (!config.needsQuoting(name)) {
    return name;
  }

  if (typeof config.identifierQuotes === 'string') {
    return `${config.identifierQuotes}${name}${config.identifierQuotes}`;
  } else {
    return `${config.identifierQuotes[0]}${name}${config.identifierQuotes[1]}`;
  }
}

export function createContextualCompletionSource(params: {
  connectionId: string;
  dbType: DbType;
  parser: { parseContext: (state: any, pos: number) => QueryContext };
}): CompletionSource {
  const { connectionId, dbType, parser } = params;

  return async (context: CompletionContext) => {
    try {
      // Parse context using AST
      const queryContext = parser.parseContext(context.state, context.pos);

      // Don't suggest in strings or comments
      if (queryContext.isInString || queryContext.isInComment) {
        return null;
      }

      const fullText = context.state.doc.toString();
      const textBefore = fullText.slice(Math.max(0, context.pos - 500), context.pos);
      const textBeforeLower = textBefore.toLowerCase();

      // Get the current word being typed
      const word = context.matchBefore(/[\w.]*/) || { from: context.pos, text: '' };
      const currentWord = word.text.toLowerCase();

      let completions: RankedCompletion[] = [];

      // 1. Handle table.column pattern (highest priority)
      const tableColumnMatch = /\b([a-zA-Z_]\w*)\.(\w*)$/.exec(textBefore);
      if (tableColumnMatch) {
        const tableOrAlias = tableColumnMatch[1].toLowerCase();
        const partialColumn = tableColumnMatch[2].toLowerCase();

        // First check aliases from AST
        let tableName: string | undefined;
        let schemaName: string | undefined;

        if (queryContext.aliases.has(tableOrAlias)) {
          const tableRef = queryContext.aliases.get(tableOrAlias);
          tableName = tableRef?.table;
          schemaName = tableRef?.schema;
        } else {
          // Check tables in scope by name (not alias)
          const tableInScope = queryContext.tablesInScope.find(
            t => t.table.toLowerCase() === tableOrAlias
          );
          if (tableInScope) {
            tableName = tableInScope.table;
            schemaName = tableInScope.schema;
          } else {
            // Try to get it from schema cache as a direct table reference
            try {
              const tables = await schemaCache.getTables(
                connectionId,
                queryContext.currentSchema || DIALECT_CONFIG[dbType].defaultSchema || 'public'
              );
              const matchedTable = tables.find(t => t.name.toLowerCase() === tableOrAlias);
              if (matchedTable) {
                tableName = matchedTable.name;
                schemaName = queryContext.currentSchema || DIALECT_CONFIG[dbType].defaultSchema || 'public';
              }
            } catch {
              // Fallback: assume it's a table name
              tableName = tableOrAlias;
              schemaName = queryContext.currentSchema || DIALECT_CONFIG[dbType].defaultSchema || 'public';
            }
          }
        }

        if (tableName) {
          try {
            const columns = await schemaCache.getTableColumns(
              connectionId,
              schemaName || DIALECT_CONFIG[dbType].defaultSchema || 'public',
              tableName
            );

            completions = columns
              .filter(col => !partialColumn || col.name.toLowerCase().startsWith(partialColumn))
              .map(col => ({
                label: col.name,
                apply: quoteIdentifier(col.name, dbType),
                type: 'property',
                detail: col.db_type,
                score: 200
              }));

            // Add * for SELECT clause
            if (queryContext.currentClause === 'SELECT' && (!partialColumn || '*'.startsWith(partialColumn))) {
              completions.unshift({
                label: '*',
                type: 'keyword',
                detail: 'all columns',
                score: 250
              });
            }

            if (completions.length > 0) {
              return {
                from: word.from + tableOrAlias.length + 1,
                options: completions,
                validFor: /^\w*$/
              };
            }
          } catch (error) {
            console.debug('Failed to get columns for table:', tableName, error);
          }
        }
      }

      // 2. Handle context-based completions using AST
      switch (queryContext.currentClause) {
        case 'SELECT':
          // In SELECT clause
          if (queryContext.tablesInScope.length > 0) {
            // We have tables, suggest columns
            for (const table of queryContext.tablesInScope) {
              try {
                const columns = await schemaCache.getTableColumns(
                  connectionId,
                  table.schema || DIALECT_CONFIG[dbType].defaultSchema || 'public',
                  table.table
                );

                // Add columns
                for (const col of columns) {
                  if (!currentWord || col.name.toLowerCase().startsWith(currentWord)) {
                    completions.push({
                      label: col.name,
                      apply: quoteIdentifier(col.name, dbType),
                      type: 'property',
                      detail: col.db_type,
                      score: 90
                    });

                    // Add qualified version
                    const prefix = table.alias || table.table;
                    completions.push({
                      label: `${prefix}.${col.name}`,
                      apply: `${quoteIdentifier(prefix, dbType)}.${quoteIdentifier(col.name, dbType)}`,
                      type: 'property',
                      detail: col.db_type,
                      score: 80
                    });
                  }
                }
              } catch (error) {
                console.debug('Failed to get columns:', error);
              }
            }

            // Add aggregate functions
            const aggregates = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
            for (const agg of aggregates) {
              if (!currentWord || agg.toLowerCase().startsWith(currentWord)) {
                completions.push({
                  label: agg,
                  type: 'function',
                  score: 70
                });
              }
            }
          } else {
            // No tables yet, suggest FROM
            if (!currentWord || 'from'.startsWith(currentWord)) {
              completions.push({
                label: 'FROM',
                type: 'keyword',
                score: 1000
              });
            }
          }
          break;

        case 'FROM':
          // In FROM clause, suggest tables
          try {
            const tables = await schemaCache.getTables(
              connectionId,
              queryContext.currentSchema || DIALECT_CONFIG[dbType].defaultSchema
            );

            completions = tables
              .filter(table => !currentWord || table.name.toLowerCase().startsWith(currentWord))
              .map(table => ({
                label: table.name,
                apply: quoteIdentifier(table.name, dbType),
                type: 'type',
                detail: 'table',
                score: 100
              }));
          } catch (error) {
            console.debug('Failed to get tables:', error);
          }
          break;

        case 'WHERE':
        case 'HAVING':
          // In WHERE/HAVING clause
          if (queryContext.tablesInScope.length > 0) {
            // Add columns from all tables in scope
            for (const table of queryContext.tablesInScope) {
              try {
                const columns = await schemaCache.getTableColumns(
                  connectionId,
                  table.schema || DIALECT_CONFIG[dbType].defaultSchema || 'public',
                  table.table
                );

                for (const col of columns) {
                  if (!currentWord || col.name.toLowerCase().startsWith(currentWord)) {
                    completions.push({
                      label: col.name,
                      apply: quoteIdentifier(col.name, dbType),
                      type: 'property',
                      detail: col.db_type,
                      score: 70
                    });
                  }
                }

                // Add table prefix suggestions
                const prefix = table.alias || table.table;
                if (!currentWord || prefix.toLowerCase().startsWith(currentWord)) {
                  completions.push({
                    label: `${prefix}.`,
                    apply: `${quoteIdentifier(prefix, dbType)}.`,
                    type: 'variable',
                    detail: table.alias ? 'alias' : 'table',
                    score: 100
                  });
                }
              } catch (error) {
                console.debug('Failed to get columns:', error);
              }
            }

            // Add operators
            const operators = ['=', '!=', '<>', '>', '<', '>=', '<=', 'LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'];
            for (const op of operators) {
              if (!currentWord || op.toLowerCase().startsWith(currentWord)) {
                completions.push({
                  label: op,
                  type: 'operator',
                  score: 60
                });
              }
            }

            // Add logical operators
            const logical = ['AND', 'OR', 'NOT'];
            for (const op of logical) {
              if (!currentWord || op.toLowerCase().startsWith(currentWord)) {
                completions.push({
                  label: op,
                  type: 'keyword',
                  score: 50
                });
              }
            }
          }
          break;

        case 'JOIN':
          // In JOIN clause, always suggest tables first
          try {
            const tables = await schemaCache.getTables(
              connectionId,
              queryContext.currentSchema || DIALECT_CONFIG[dbType].defaultSchema
            );

            // Check if current word could be a complete table name
            const matchingTables = tables.filter(table =>
              !currentWord || table.name.toLowerCase().startsWith(currentWord)
            );

            if (matchingTables.length > 0) {
              // Suggest matching tables
              completions = matchingTables.map(table => ({
                label: table.name,
                apply: quoteIdentifier(table.name, dbType),
                type: 'type',
                detail: 'table',
                score: 100
              }));
            }

            // Only suggest ON if we have a complete table name and it matches exactly
            const exactTableMatch = tables.find(table =>
              table.name.toLowerCase() === (currentWord || '').toLowerCase()
            );

            if (exactTableMatch || textBeforeLower.match(/\bjoin\s+[a-zA-Z_]\w+\s+$/i)) {
              if (!currentWord || 'on'.startsWith(currentWord)) {
                completions.push({
                  label: 'ON',
                  type: 'keyword',
                  score: 150
                });
              }
            }

            // Return immediately to prevent keyword fallback
            if (completions.length > 0 || currentWord) {
              return {
                from: word.from,
                options: completions.slice(0, 50),
                validFor: /^[\w.]*$/
              };
            }
          } catch (error) {
            console.debug('Failed to get tables for JOIN:', error);
          }
          break;

        case 'GROUP BY':
        case 'ORDER BY':
          // In GROUP BY/ORDER BY clause
          if (queryContext.tablesInScope.length > 0) {
            for (const table of queryContext.tablesInScope) {
              try {
                const columns = await schemaCache.getTableColumns(
                  connectionId,
                  table.schema || DIALECT_CONFIG[dbType].defaultSchema || 'public',
                  table.table
                );

                for (const col of columns) {
                  if (!currentWord || col.name.toLowerCase().startsWith(currentWord)) {
                    completions.push({
                      label: col.name,
                      apply: quoteIdentifier(col.name, dbType),
                      type: 'property',
                      detail: col.db_type,
                      score: 70
                    });
                  }
                }
              } catch (error) {
                console.debug('Failed to get columns:', error);
              }
            }

            // For ORDER BY, add ASC/DESC
            if (queryContext.currentClause === 'ORDER BY') {
              if (!currentWord || 'asc'.startsWith(currentWord)) {
                completions.push({ label: 'ASC', type: 'keyword', score: 60 });
              }
              if (!currentWord || 'desc'.startsWith(currentWord)) {
                completions.push({ label: 'DESC', type: 'keyword', score: 60 });
              }
            }
          }
          break;
      }

      // 3. Check for special patterns regardless of AST clause

      // Pattern-based fallbacks when AST parsing fails

      // After JOIN partial word - suggest tables
      const joinMatch = /\bjoin\s+([a-zA-Z_]\w*)?$/i.exec(textBeforeLower);
      if (joinMatch) {
        const partialTable = joinMatch[1] || '';
        try {
          const tables = await schemaCache.getTables(
            connectionId,
            queryContext.currentSchema || DIALECT_CONFIG[dbType].defaultSchema || 'public'
          );

          const matchingTables = tables.filter(table =>
            !partialTable || table.name.toLowerCase().startsWith(partialTable.toLowerCase())
          );

          if (matchingTables.length > 0) {
            completions = matchingTables.map(table => ({
              label: table.name,
              apply: quoteIdentifier(table.name, dbType),
              type: 'type',
              detail: 'table',
              score: 120
            }));
          }

          // Always return here to prevent keyword fallback
          return {
            from: word.from,
            options: completions.slice(0, 50),
            validFor: /^[\w.]*$/
          };
        } catch (error) {
          console.debug('Failed to get tables for JOIN pattern:', error);
          // Still return empty to prevent keywords
          return {
            from: word.from,
            options: [],
            validFor: /^[\w.]*$/
          };
        }
      }

      // After ORDER BY/GROUP BY/WHERE/HAVING - suggest columns
      const columnClauseMatch = /\b(order\s+by|group\s+by|where|having)\s+([a-zA-Z_]\w*)?$/i.exec(textBeforeLower);
      if (columnClauseMatch && queryContext.tablesInScope.length > 0) {
        const clause = columnClauseMatch[1].toLowerCase();
        const partialColumn = columnClauseMatch[2] || '';

        for (const table of queryContext.tablesInScope) {
          try {
            const columns = await schemaCache.getTableColumns(
              connectionId,
              table.schema || DIALECT_CONFIG[dbType].defaultSchema || 'public',
              table.table
            );

            for (const col of columns) {
              if (!partialColumn || col.name.toLowerCase().startsWith(partialColumn.toLowerCase())) {
                completions.push({
                  label: col.name,
                  apply: quoteIdentifier(col.name, dbType),
                  type: 'property',
                  detail: col.db_type,
                  score: 110
                });

                // Add table.column format for WHERE/HAVING
                if (clause === 'where' || clause === 'having') {
                  const prefix = table.alias || table.table;
                  completions.push({
                    label: `${prefix}.${col.name}`,
                    apply: `${quoteIdentifier(prefix, dbType)}.${quoteIdentifier(col.name, dbType)}`,
                    type: 'property',
                    detail: col.db_type,
                    score: 105
                  });
                }
              }
            }
          } catch (error) {
            console.debug('Failed to get columns for', clause, ':', error);
          }
        }

        // Add operators for WHERE/HAVING
        if ((clause === 'where' || clause === 'having') && completions.length > 0) {
          const operators = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL'];
          for (const op of operators) {
            if (!partialColumn || op.toLowerCase().startsWith(partialColumn.toLowerCase())) {
              completions.push({
                label: op,
                type: 'operator',
                score: 80
              });
            }
          }
        }

        // Add ASC/DESC for ORDER BY
        if (clause === 'order by') {
          if (!partialColumn || 'asc'.startsWith(partialColumn.toLowerCase())) {
            completions.push({ label: 'ASC', type: 'keyword', score: 85 });
          }
          if (!partialColumn || 'desc'.startsWith(partialColumn.toLowerCase())) {
            completions.push({ label: 'DESC', type: 'keyword', score: 85 });
          }
        }

        if (completions.length > 0) {
          return {
            from: word.from,
            options: completions.slice(0, 50),
            validFor: /^[\w.]*$/
          };
        }
      }

      // After FROM table, suggest WHERE/JOIN/GROUP BY/ORDER BY
      if (textBeforeLower.match(/\bfrom\s+[a-zA-Z_]\w*(?:\s+[a-zA-Z_]\w*)?\s+\w*$/i)) {
        const afterFromKeywords = ['WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
                                  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET'];
        for (const kw of afterFromKeywords) {
          if (!currentWord || kw.toLowerCase().startsWith(currentWord)) {
            completions.push({
              label: kw,
              type: 'keyword',
              score: 120
            });
          }
        }
      }

      // After WHERE with some content, suggest AND/OR
      if (textBeforeLower.match(/\bwhere\s+.+\s+\w*$/i)) {
        const logical = ['AND', 'OR'];
        for (const op of logical) {
          if (!currentWord || op.toLowerCase().startsWith(currentWord)) {
            completions.push({
              label: op,
              type: 'keyword',
              score: 100
            });
          }
        }
      }

      // 4. Add general SQL keywords as fallback
      if (completions.length < 10) {
        const keywordCompletions = SQL_KEYWORDS
          .filter(kw => !currentWord || kw.toLowerCase().startsWith(currentWord))
          .map(kw => ({
            label: kw,
            type: 'keyword',
            score: 10
          }));

        // Merge with existing completions
        completions = [...completions, ...keywordCompletions.slice(0, 20)];
      }

      // Remove duplicates
      const seen = new Set<string>();
      completions = completions.filter(c => {
        if (seen.has(c.label)) return false;
        seen.add(c.label);
        return true;
      });

      // Sort by score
      completions.sort((a, b) => b.score - a.score);

      return {
        from: word.from,
        options: completions.slice(0, 50),
        validFor: /^[\w.]*$/
      };

    } catch (error) {
      console.error('Autocomplete error:', error);

      // Return basic keywords on error
      const word = context.matchBefore(/[\w.]*/) || { from: context.pos, text: '' };
      const currentWord = word.text.toLowerCase();

      const fallbackCompletions = SQL_KEYWORDS
        .filter(kw => !currentWord || kw.toLowerCase().startsWith(currentWord))
        .slice(0, 20)
        .map(kw => ({
          label: kw,
          type: 'keyword'
        }));

      return {
        from: word.from,
        options: fallbackCompletions,
        validFor: /^[\w.]*$/
      };
    }
  };
}