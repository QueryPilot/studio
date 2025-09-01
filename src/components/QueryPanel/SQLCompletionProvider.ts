import * as monaco from 'monaco-editor';
import { databaseService, type ColumnMeta, type TableMeta } from '@/services/databaseService';

export interface SchemaData {
  tables: TableMeta[];
  columns: Map<string, ColumnMeta[]>;
  timestamp: number;
}

export class SQLCompletionProvider implements monaco.languages.CompletionItemProvider {
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
    _context: monaco.languages.CompletionContext,
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

    const suggestions: monaco.languages.CompletionItem[] = [];

    // Add SQL keywords based on database type
    suggestions.push(...this.getSQLKeywords(range));

    // Add database-specific functions
    suggestions.push(...this.getDatabaseFunctions(range));

    // Add schema objects
    const schemaData = await this.getSchemaData();
    if (schemaData) {
      suggestions.push(...this.getTableSuggestions(schemaData, range, textBeforeCursor));
      suggestions.push(...this.getColumnSuggestions(schemaData, range, textBeforeCursor));
    }

    return { suggestions };
  }

  private getSQLKeywords(range: monaco.IRange): monaco.languages.CompletionItem[] {
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
      'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE',
      'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
      'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE',
      'TABLE', 'ALTER', 'DROP', 'INDEX', 'VIEW', 'TRIGGER', 'FUNCTION',
      'PROCEDURE', 'BEGIN', 'END', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
      'UNION', 'ALL', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
      'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'NULL', 'IS', 'CAST', 'AS'
    ];

    return keywords.map(keyword => ({
      label: keyword,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: keyword,
      range,
      sortText: '0' + keyword, // Keywords appear first
    }));
  }

  private getDatabaseFunctions(range: monaco.IRange): monaco.languages.CompletionItem[] {
    let functions: string[] = [];

    switch (this.dbType.toLowerCase()) {
      case 'postgres':
        functions = [
          'now()', 'current_timestamp', 'current_date', 'current_time',
          'date_part()', 'extract()', 'to_char()', 'to_date()', 'to_timestamp()',
          'coalesce()', 'nullif()', 'greatest()', 'least()', 'random()',
          'generate_series()', 'array_agg()', 'string_agg()', 'json_agg()',
          'jsonb_agg()', 'row_to_json()', 'json_build_object()', 'regexp_matches()',
          'regexp_replace()', 'regexp_split_to_array()', 'uuid_generate_v4()'
        ];
        break;
      case 'mysql':
      case 'mariadb':
        functions = [
          'NOW()', 'CURDATE()', 'CURTIME()', 'DATE_FORMAT()', 'STR_TO_DATE()',
          'CONCAT()', 'CONCAT_WS()', 'SUBSTRING()', 'LENGTH()', 'REPLACE()',
          'IFNULL()', 'COALESCE()', 'IF()', 'CASE', 'UUID()', 'RAND()',
          'GROUP_CONCAT()', 'JSON_OBJECT()', 'JSON_ARRAY()', 'JSON_EXTRACT()'
        ];
        break;
      case 'mssql':
        functions = [
          'GETDATE()', 'GETUTCDATE()', 'DATEPART()', 'DATENAME()', 'DATEADD()',
          'DATEDIFF()', 'FORMAT()', 'CONVERT()', 'CAST()', 'ISNULL()', 'COALESCE()',
          'IIF()', 'CHOOSE()', 'NEWID()', 'RAND()', 'STRING_AGG()', 'STUFF()',
          'FOR JSON PATH', 'FOR JSON AUTO', 'OPENJSON()', 'JSON_VALUE()'
        ];
        break;
      case 'sqlite':
        functions = [
          'date()', 'time()', 'datetime()', 'julianday()', 'strftime()',
          'substr()', 'length()', 'upper()', 'lower()', 'trim()', 'ltrim()',
          'rtrim()', 'replace()', 'ifnull()', 'coalesce()', 'nullif()',
          'random()', 'abs()', 'round()', 'max()', 'min()', 'avg()', 'sum()',
          'count()', 'group_concat()', 'json()', 'json_array()', 'json_object()'
        ];
        break;
    }

    return functions.map(func => ({
      label: func,
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: func,
      range,
      sortText: '1' + func,
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
    // Check if we're in a context where tables should be suggested
    const shouldSuggestTables = /\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+\S*$/i.test(textBeforeCursor);
    
    if (!shouldSuggestTables) {
      return [];
    }

    return schemaData.tables.map(table => ({
      label: table.name,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: table.name,
      detail: table.row_estimate && table.row_estimate > 0 
        ? `${table.kind} (~${table.row_estimate.toLocaleString()} rows)`
        : table.kind,
      documentation: table.schema ? `Schema: ${table.schema}` : undefined,
      range,
      sortText: '2' + table.name,
    }));
  }

  private getColumnSuggestions(
    schemaData: SchemaData,
    range: monaco.IRange,
    textBeforeCursor: string
  ): monaco.languages.CompletionItem[] {
    // Check if we're in a context where columns should be suggested
    const shouldSuggestColumns = /\b(SELECT|WHERE|ON|SET|ORDER\s+BY|GROUP\s+BY)\s+\S*$/i.test(textBeforeCursor);
    
    if (!shouldSuggestColumns) {
      return [];
    }

    const suggestions: monaco.languages.CompletionItem[] = [];

    // Try to detect table context from the query
    const tableMatch = textBeforeCursor.match(/\b(?:FROM|JOIN)\s+(\w+)/i);
    const tableName = tableMatch ? tableMatch[1] : null;

    if (tableName && schemaData.columns.has(tableName)) {
      // Suggest columns from specific table
      const columns = schemaData.columns.get(tableName)!;
      columns.forEach(col => {
        suggestions.push({
          label: col.name,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: col.name,
          detail: `${col.db_type}${col.nullable ? ' NULL' : ' NOT NULL'}`,
          documentation: col.default ? `Default: ${col.default}` : undefined,
          range,
          sortText: '3' + col.name,
        });
      });
    } else {
      // Suggest all columns with table prefix
      schemaData.columns.forEach((columns, tableName) => {
        columns.forEach(col => {
          suggestions.push({
            label: `${tableName}.${col.name}`,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: `${tableName}.${col.name}`,
            detail: col.db_type,
            range,
            sortText: '4' + tableName + col.name,
          });
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