import * as monaco from 'monaco-editor';
import { databaseService, type ColumnMeta, type TableMeta } from '@/services/databaseService';

export interface SchemaData {
  tables: TableMeta[];
  columns: Map<string, ColumnMeta[]>;
  timestamp: number;
}

export class SQLCompletionProvider implements monaco.languages.CompletionItemProvider {
  public readonly triggerCharacters = ['.', ' ', '(', ','];
  private schemaCache = new Map<string, SchemaData>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  constructor(
    private connectionId: string,
    private database: string,
    private schema: string = 'public',
    private dbType: string = 'postgres'
  ) {}

  async provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    context: monaco.languages.CompletionContext,
    _token: monaco.CancellationToken
  ): Promise<monaco.languages.CompletionList> {
    const word = model.getWordUntilPosition(position);
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };

    const textBeforeCursor = model.getValueInRange({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });

    // Don't provide suggestions if triggered by certain characters that shouldn't show completions
    if (context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter) {
      const triggerChar = context.triggerCharacter;
      // Skip suggestions for certain triggers
      if (triggerChar === '(' || triggerChar === ')' || triggerChar === ';') {
        return { suggestions: [], incomplete: false };
      }
    }

    const suggestions: monaco.languages.CompletionItem[] = [];
    const currentWord = word.word.toLowerCase();

    // Determine what type of suggestions to show based on context
    const shouldShowKeywords = this.shouldShowKeywords(textBeforeCursor);
    const shouldShowFunctions = this.shouldShowFunctions(textBeforeCursor);
    const shouldShowTables = this.shouldShowTables(textBeforeCursor);
    const shouldShowColumns = this.shouldShowColumns(textBeforeCursor);

    // Add SQL keywords if appropriate
    if (shouldShowKeywords) {
      const keywords = this.getSQLKeywords(range);
      // Filter based on current word
      const filtered = currentWord 
        ? keywords.filter(k => k.label.toLowerCase().startsWith(currentWord))
        : keywords;
      suggestions.push(...filtered);
    }

    // Add database-specific functions if appropriate
    if (shouldShowFunctions) {
      const functions = this.getDatabaseFunctions(range);
      const filtered = currentWord
        ? functions.filter(f => f.label.toLowerCase().startsWith(currentWord))
        : functions;
      suggestions.push(...filtered);
    }

    // Add schema objects
    const schemaData = await this.getSchemaData();
    if (schemaData) {
      if (shouldShowTables) {
        const tables = this.getTableSuggestions(schemaData, range, textBeforeCursor);
        const filtered = currentWord
          ? tables.filter(t => t.label.toString().toLowerCase().startsWith(currentWord))
          : tables;
        suggestions.push(...filtered);
      }
      
      if (shouldShowColumns) {
        const columns = this.getColumnSuggestions(schemaData, range, textBeforeCursor);
        const filtered = currentWord
          ? columns.filter(c => c.label.toString().toLowerCase().startsWith(currentWord))
          : columns;
        suggestions.push(...filtered);
      }
    }

    // Remove exact duplicates by label
    const seen = new Set<string>();
    const uniqueSuggestions = suggestions.filter(item => {
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      if (seen.has(label)) {
        return false;
      }
      seen.add(label);
      return true;
    });

    return { 
      suggestions: uniqueSuggestions,
      incomplete: false
    };
  }

  private shouldShowKeywords(textBeforeCursor: string): boolean {
    // Show keywords at the beginning or after certain patterns
    const patterns = [
      /^\s*$/,  // Beginning of query
      /;\s*$/,  // After semicolon
      /\)\s+$/,  // After closing parenthesis
      /\s+$/,  // After space
    ];
    return patterns.some(p => p.test(textBeforeCursor));
  }

  private shouldShowFunctions(textBeforeCursor: string): boolean {
    // Show functions after SELECT, WHERE, etc.
    const patterns = [
      /SELECT\s+/i,
      /WHERE\s+/i,
      /HAVING\s+/i,
      /,\s*$/,  // After comma in SELECT list
    ];
    return patterns.some(p => p.test(textBeforeCursor));
  }

  private shouldShowTables(textBeforeCursor: string): boolean {
    // Show tables after FROM, JOIN, etc.
    const patterns = [
      /FROM\s+/i,
      /JOIN\s+/i,
      /INTO\s+/i,
      /UPDATE\s+/i,
      /TABLE\s+/i,
    ];
    return patterns.some(p => p.test(textBeforeCursor));
  }

  private shouldShowColumns(textBeforeCursor: string): boolean {
    // Show columns in SELECT, WHERE, etc.
    const patterns = [
      /SELECT\s+/i,
      /WHERE\s+/i,
      /ON\s+/i,
      /SET\s+/i,
      /ORDER\s+BY\s+/i,
      /GROUP\s+BY\s+/i,
    ];
    return patterns.some(p => p.test(textBeforeCursor));
  }

  private getSQLKeywords(range: monaco.IRange): monaco.languages.CompletionItem[] {
    // PostgreSQL-specific keywords only
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
      'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE',
      'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
      'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE',
      'TABLE', 'ALTER', 'DROP', 'INDEX', 'VIEW', 'WITH', 'UNION', 'ALL',
      'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'NULL', 'IS',
      'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION'
    ];
    
    return keywords.map(keyword => ({
      label: keyword,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: keyword,
      range,
      sortText: 'a' + keyword,
    }));
  }

  private getDatabaseFunctions(range: monaco.IRange): monaco.languages.CompletionItem[] {
    // Only the most common PostgreSQL functions
    const functions = [
      'count()', 'sum()', 'avg()', 'min()', 'max()',
      'now()', 'current_timestamp', 'current_date',
      'coalesce()', 'nullif()', 'cast()',
      'concat()', 'length()', 'lower()', 'upper()',
      'substring()', 'replace()', 'trim()',
    ];

    return functions.map(func => ({
      label: func,
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: func,
      range,
      sortText: 'b' + func,
    }));
  }

  private async getSchemaData(): Promise<SchemaData | null> {
    const cacheKey = `${this.connectionId}:${this.database}:${this.schema}`;
    const cached = this.schemaCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached;
    }

    try {
      const tables = await databaseService.listTables(
        this.connectionId,
        this.database,
        this.schema
      );

      const columns = new Map<string, ColumnMeta[]>();
      
      // Fetch columns for each table (limit to first 20 tables for performance)
      const tablesToFetch = tables.slice(0, 20);
      await Promise.all(
        tablesToFetch.map(async table => {
          try {
            const cols = await databaseService.getTableColumns(
              this.connectionId,
              this.database,
              this.schema,
              table.name
            );
            columns.set(table.name, cols);
          } catch (err) {
            console.warn(`Failed to fetch columns for ${table.name}:`, err);
          }
        })
      );

      const schemaData: SchemaData = {
        tables,
        columns,
        timestamp: Date.now(),
      };

      this.schemaCache.set(cacheKey, schemaData);
      return schemaData;
    } catch (error) {
      console.error('Failed to fetch schema data:', error);
      return null;
    }
  }

  private getTableSuggestions(
    schemaData: SchemaData,
    range: monaco.IRange,
    textBeforeCursor: string
  ): monaco.languages.CompletionItem[] {
    return schemaData.tables.map(table => ({
      label: table.name,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: table.name,
      detail: table.kind,
      range,
      sortText: 'c' + table.name,
    }));
  }

  private getColumnSuggestions(
    schemaData: SchemaData,
    range: monaco.IRange,
    textBeforeCursor: string
  ): monaco.languages.CompletionItem[] {
    const suggestions: monaco.languages.CompletionItem[] = [];

    // Try to detect table context from the query
    const tableMatch = textBeforeCursor.match(/\b(?:FROM|JOIN)\s+(\w+)/i);
    const tableName = tableMatch ? tableMatch[1] : null;

    if (tableName && schemaData.columns.has(tableName)) {
      // Suggest columns from specific table only
      const columns = schemaData.columns.get(tableName)!;
      columns.forEach(col => {
        suggestions.push({
          label: col.name,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: col.name,
          detail: col.db_type,
          range,
          sortText: 'd' + col.name,
        });
      });
    }

    return suggestions;
  }

  public clearCache() {
    this.schemaCache.clear();
  }

  public updateConnectionInfo(connectionId: string, database: string, schema: string, dbType: string) {
    this.connectionId = connectionId;
    this.database = database;
    this.schema = schema;
    this.dbType = dbType;
    this.clearCache();
  }
}