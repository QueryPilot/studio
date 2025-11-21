import {
  Completion,
  CompletionContext,
  CompletionSource,
} from "@codemirror/autocomplete";
import { createSqlMetadataProvider } from "./metadataProvider";
import { analyzeSqlContext } from "./context";

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

    if (!connectionId || !database) {
      return null;
    }

    const defaultSchema = schema || "public";
    const provider = createSqlMetadataProvider(connectionId, defaultSchema);

    // Use AST-based context analysis
    const analysis = analyzeSqlContext(context, defaultSchema);
    const { intent, activeStatementTables, qualifier, range, isInsertContext, insertTargetTable } = analysis;

    try {
      // SPECIAL CASE: INSERT column list - only show target table's columns
      if (isInsertContext && insertTargetTable) {
        const fields = await provider.listFields(insertTargetTable);
        if (fields.length > 0) {
          return {
            from: range.from,
            options: mapFieldsToCompletions(fields),
            validFor: /^[\w_]*$/,
          };
        }
      }
      // SCENARIO A: Qualified field access (e.g., "u.id" or "users.id")
      if (intent === "column" && qualifier) {
        const matchedTable = activeStatementTables.find(
          (t) =>
            t.alias?.toLowerCase() === qualifier.toLowerCase() ||
            t.name.toLowerCase() === qualifier.toLowerCase()
        );

        if (matchedTable) {
          // CTE with explicit columns
          if (matchedTable.isCTE && matchedTable.cteColumns && matchedTable.cteColumns.length > 0) {
            return {
              from: range.from,
              options: matchedTable.cteColumns.map((colName) => ({
                label: colName,
                type: "property",
                detail: "CTE column",
                boost: 1,
              })),
              validFor: /^[\w_]*$/,
            };
          }

          // CTE with SELECT * - fetch from source table
          if (matchedTable.isCTE && matchedTable.cteSourceTable && !matchedTable.cteColumns) {
            const fields = await provider.listFields(matchedTable.cteSourceTable);
            if (fields.length > 0) {
              return {
                from: range.from,
                options: mapFieldsToCompletions(fields),
                validFor: /^[\w_]*$/,
              };
            }
          }

          // Regular table - fetch columns
          const fields = await provider.listFields(matchedTable.name, matchedTable.schema);
          if (fields.length > 0) {
            return {
              from: range.from,
              options: mapFieldsToCompletions(fields),
              validFor: /^[\w_]*$/,
            };
          }

          // Fallback: fetch from other tables in scope
          const otherTables = activeStatementTables.filter(
            (t) => t.name !== matchedTable.name && !t.isCTE
          );
          if (otherTables.length > 0) {
            const fieldPromises = otherTables.map((t) =>
              provider.listFields(t.name, t.schema).catch(() => [])
            );
            const results = await Promise.all(fieldPromises);
            const allFields = deduplicateFields(results.flat());

            if (allFields.length > 0) {
              return {
                from: range.from,
                options: mapFieldsToCompletions(allFields),
                validFor: /^[\w_]*$/,
              };
            }
          }
        }

        // Qualifier might be a schema name
        const entities = await provider.listEntities(qualifier);
        if (entities.length > 0) {
          return {
            from: range.from,
            options: mapEntitiesToCompletions(entities),
            validFor: /^[\w_]*$/,
          };
        }

        return null;
      }

      // SCENARIO B: Unqualified field (suggest from all scoped tables)
      if (intent === "column" && !qualifier) {
        const completions: Completion[] = [];

        // Fetch columns from all real tables in scope
        const realTables = activeStatementTables.filter((t) => !t.isCTE);
        if (realTables.length > 0) {
          const fieldPromises = realTables.map((t) =>
            provider.listFields(t.name, t.schema).catch(() => [])
          );
          const results = await Promise.all(fieldPromises);
          const allFields = deduplicateFields(results.flat());
          completions.push(...mapFieldsToCompletions(allFields));
        }

        // Also include table names
        const entities = await provider.listEntities();
        completions.push(...mapEntitiesToCompletions(entities));

        if (completions.length > 0) {
          return {
            from: range.from,
            options: completions,
            validFor: /^[\w_]*$/,
          };
        }
      }

      // SCENARIO C: Entity name expected (after FROM/JOIN)
      if (intent === "table") {
        const entities = await provider.listEntities();
        return {
          from: range.from,
          options: mapEntitiesToCompletions(entities),
          validFor: /^[\w_]*$/,
        };
      }
    } catch (err) {
      console.error("SQL completion error:", err);
    }

    return null;
  };
};

// Helper functions

function mapFieldsToCompletions(fields: Array<{ name: string; dataType: string; description?: string }>): Completion[] {
  return fields.map((f) => ({
    label: f.name,
    type: "property",
    detail: f.dataType,
    info: f.description,
    boost: 1,
  }));
}

function mapEntitiesToCompletions(entities: Array<{ name: string; type: string; schema?: string }>): Completion[] {
  return entities.map((e) => {
    // Generate smart alias: user_accounts -> ua, orders -> o
    const alias = generateSmartAlias(e.name);
    return {
      label: e.name,
      type: e.type === "table" ? "class" : "constant",
      detail: alias ? `→ ${alias}` : e.type,
      // Apply with alias for tables
      apply: e.type === "table" && alias ? `${e.name} ${alias}` : e.name,
      boost: 0,
    };
  });
}

function generateSmartAlias(tableName: string): string {
  // user_accounts -> ua, order_items -> oi
  if (tableName.includes('_')) {
    return tableName
      .split('_')
      .map(part => part[0] || '')
      .join('')
      .toLowerCase();
  }
  // Single word: users -> u, orders -> o
  return tableName[0]?.toLowerCase() || '';
}

function deduplicateFields<T extends { name: string }>(fields: T[]): T[] {
  const seen = new Set<string>();
  return fields.filter((f) => {
    const key = f.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Legacy export for backwards compatibility
export const clearCompletionCache = (_connectionId?: string) => {
  // No-op: schemaCache manages its own cache lifecycle
};
