import {
  Completion,
  CompletionContext,
  CompletionSource,
} from "@codemirror/autocomplete";
import { createSqlMetadataProvider } from "./metadataProvider";
import { analyzeSqlContext } from "./context";
import { searchFunctions, type SqlFunction } from "./functions";

interface CompletionOptions {
  connectionId?: string;
  database?: string;
  schema?: string;
  dialect?: string;
}

/**
 * Quote identifier based on SQL dialect
 */
function quoteIdentifier(name: string, dialect: string): string {
  switch (dialect) {
    case 'mysql':
      return `\`${name}\``;
    case 'mssql':
      return `[${name}]`;
    case 'postgresql':
    case 'sqlite':
    default:
      return `"${name}"`;
  }
}

export const createSqlCompletionSource = (
  options: CompletionOptions
): CompletionSource => {
  return async (context: CompletionContext) => {
    const { connectionId, database, schema, dialect = 'postgresql' } = options;

    if (!connectionId || !database) {
      return null;
    }

    const defaultSchema = schema || "public";
    const provider = createSqlMetadataProvider(connectionId, defaultSchema);

    // Use AST-based context analysis
    const analysis = analyzeSqlContext(context, defaultSchema);
    const { intent, activeStatementTables, qualifier, range, isInsertContext, insertTargetTable, outerScopeTables } = analysis;

    try {
      // SPECIAL CASE: INSERT column list - only show target table's columns
      if (isInsertContext && insertTargetTable) {
        const fields = await provider.listFields(insertTargetTable);
        if (fields.length > 0) {
          return {
            from: range.from,
            options: mapFieldsToCompletions(fields, 1, undefined, dialect),
            validFor: /^[\w_]*$/,
          };
        }
      }
      // SCENARIO A: Qualified field access (e.g., "u.id" or "users.id")
      if (intent === "column" && qualifier) {
        // First check current scope tables
        let matchedTable = activeStatementTables.find(
          (t) =>
            t.alias?.toLowerCase() === qualifier.toLowerCase() ||
            t.name.toLowerCase() === qualifier.toLowerCase()
        );

        // If not found in current scope, check outer scope (for correlated subqueries)
        if (!matchedTable && outerScopeTables) {
          matchedTable = outerScopeTables.find(
            (t) =>
              t.alias?.toLowerCase() === qualifier.toLowerCase() ||
              t.name.toLowerCase() === qualifier.toLowerCase()
          );
        }

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
                apply: quoteIdentifier(colName, dialect),
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
                options: mapFieldsToCompletions(fields, 1, undefined, dialect),
                validFor: /^[\w_]*$/,
              };
            }
          }

          // Regular table - fetch columns
          const fields = await provider.listFields(matchedTable.name, matchedTable.schema);
          if (fields.length > 0) {
            return {
              from: range.from,
              options: mapFieldsToCompletions(fields, 1, undefined, dialect),
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
                options: mapFieldsToCompletions(allFields, 1, undefined, dialect),
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
            options: mapEntitiesToCompletions(entities, dialect),
            validFor: /^[\w_]*$/,
          };
        }

        return null;
      }

      // SCENARIO B: Unqualified field (suggest from all scoped tables)
      if (intent === "column" && !qualifier) {
        const completions: Completion[] = [];

        // Fetch columns from all real tables in current scope (high boost)
        const realTables = activeStatementTables.filter((t) => !t.isCTE);
        if (realTables.length > 0) {
          const fieldPromises = realTables.map((t) =>
            provider.listFields(t.name, t.schema).catch(() => [])
          );
          const results = await Promise.all(fieldPromises);
          const allFields = deduplicateFields(results.flat());
          completions.push(...mapFieldsToCompletions(allFields, 1, undefined, dialect));
        }

        // Also include outer scope tables for correlated subqueries (lower boost)
        if (outerScopeTables && outerScopeTables.length > 0) {
          const outerRealTables = outerScopeTables.filter((t) => !t.isCTE);
          if (outerRealTables.length > 0) {
            const outerFieldPromises = outerRealTables.map((t) =>
              provider.listFields(t.name, t.schema).catch(() => [])
            );
            const outerResults = await Promise.all(outerFieldPromises);
            const outerFields = deduplicateFields(outerResults.flat());
            // Add with lower boost to prioritize current scope
            completions.push(...mapFieldsToCompletions(outerFields, -1, "(outer)", dialect));
          }
        }

        // Include SQL functions with signatures
        const { identifier } = analysis;
        if (identifier.length >= 2) {
          const matchingFunctions = searchFunctions(identifier);
          completions.push(...mapFunctionsToCompletions(matchingFunctions, 0.5));
        }

        // Also include table names
        const entities = await provider.listEntities();
        completions.push(...mapEntitiesToCompletions(entities, dialect));

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
          options: mapEntitiesToCompletions(entities, dialect),
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

function mapFieldsToCompletions(
  fields: Array<{ name: string; dataType: string; description?: string }>,
  boost: number = 1,
  suffix?: string,
  dialect: string = 'postgresql'
): Completion[] {
  return fields.map((f) => ({
    label: f.name,
    type: "property",
    detail: suffix ? `${f.dataType} ${suffix}` : f.dataType,
    info: f.description,
    boost,
    apply: quoteIdentifier(f.name, dialect),
  }));
}

function mapEntitiesToCompletions(
  entities: Array<{ name: string; type: string; schema?: string }>,
  dialect: string = 'postgresql'
): Completion[] {
  return entities.map((e) => {
    // Generate smart alias: user_accounts -> ua, orders -> o
    const alias = generateSmartAlias(e.name);
    const quotedName = quoteIdentifier(e.name, dialect);
    return {
      label: e.name,
      type: e.type === "table" ? "class" : "constant",
      detail: alias ? `→ ${alias}` : e.type,
      // Apply with alias for tables
      apply: e.type === "table" && alias ? `${quotedName} ${alias}` : quotedName,
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

/**
 * Map SQL functions to completions with signatures
 */
function mapFunctionsToCompletions(functions: SqlFunction[], boost: number = 0.5): Completion[] {
  return functions.map((fn) => ({
    label: fn.name,
    type: "function",
    detail: fn.signature,
    info: `${fn.description}\n\nReturns: ${fn.returnType}`,
    apply: fn.parameters.length === 0 ? `${fn.name}()` : `${fn.name}(`,
    boost,
  }));
}

// Legacy export for backwards compatibility
export const clearCompletionCache = (_connectionId?: string) => {
  // No-op: schemaCache manages its own cache lifecycle
};
