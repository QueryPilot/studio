import {
  type Completion,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { createSqlMetadataProvider, SqlMetadataProvider } from "./metadataProvider";
import { analyzeSqlContext } from "./context";
import { searchFunctions, type SqlFunction } from "./functions";
import type { JoinConditionSuggestion } from "../../types";

interface CompletionOptions {
  connectionId?: string;
  database?: string;
  schema?: string;
  dialect?: string;
}

/**
 * Quote identifier based on SQL dialect
 */
function quoteIdentifier(name: string, dialect: string, alreadyQuoted: boolean = false): string {
  // Don't add quotes if already inside quotes
  if (alreadyQuoted) {
    return name;
  }

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

/**
 * Quote context info
 */
interface QuoteContext {
  isInside: boolean;       // Are we inside an unclosed quote?
  quoteChar: string | null; // The opening quote character (", `, [)
  needsClose: boolean;      // Does the quote need to be closed?
}

/**
 * Check if cursor is inside a quoted identifier and what quote type
 */
function getQuoteContext(context: CompletionContext): QuoteContext {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const lineText = line.text;
  const posInLine = pos - line.from;

  // Check for opening quote before cursor position
  const beforeCursor = lineText.slice(0, posInLine);
  const afterCursor = lineText.slice(posInLine);

  // Count quotes to determine if we're inside
  let inDoubleQuote = false;
  let inBacktick = false;
  let inBracket = false;

  for (let i = 0; i < beforeCursor.length; i++) {
    const char = beforeCursor[i];
    const prevChar = i > 0 ? beforeCursor[i - 1] : '';

    // Skip escaped quotes
    if (prevChar === '\\') continue;

    if (char === '"' && !inBacktick && !inBracket) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '`' && !inDoubleQuote && !inBracket) {
      inBacktick = !inBacktick;
    } else if (char === '[' && !inDoubleQuote && !inBacktick) {
      inBracket = true;
    } else if (char === ']' && inBracket) {
      inBracket = false;
    }
  }

  const isInside = inDoubleQuote || inBacktick || inBracket;
  let quoteChar: string | null = null;
  let needsClose = false;

  if (inDoubleQuote) {
    quoteChar = '"';
    // Check if there's a closing quote after cursor
    needsClose = !afterCursor.includes('"');
  } else if (inBacktick) {
    quoteChar = '`';
    needsClose = !afterCursor.includes('`');
  } else if (inBracket) {
    quoteChar = '[';
    needsClose = !afterCursor.includes(']');
  }

  return { isInside, quoteChar, needsClose };
}

/**
 * Get the closing quote character
 */
function getClosingQuote(openQuote: string | null): string {
  if (openQuote === '[') return ']';
  return openQuote || '';
}

export const createSqlCompletionSource = (
  options: CompletionOptions
): CompletionSource => {
  return async (context: CompletionContext) => {
    const { connectionId, database, schema, dialect = 'postgresql' } = options;

    if (!connectionId || !database) {
      return null;
    }

    // Check for special contexts that should trigger completion even without typing
    const word = context.matchBefore(/[\w_]+/);
    const afterDot = context.matchBefore(/\.\s*[\w_]*$/);
    
    // Check if we're in a JOIN ON context by looking at text before cursor
    // This is more reliable than matchBefore patterns
    const textBeforeCursor = context.state.doc.sliceString(
      Math.max(0, context.pos - 100), 
      context.pos
    );
    const isNearJoinOn = /\bJOIN\b.*\bON\s*$/i.test(textBeforeCursor);

    // Early return if not explicitly triggered and nothing useful to complete
    // But allow completion after '.', near JOIN ON, or when typing a word
    if (!context.explicit && !afterDot && !isNearJoinOn && (!word || word.text.length < 1)) {
      return null;
    }

    const defaultSchema = schema || "public";
    const provider = createSqlMetadataProvider(connectionId, defaultSchema);

    // Use AST-based context analysis
    const analysis = analyzeSqlContext(context, defaultSchema);
    const { intent, activeStatementTables, qualifier, range, isInsertContext, insertTargetTable, outerScopeTables, isJoinOnContext, joinTargetTable } = analysis;

    // Lazy quote context - only compute when needed
    let quoteCtx: QuoteContext | null = null;
    const getQuoteCtx = () => {
      if (!quoteCtx) {
        quoteCtx = getQuoteContext(context);
      }
      return quoteCtx;
    };

    try {
      // SPECIAL CASE: INSERT column list - only show target table's columns
      if (isInsertContext && insertTargetTable) {
        const fields = await provider.listFields(insertTargetTable);
        if (fields.length > 0) {
          return {
            from: range.from,
            options: mapFieldsToCompletions(fields, 1, undefined, dialect, getQuoteCtx()),
            validFor: /^[\w_]*$/,
          };
        }
      }

      // SCENARIO D: JOIN ON condition - suggest based on FK relationships
      // This handles: FROM a JOIN b ON |
      if (isJoinOnContext && joinTargetTable && joinTargetTable.name) {
        // Get tables that are already in scope (excluding the one we're joining)
        const tablesInScope = activeStatementTables.filter(
          (t) => t.name.toLowerCase() !== joinTargetTable.name.toLowerCase()
        );

        // Try to get FK-based suggestions if we have tables in scope
        if (tablesInScope.length > 0 && provider instanceof SqlMetadataProvider) {
          try {
            const conditions = await provider.getJoinConditions(
              tablesInScope.map((t) => ({ name: t.name, alias: t.alias, schema: t.schema })),
              { name: joinTargetTable.name, alias: joinTargetTable.alias, schema: joinTargetTable.schema },
              defaultSchema
            );

            if (conditions && conditions.length > 0) {
              return {
                from: range.from,
                options: mapJoinConditionsToCompletions(conditions),
                validFor: /^[\w_.=\s]*$/,
              };
            }
          } catch {
            // Ignore errors in FK lookup, fall through to fallback
          }
        }

        // Fallback: show table aliases for manual join condition construction
        // Include both tables in scope AND the join target table
        const allTables = [...tablesInScope];
        // Always add the join target if it has a valid name
        if (joinTargetTable.name) {
          allTables.push(joinTargetTable);
        }

        const completions: Completion[] = [];

        // Add table aliases for qualified access
        for (const table of allTables) {
          const aliasOrName = table.alias || table.name;
          if (aliasOrName) { // Only add if we have a valid name
            completions.push({
              label: aliasOrName,
              type: "class",
              detail: table.alias ? `alias → ${table.name}` : "table",
              boost: 10,
              apply: aliasOrName + ".",
            });
          }
        }

        // Always return something when in JOIN ON context
        if (completions.length > 0) {
          return {
            from: range.from,
            options: completions,
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
            const qCtx = getQuoteCtx();
            return {
              from: range.from,
              options: matchedTable.cteColumns.map((colName) => {
                let apply: string;
                if (qCtx.isInside) {
                  apply = qCtx.needsClose ? colName + getClosingQuote(qCtx.quoteChar) : colName;
                } else {
                  apply = quoteIdentifier(colName, dialect);
                }
                return {
                  label: colName,
                  type: "property",
                  detail: "CTE column",
                  boost: 1,
                  apply,
                };
              }),
              validFor: /^[\w_]*$/,
            };
          }

          // CTE with SELECT * - fetch from source table
          if (matchedTable.isCTE && matchedTable.cteSourceTable && !matchedTable.cteColumns) {
            const fields = await provider.listFields(matchedTable.cteSourceTable);
            if (fields.length > 0) {
              return {
                from: range.from,
                options: mapFieldsToCompletions(fields, 10, undefined, dialect, getQuoteCtx()),
                validFor: /^[\w_]*$/,
              };
            }
          }

          // Regular table - fetch columns
          const fields = await provider.listFields(matchedTable.name, matchedTable.schema);
          if (fields.length > 0) {
            return {
              from: range.from,
              options: mapFieldsToCompletions(fields, 10, undefined, dialect, getQuoteCtx()),
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
                options: mapFieldsToCompletions(allFields, 1, undefined, dialect, getQuoteCtx()),
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
            options: mapEntitiesToCompletions(entities, dialect, getQuoteCtx()),
            validFor: /^[\w_]*$/,
          };
        }

        return null;
      }

      // SCENARIO B: Unqualified field (suggest from all scoped tables)
      if (intent === "column" && !qualifier) {
        const completions: Completion[] = [];

        // Add table/CTE aliases with highest priority for qualified access
        // This allows typing "cmcr" to get "cmcr." completion
        for (const table of activeStatementTables) {
          const aliasOrName = table.alias || table.name;
          completions.push({
            label: aliasOrName,
            type: table.isCTE ? "constant" : "class",
            detail: table.alias ? `alias → ${table.name}` : (table.isCTE ? "CTE" : "table"),
            boost: 2, // Higher than columns to show aliases first
            apply: aliasOrName + ".", // Add dot for qualified access
          });
        }

        // Fetch columns from all real tables in current scope (high boost)
        const realTables = activeStatementTables.filter((t) => !t.isCTE);
        if (realTables.length > 0) {
          const fieldPromises = realTables.map((t) =>
            provider.listFields(t.name, t.schema).catch(() => [])
          );
          const results = await Promise.all(fieldPromises);
          const allFields = deduplicateFields(results.flat());
          completions.push(...mapFieldsToCompletions(allFields, 1, undefined, dialect, getQuoteCtx()));
        }

        // Also include outer scope tables for correlated subqueries (lower boost)
        if (outerScopeTables && outerScopeTables.length > 0) {
          // Add outer scope aliases
          for (const table of outerScopeTables) {
            const aliasOrName = table.alias || table.name;
            completions.push({
              label: aliasOrName,
              type: table.isCTE ? "constant" : "class",
              detail: `(outer) ${table.alias ? `alias → ${table.name}` : (table.isCTE ? "CTE" : "table")}`,
              boost: 0.5,
              apply: aliasOrName + ".",
            });
          }

          const outerRealTables = outerScopeTables.filter((t) => !t.isCTE);
          if (outerRealTables.length > 0) {
            const outerFieldPromises = outerRealTables.map((t) =>
              provider.listFields(t.name, t.schema).catch(() => [])
            );
            const outerResults = await Promise.all(outerFieldPromises);
            const outerFields = deduplicateFields(outerResults.flat());
            // Add with lower boost to prioritize current scope
            completions.push(...mapFieldsToCompletions(outerFields, -1, "(outer)", dialect, getQuoteCtx()));
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
        completions.push(...mapEntitiesToCompletions(entities, dialect, getQuoteCtx()));

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
          options: mapEntitiesToCompletions(entities, dialect, getQuoteCtx()),
          validFor: /^[\w_]*$/,
        };
      }
    } catch {
      // Silently ignore errors - common during typing
    }

    return null;
  };
};

// Helper functions

function mapFieldsToCompletions(
  fields: Array<{ name: string; dataType: string; description?: string }>,
  boost: number = 1,
  suffix?: string,
  dialect: string = 'postgresql',
  quoteCtx?: QuoteContext
): Completion[] {
  return fields.map((f) => {
    let apply: string;
    if (quoteCtx && quoteCtx.isInside) {
      // Inside quotes - just insert the name, add closing quote if needed
      apply = quoteCtx.needsClose ? f.name + getClosingQuote(quoteCtx.quoteChar) : f.name;
    } else {
      // Not inside quotes - add full quoting
      apply = quoteIdentifier(f.name, dialect);
    }

    return {
      label: f.name,
      type: "property",
      detail: suffix ? `${f.dataType} ${suffix}` : f.dataType,
      info: f.description,
      boost,
      apply,
    };
  });
}

function mapEntitiesToCompletions(
  entities: Array<{ name: string; type: string; schema?: string }>,
  dialect: string = 'postgresql',
  quoteCtx?: QuoteContext
): Completion[] {
  return entities.map((e) => {
    // Generate smart alias: user_accounts -> ua, orders -> o
    const alias = generateSmartAlias(e.name);

    let apply: string;
    if (quoteCtx && quoteCtx.isInside) {
      // Inside quotes - just insert the name, add closing quote if needed
      const name = quoteCtx.needsClose ? e.name + getClosingQuote(quoteCtx.quoteChar) : e.name;
      // Don't add alias when inside quotes
      apply = name;
    } else {
      // Not inside quotes - add full quoting and alias
      const quotedName = quoteIdentifier(e.name, dialect);
      apply = e.type === "table" && alias ? `${quotedName} ${alias}` : quotedName;
    }

    return {
      label: e.name,
      type: e.type === "table" ? "class" : "constant",
      detail: alias ? `→ ${alias}` : e.type,
      apply,
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

/**
 * Map JOIN condition suggestions to completions
 */
function mapJoinConditionsToCompletions(conditions: JoinConditionSuggestion[]): Completion[] {
  return conditions.map((c, index) => ({
    label: c.condition,
    type: "text",
    detail: c.description,
    info: c.source === "fk" 
      ? "Based on foreign key relationship" 
      : "Based on column name matching",
    boost: c.score - index, // Preserve order based on score
    apply: c.condition,
  }));
}

// Legacy export for backwards compatibility
export const clearCompletionCache = (_connectionId?: string) => {
  // No-op: schemaCache manages its own cache lifecycle
};
