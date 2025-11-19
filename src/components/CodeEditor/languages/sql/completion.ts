import {
  Completion,
  CompletionContext,
  CompletionSource,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { databaseService } from "@/services/databaseService";

// Cache for table columns to avoid redundant fetches
// Key: connectionId:database:schema:table
const columnCache = new Map<string, Completion[]>();

// Cache for table lists
// Key: connectionId:database:schema
const tableCache = new Map<string, Completion[]>();

// Helper to clear cache (can be exported if needed)
export const clearCompletionCache = (connectionId?: string) => {
  if (connectionId) {
    for (const key of columnCache.keys()) {
      if (key.startsWith(`${connectionId}:`)) columnCache.delete(key);
    }
    for (const key of tableCache.keys()) {
      if (key.startsWith(`${connectionId}:`)) tableCache.delete(key);
    }
  } else {
    columnCache.clear();
    tableCache.clear();
  }
};

interface CompletionOptions {
  connectionId?: string;
  database?: string;
  schema?: string;
}

export const createSqlCompletionSource = (
  options: CompletionOptions
): CompletionSource => {
  return async (context: CompletionContext) => {
    const { connectionId, database, schema } = options;

    // If no connection context, we can't provide intelligent suggestions
    if (!connectionId || !database) {
      return null;
    }

    const word = context.matchBefore(/[\w_]*$/);
    const from = word ? word.from : context.pos;
    const to = context.pos;

    // Check if we are after a dot (column completion)
    const dotBefore = context.matchBefore(/([a-zA-Z0-9_]+)\.\s*[\w_]*$/);

    if (dotBefore) {
      // We are likely completing a column
      // Extract table name (and possibly schema)
      // Logic: match ends with "TableName.PartialColumn" or "Schema.Table.PartialColumn"
      const textBefore = context.state.sliceDoc(dotBefore.from, context.pos);
      const parts = textBefore.split(".");
      
      let tableName = "";
      let schemaName = schema || "public"; // Default schema
      let partialColumn = "";

      if (parts.length === 2) {
        // Format: Table.Column
        tableName = parts[0].trim();
        partialColumn = parts[1].trim();
      } else if (parts.length === 3) {
        // Format: Schema.Table.Column
        schemaName = parts[0].trim();
        tableName = parts[1].trim();
        partialColumn = parts[2].trim();
      } else {
        return null; // Too complex or invalid
      }

      // Check cache for columns
      const cacheKey = `${connectionId}:${database}:${schemaName}:${tableName}`;
      
      if (columnCache.has(cacheKey)) {
        return {
          from,
          options: columnCache.get(cacheKey)!,
          validFor: /^[\w_]*$/,
        };
      }

      // Fetch columns
      try {
        const columns = await databaseService.getTableColumns(
          connectionId,
          database,
          schemaName,
          tableName
        );

        const completions: Completion[] = columns.map((col) => ({
          label: col.name,
          type: "property",
          detail: col.db_type,
          info: col.comment || undefined,
          boost: 1, // Boost columns over keywords
        }));

        // Add "Magic" columns if requested (simple implementation)
        // completions.push({ label: `${col.name}__format__`, ... })

        columnCache.set(cacheKey, completions);

        return {
          from,
          options: completions,
          validFor: /^[\w_]*$/,
        };
      } catch (err) {
        console.error("Failed to fetch columns for completion", err);
        return null;
      }
    }

    // If not after a dot, check if we should suggest Tables
    // Simple heuristic: Start of line, or after keywords like FROM, JOIN, UPDATE, INTO
    // Or just always suggest tables mixed with keywords?
    // CodeMirror's default SQL completion provides keywords.
    // We want to ADD tables.

    // Check cache for tables
    const tableCacheKey = `${connectionId}:${database}:${schema || "public"}`;
    
    if (tableCache.has(tableCacheKey)) {
      return {
        from,
        options: tableCache.get(tableCacheKey)!,
        validFor: /^[\w_]*$/,
      };
    }

    // Fetch tables
    try {
      const tables = await databaseService.listTables(
        connectionId,
        database,
        schema || "public"
      );

      const tableCompletions: Completion[] = tables.map((t) => ({
        label: t.name,
        type: t.kind === "Table" ? "class" : "constant", // visual distinction
        detail: t.kind,
        boost: 0, // Let keywords take precedence if matched, or equal
      }));

      tableCache.set(tableCacheKey, tableCompletions);

      return {
        from,
        options: tableCompletions,
        validFor: /^[\w_]*$/,
      };
    } catch (err) {
      // console.warn("Failed to fetch tables for completion", err); // Silent fail
      return null;
    }
  };
};

