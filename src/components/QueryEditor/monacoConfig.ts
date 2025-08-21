/**
 * Monaco Editor Configuration for SQL
 * Provides intellisense, autocomplete, and syntax highlighting
 */

import type { Monaco } from "@monaco-editor/react";
import type { editor, languages } from "monaco-editor";
import { schemaService } from "@/services/schemaService";

export interface MonacoSQLConfig {
  connectionId: string;
  monaco: Monaco;
}

/**
 * Configure SQL language features for Monaco Editor
 */
export function configureSQLLanguage({ connectionId, monaco }: MonacoSQLConfig) {
  // Register SQL completion provider
  const completionProvider = monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " ", "("],
    provideCompletionItems: async (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const suggestions: languages.CompletionItem[] = [];

      // Check if we're after a table name (for column suggestions)
      const tableMatch = /(?:FROM|JOIN|UPDATE|INTO)\s+(?:`)?(\w+)(?:`)?\.?$/i.exec(textUntilPosition);
      const afterDot = /(\w+)\.$/i.exec(textUntilPosition);
      
      if (afterDot) {
        // Suggest columns for the table before the dot
        const tableName = afterDot[1];
        const columns = await schemaService.getTableColumnNames(connectionId, tableName);
        
        columns.forEach(columnName => {
          suggestions.push({
            label: columnName,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: columnName,
            range,
            detail: `Column in ${tableName}`,
            sortText: "0" + columnName, // Prioritize columns
          });
        });
      } else {
        // Use a Set to track already added items and prevent duplicates
        const addedItems = new Set<string>();
        
        // Get schema information
        try {
          const schema = await schemaService.getSchema(connectionId);
          
          // Add tables (deduplicated)
          const uniqueTables = new Map<string, typeof schema.tables[0]>();
          schema.tables.forEach(table => {
            const key = table.name.toLowerCase();
            if (!uniqueTables.has(key)) {
              uniqueTables.set(key, table);
            }
          });
          
          uniqueTables.forEach((table, key) => {
            if (!addedItems.has(`table:${key}`)) {
              addedItems.add(`table:${key}`);
              suggestions.push({
                label: table.name,
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: table.name,
                range,
                detail: `Table (${table.rowCount || 0} rows)`,
                documentation: table.schema ? `Schema: ${table.schema}` : undefined,
                sortText: "1" + table.name,
              });
            }
          });

          // Add views (deduplicated)
          const uniqueViews = new Map<string, typeof schema.views[0]>();
          schema.views.forEach(view => {
            const key = view.name.toLowerCase();
            if (!uniqueViews.has(key)) {
              uniqueViews.set(key, view);
            }
          });
          
          uniqueViews.forEach((view, key) => {
            if (!addedItems.has(`view:${key}`)) {
              addedItems.add(`view:${key}`);
              suggestions.push({
                label: view.name,
                kind: monaco.languages.CompletionItemKind.Interface,
                insertText: view.name,
                range,
                detail: view.type === 'materialized_view' ? 'Materialized View' : 'View',
                documentation: view.schema ? `Schema: ${view.schema}` : undefined,
                sortText: "2" + view.name,
              });
            }
          });

          // Add database-specific functions (deduplicated)
          const uniqueFunctions = new Map<string, typeof schema.functions[0]>();
          schema.functions.forEach(func => {
            const key = func.name.toLowerCase();
            if (!uniqueFunctions.has(key)) {
              uniqueFunctions.set(key, func);
            }
          });
          
          uniqueFunctions.forEach((func, key) => {
            const funcKey = `func:${key}`;
            if (!addedItems.has(funcKey)) {
              addedItems.add(funcKey);
              const args = func.arguments?.join(', ') || '';
              suggestions.push({
                label: func.name,
                kind: monaco.languages.CompletionItemKind.Function,
                insertText: `${func.name}(${args ? '$1' : ''})`,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
                detail: `Function: ${func.returnType || 'void'}`,
                documentation: args ? `Arguments: ${args}` : undefined,
                sortText: "3" + func.name,
              });
            }
          });

          // If we're in a column context, add all column names
          if (tableMatch) {
            const tableName = tableMatch[1];
            const columns = await schemaService.getTableColumnNames(connectionId, tableName);
            
            columns.forEach(columnName => {
              suggestions.push({
                label: columnName,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: columnName,
                range,
                detail: `Column in ${tableName}`,
                sortText: "0" + columnName,
              });
            });
          }
        } catch (error) {
          console.error('[Monaco] Failed to get schema for autocomplete:', error);
        }

        // Add SQL keywords (but check if not already added and filter based on current input)
        const keywords = getSQLKeywords();
        const currentWordLower = word.word.toLowerCase();
        keywords.forEach(keyword => {
          const keywordLower = keyword.toLowerCase();
          // Only show keywords that start with the current input
          if (currentWordLower && !keywordLower.startsWith(currentWordLower)) {
            return;
          }
          const keywordKey = `keyword:${keywordLower}`;
          if (!addedItems.has(keywordKey)) {
            addedItems.add(keywordKey);
            suggestions.push({
              label: keyword,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: keyword,
              range,
              sortText: "5" + keyword, // Medium priority for keywords
            });
          }
        });

        // Add common SQL functions (only if not already added from schema and match input)
        const functions = getSQLFunctions();
        functions.forEach(func => {
          const funcNameLower = func.name.toLowerCase();
          // Only show functions that start with the current input
          if (currentWordLower && !funcNameLower.startsWith(currentWordLower)) {
            return;
          }
          const funcKey = `func:${funcNameLower}`;
          if (!addedItems.has(funcKey)) {
            addedItems.add(funcKey);
            suggestions.push({
              label: func.name,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: func.insertText,
              insertTextRules: func.snippet 
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet 
                : undefined,
              range,
              detail: func.detail,
              sortText: "6" + func.name, // Lower priority than keywords
            });
          }
        });
      }

      return { suggestions };
    },
  });

  // Register hover provider for additional information
  const hoverProvider = monaco.languages.registerHoverProvider("sql", {
    provideHover: async (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      try {
        const { table, columns } = await schemaService.getTableInfo(connectionId, word.word);
        
        if (table) {
          const contents: languages.IMarkdownString[] = [];
          
          // Table information
          contents.push({
            value: `**${table.name}** (${table.type || 'table'})`,
          });

          if (table.schema) {
            contents.push({
              value: `Schema: \`${table.schema}\``,
            });
          }

          if ('rowCount' in table && table.rowCount !== undefined) {
            contents.push({
              value: `Rows: ${table.rowCount.toLocaleString()}`,
            });
          }

          // Column information
          if (columns && columns.length > 0) {
            const columnList = columns
              .slice(0, 10) // Show first 10 columns
              .map(col => {
                let line = `- \`${col.name}\` *${col.dataType}*`;
                if (col.isPrimaryKey) line += ' 🔑';
                if (col.nullable) line += ' (nullable)';
                return line;
              })
              .join('\n');

            contents.push({
              value: `**Columns:**\n${columnList}${columns.length > 10 ? `\n... and ${columns.length - 10} more` : ''}`,
            });
          }

          return {
            contents,
            range: new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn
            ),
          };
        }
      } catch (error) {
        console.error('[Monaco] Failed to get hover info:', error);
      }

      return null;
    },
  });

  // Return disposables for cleanup
  return {
    dispose: () => {
      completionProvider.dispose();
      hoverProvider.dispose();
    },
  };
}

/**
 * Get SQL keywords for autocomplete
 */
function getSQLKeywords(): string[] {
  return [
    "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL",
    "ON", "AS", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "IS",
    "NULL", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE",
    "ALTER", "DROP", "TABLE", "INDEX", "VIEW", "TRIGGER", "PROCEDURE", "FUNCTION",
    "DATABASE", "SCHEMA", "IF", "CASE", "WHEN", "THEN", "ELSE", "END", "GROUP",
    "BY", "HAVING", "ORDER", "ASC", "DESC", "LIMIT", "OFFSET", "UNION", "ALL",
    "DISTINCT", "WITH", "RECURSIVE", "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION",
    "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "CHECK", "DEFAULT",
    "CONSTRAINT", "CASCADE", "RESTRICT", "GRANT", "REVOKE", "PRIVILEGES", "TO",
    "PUBLIC", "USER", "ROLE"
  ];
}

/**
 * Get SQL functions for autocomplete
 */
function getSQLFunctions(): Array<{
  name: string;
  insertText: string;
  detail: string;
  snippet?: boolean;
}> {
  return [
    // Aggregate functions
    { name: "COUNT", insertText: "COUNT($1)", detail: "Count rows", snippet: true },
    { name: "SUM", insertText: "SUM($1)", detail: "Sum values", snippet: true },
    { name: "AVG", insertText: "AVG($1)", detail: "Average value", snippet: true },
    { name: "MIN", insertText: "MIN($1)", detail: "Minimum value", snippet: true },
    { name: "MAX", insertText: "MAX($1)", detail: "Maximum value", snippet: true },
    
    // String functions
    { name: "CONCAT", insertText: "CONCAT($1, $2)", detail: "Concatenate strings", snippet: true },
    { name: "SUBSTRING", insertText: "SUBSTRING($1, $2, $3)", detail: "Extract substring", snippet: true },
    { name: "LENGTH", insertText: "LENGTH($1)", detail: "String length", snippet: true },
    { name: "UPPER", insertText: "UPPER($1)", detail: "Convert to uppercase", snippet: true },
    { name: "LOWER", insertText: "LOWER($1)", detail: "Convert to lowercase", snippet: true },
    { name: "TRIM", insertText: "TRIM($1)", detail: "Remove whitespace", snippet: true },
    { name: "REPLACE", insertText: "REPLACE($1, $2, $3)", detail: "Replace string", snippet: true },
    
    // Date functions
    { name: "NOW", insertText: "NOW()", detail: "Current timestamp" },
    { name: "CURRENT_DATE", insertText: "CURRENT_DATE", detail: "Current date" },
    { name: "CURRENT_TIME", insertText: "CURRENT_TIME", detail: "Current time" },
    { name: "DATE_FORMAT", insertText: "DATE_FORMAT($1, '$2')", detail: "Format date", snippet: true },
    { name: "DATEADD", insertText: "DATEADD($1, $2, $3)", detail: "Add to date", snippet: true },
    { name: "DATEDIFF", insertText: "DATEDIFF($1, $2)", detail: "Date difference", snippet: true },
    
    // Math functions
    { name: "ROUND", insertText: "ROUND($1, $2)", detail: "Round number", snippet: true },
    { name: "FLOOR", insertText: "FLOOR($1)", detail: "Round down", snippet: true },
    { name: "CEIL", insertText: "CEIL($1)", detail: "Round up", snippet: true },
    { name: "ABS", insertText: "ABS($1)", detail: "Absolute value", snippet: true },
    { name: "POWER", insertText: "POWER($1, $2)", detail: "Exponentiation", snippet: true },
    { name: "SQRT", insertText: "SQRT($1)", detail: "Square root", snippet: true },
    
    // Conversion functions
    { name: "CAST", insertText: "CAST($1 AS $2)", detail: "Type conversion", snippet: true },
    { name: "CONVERT", insertText: "CONVERT($1, $2)", detail: "Convert value", snippet: true },
    
    // Conditional functions
    { name: "COALESCE", insertText: "COALESCE($1, $2)", detail: "First non-null value", snippet: true },
    { name: "NULLIF", insertText: "NULLIF($1, $2)", detail: "NULL if equal", snippet: true },
    { name: "IFNULL", insertText: "IFNULL($1, $2)", detail: "Replace NULL", snippet: true },
  ];
}

/**
 * Register SQL code snippets
 */
export function registerSQLSnippets(monaco: Monaco) {
  // Register snippets as completion items with unique trigger labels
  return monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [], // Don't trigger on any characters to avoid conflicts
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const snippets: languages.CompletionItem[] = [];
      
      // Only add snippets if the user is typing a snippet trigger (minimum 3 chars to avoid conflicts)
      if (word.word.length >= 3) {
        const lowerWord = word.word.toLowerCase();
        
        if (lowerWord.startsWith("sel") && lowerWord !== "select") {
          snippets.push({
            label: "sel",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:condition}",
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "SELECT statement",
            detail: "Basic SELECT query snippet",
            range,
            sortText: "0sel", // High priority for exact snippet match
          });
        }
        
        if (lowerWord.startsWith("selj")) {
          snippets.push({
            label: "seljoin",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: [
              "SELECT ${1:t1.column}, ${2:t2.column}",
              "FROM ${3:table1} t1",
              "JOIN ${4:table2} t2 ON t1.${5:id} = t2.${6:id}",
              "WHERE ${7:condition}"
            ].join("\n"),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "SELECT with JOIN",
            detail: "SELECT query with JOIN snippet",
            range,
            sortText: "0seljoin",
          });
        }
        
        if (lowerWord.startsWith("ins") && lowerWord !== "insert" && lowerWord !== "into") {
          snippets.push({
            label: "ins",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "INSERT INTO ${1:table_name} (${2:column1}, ${3:column2})\nVALUES (${4:value1}, ${5:value2})",
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "INSERT statement",
            detail: "Insert new row snippet",
            range,
            sortText: "0ins",
          });
        }
        
        if (lowerWord.startsWith("upd") && lowerWord !== "update") {
          snippets.push({
            label: "upd",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "UPDATE ${1:table_name}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition}",
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "UPDATE statement",
            detail: "Update existing rows snippet",
            range,
            sortText: "0upd",
          });
        }
        
        if (lowerWord.startsWith("del") && lowerWord !== "delete") {
          snippets.push({
            label: "del",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "DELETE FROM ${1:table_name}\nWHERE ${2:condition}",
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "DELETE statement",
            detail: "Delete rows snippet",
            range,
            sortText: "0del",
          });
        }
        
        if (lowerWord.startsWith("createt")) {
          snippets.push({
            label: "createtable",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: [
              "CREATE TABLE ${1:table_name} (",
              "  ${2:id} ${3:INT} PRIMARY KEY,",
              "  ${4:column_name} ${5:VARCHAR(255)} NOT NULL,",
              "  ${6:created_at} TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
              ")"
            ].join("\n"),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "CREATE TABLE statement",
            detail: "Create new table snippet",
            range,
            sortText: "0createtable",
          });
        }
        
        if (lowerWord.startsWith("createi")) {
          snippets.push({
            label: "createindex",
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: "CREATE INDEX ${1:index_name}\nON ${2:table_name} (${3:column})",
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: "CREATE INDEX statement",
            detail: "Create index on table snippet",
            range,
            sortText: "0createindex",
          });
        }
      }

      return { suggestions: snippets };
    },
  });
}