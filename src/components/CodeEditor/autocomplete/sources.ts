import type {
  Completion,
  CompletionSource,
  CompletionContext,
} from "@codemirror/autocomplete";
// (No direct import needed here; enum values provided via schemaCache)
import { schemaCache } from "@/services/schemaCache";
import type { QueryContext } from "./parser";
import { fuzzyMatch } from "@/utils/fuzzyMatch";
import { relationshipService } from "@/services/relationshipService";
import { SQL_FUNCTIONS, getFunctionsForDialect } from "@/data/sqlFunctions";
import { getValueSuggestionsForColumn } from "./valueSuggestions";
import { SQL_SNIPPETS } from "@/data/sqlSnippets";
import { createSnippetCompletion } from "./snippetHandler";

type DbType = "PostgreSQL" | "MySQL" | "SQLite" | "MSSQL";

interface RankedCompletion extends Completion {
  score: number;
}

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "ALL",
  "DISTINCT",
  "AS",
  "ON",
  "AND",
  "OR",
  "NOT",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "IS",
  "NULL",
  "ASC",
  "DESC",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "ALTER",
  "DROP",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "INDEX",
  "UNIQUE",
  "DEFAULT",
  "CHECK",
  "CONSTRAINT",
  "CASCADE",
  "RESTRICT",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
];

const DIALECT_CONFIG: Record<
  DbType,
  {
    quoteChar: string;
    escapeChar: string;
    identifierQuotes: [string, string] | string;
    hasSchemas: boolean;
    hasDatabases: boolean;
    defaultSchema: string | null;
    needsQuoting: (name: string) => boolean;
    keywords: string[];
  }
> = {
  PostgreSQL: {
    quoteChar: '"',
    escapeChar: '""',
    identifierQuotes: '"',
    hasSchemas: true,
    hasDatabases: true,
    defaultSchema: "public",
    needsQuoting: (name: string) => {
      return (
        /[A-Z]/.test(name) ||
        /^\d/.test(name) ||
        /[^a-z0-9_]/.test(name) ||
        isPostgreSQLKeyword(name)
      );
    },
    keywords: ["RETURNING", "ARRAY", "JSON", "JSONB"],
  },
  MySQL: {
    quoteChar: "`",
    escapeChar: "``",
    identifierQuotes: "`",
    hasSchemas: true,
    hasDatabases: true,
    defaultSchema: null,
    needsQuoting: (name: string) => {
      return (
        /[^a-zA-Z0-9_$]/.test(name) || /^\d/.test(name) || isMySQLKeyword(name)
      );
    },
    keywords: ["AUTO_INCREMENT", "UNSIGNED"],
  },
  SQLite: {
    quoteChar: '"',
    escapeChar: '""',
    identifierQuotes: '"',
    hasSchemas: false,
    hasDatabases: false,
    defaultSchema: "main",
    needsQuoting: (name: string) => {
      return (
        /[^a-zA-Z0-9_]/.test(name) || /^\d/.test(name) || isSQLiteKeyword(name)
      );
    },
    keywords: ["AUTOINCREMENT", "PRAGMA"],
  },
  MSSQL: {
    quoteChar: "[",
    escapeChar: "]]",
    identifierQuotes: ["[", "]"],
    hasSchemas: true,
    hasDatabases: true,
    defaultSchema: "dbo",
    needsQuoting: (name: string) => {
      return (
        /[^a-zA-Z0-9_]/.test(name) || /^\d/.test(name) || isMSSQLKeyword(name)
      );
    },
    keywords: ["IDENTITY", "TOP", "OUTPUT"],
  },
};

function isPostgreSQLKeyword(word: string): boolean {
  const keywords = new Set(["USER", "TABLE", "COLUMN", "INDEX", "VIEW"]);
  return keywords.has(word.toUpperCase());
}

function isMySQLKeyword(word: string): boolean {
  const keywords = new Set(["KEY", "INDEX", "CHECK"]);
  return keywords.has(word.toUpperCase());
}

function isSQLiteKeyword(word: string): boolean {
  const keywords = new Set(["ROWID", "TEMP"]);
  return keywords.has(word.toUpperCase());
}

function isMSSQLKeyword(word: string): boolean {
  const keywords = new Set(["IDENTITY", "COMPUTED"]);
  return keywords.has(word.toUpperCase());
}

function quoteIdentifier(name: string, dbType: DbType): string {
  const config = DIALECT_CONFIG[dbType];
  if (!config.needsQuoting(name)) {
    return name;
  }

  if (typeof config.identifierQuotes === "string") {
    return `${config.identifierQuotes}${name}${config.identifierQuotes}`;
  } else {
    return `${config.identifierQuotes[0]}${name}${config.identifierQuotes[1]}`;
  }
}

/**
 * Helper to check if a string matches the current word using fuzzy matching
 */
function matchesQuery(
  text: string,
  query: string,
): {
  matches: boolean;
  score: number;
} {
  if (!query) {
    return { matches: true, score: 0 };
  }
  const result = fuzzyMatch(query, text, false);
  return { matches: result.matches, score: result.score };
}

export function createContextualCompletionSource(params: {
  connectionId: string;
  dbType: DbType;
  parser: { parseContext: (state: any, pos: number) => QueryContext };
  database?: string;
  schema?: string;
}): CompletionSource {
  const { connectionId, dbType, parser, schema } = params;

  // Per-session fast path cache for recently built column completions
  const columnFastCache = new Map<
    string,
    { cols: RankedCompletion[]; ts: number }
  >();
  const COLUMN_FASTCACHE_TTL = 10_000; // 10 seconds
  const prefetchTs = new Map<string, number>();
  const PREFETCH_TTL = 3_000; // 3 seconds between prefetch attempts

  return async (context: CompletionContext) => {
    try {
      // Update schema cache connection on every call (handles tab switching)
      schemaCache.setConnection(connectionId);

      // Parse context using AST
      const queryContext = parser.parseContext(context.state, context.pos);

      // Don't suggest in strings or comments
      if (queryContext.isInString || queryContext.isInComment) {
        return null;
      }

      const fullText = context.state.doc.toString();
      const textBefore = fullText.slice(
        Math.max(0, context.pos - 500),
        context.pos,
      );
      const textBeforeLower = textBefore.toLowerCase();

      // Get the current word being typed
      const word = context.matchBefore(/[\w.]*/) || {
        from: context.pos,
        text: "",
      };
      const currentWord = word.text.toLowerCase();

      // Use schema from config or query context, with proper fallback
      const effectiveSchema =
        schema ||
        queryContext.currentSchema ||
        DIALECT_CONFIG[dbType].defaultSchema ||
        "public";

      let completions: RankedCompletion[] = [];

      // Performance limits
      const MAX_COMPLETIONS = 50;
      const MAX_COLUMNS_PER_TABLE = 20;

      // Background prefetch for columns of tables already in scope
      if (queryContext.tablesInScope.length > 0) {
        const now = Date.now();
        for (const t of queryContext.tablesInScope) {
          const s = t.schema || effectiveSchema;
          const key = `${connectionId}:${s}.${t.table}`;
          if (
            !columnFastCache.has(key) &&
            now - (prefetchTs.get(key) || 0) > PREFETCH_TTL
          ) {
            prefetchTs.set(key, now);
            // Intentionally fire-and-forget to warm up cache
            void schemaCache
              .getTableColumns(connectionId, s, t.table)
              .then((cols) => {
                const built: RankedCompletion[] = cols
                  .slice(0, MAX_COLUMNS_PER_TABLE)
                  .map((col) => ({
                    label: col.name,
                    apply: quoteIdentifier(col.name, dbType),
                    type: "property",
                    detail: col.db_type,
                    score: 200,
                  }));
                columnFastCache.set(key, { cols: built, ts: Date.now() });
              })
              .catch(() => {
                // ignore prefetch errors
              });
          }
        }
      }

      // 1. Handle table.column pattern (highest priority)
      // Updated pattern to handle more cases:
      // - After operators: WHERE id=u.
      // - Quoted identifiers: "User Table".
      // - Case insensitive matching
      const tableColumnMatch = /([a-zA-Z_][\w."]*?)\.(\w*)$/.exec(textBefore);
      if (
        tableColumnMatch &&
        tableColumnMatch[1] &&
        tableColumnMatch[2] !== undefined
      ) {
        // Sanitize alias/table by trimming trailing dots/spaces, e.g. "u." -> "u"
        const rawAlias = tableColumnMatch[1].toLowerCase();
        const tableOrAlias = rawAlias.replace(/[\s.]+$/g, "");
        const partialColumn = tableColumnMatch[2]
          ? tableColumnMatch[2].toLowerCase()
          : "";

        console.debug(
          `[Autocomplete] Table.Column pattern matched! textBefore="${textBefore.slice(
            -50,
          )}"`,
          `tableOrAlias="${tableOrAlias}" partialColumn="${partialColumn}"`,
        );

        // First check aliases from AST
        let tableName: string | undefined;
        let schemaName: string | undefined;

        console.debug(
          `[Autocomplete] Looking up alias/table: raw='${rawAlias}' sanitized='${tableOrAlias}'`,
          `Known aliases:`,
          Array.from(queryContext.aliases.keys()),
        );

        if (queryContext.aliases.has(tableOrAlias)) {
          const tableRef = queryContext.aliases.get(tableOrAlias);
          tableName = tableRef?.table;
          schemaName = tableRef?.schema;
          console.debug(
            `[Autocomplete] Found alias ${tableOrAlias} -> ${tableName}`,
          );
        } else {
          // Check tables in scope by name (not alias)
          const tableInScope = queryContext.tablesInScope.find(
            (t) => t.table.toLowerCase() === tableOrAlias,
          );
          if (tableInScope) {
            tableName = tableInScope.table;
            schemaName = tableInScope.schema;
          } else {
            // Try to get it from schema cache as a direct table reference
            try {
              const tables = await schemaCache.getTables(
                connectionId,
                effectiveSchema,
              );
              const matchedTable = tables.find(
                (t) => t.name.toLowerCase() === tableOrAlias,
              );
              if (matchedTable) {
                tableName = matchedTable.name;
                schemaName = effectiveSchema;
              }
            } catch {
              // Fallback: assume it's a table name
              tableName = tableOrAlias;
              schemaName = effectiveSchema;
            }
          }
        }

        if (tableName) {
          try {
            const effective = schemaName || effectiveSchema;
            const fastKey = `${connectionId}:${effective}.${tableName}`;
            const now = Date.now();
            const cached = columnFastCache.get(fastKey);

            if (cached && now - cached.ts < COLUMN_FASTCACHE_TTL) {
              console.debug(
                `[Autocomplete] Using cached columns for ${tableOrAlias}, filtering with "${partialColumn}"`,
                `All columns:`,
                cached.cols.map((c) => c.label).join(", "),
              );

              const allCols = cached.cols
                .map((c) => {
                  const match = matchesQuery(c.label, partialColumn);
                  return {
                    ...c,
                    matches: match.matches,
                    score: c.score + match.score,
                  };
                })
                .filter((c) => c.matches);

              console.debug(
                `[Autocomplete] Matched columns: ${allCols
                  .map((c) => c.label)
                  .join(", ")} (${allCols.length}/${cached.cols.length})`,
              );
              completions = allCols;
            } else {
              console.debug(
                `[Autocomplete] Fetching columns for ${tableName} (schema: ${effective}, alias: ${tableOrAlias})`,
              );
              const columns = await schemaCache.getTableColumns(
                connectionId,
                effective,
                tableName,
              );

              console.debug(
                `[Autocomplete] Found ${columns.length} columns for ${tableName}`,
                `Column names:`,
                columns.map((c) => c.name).join(", "),
              );

              const built: RankedCompletion[] = columns
                .slice(0, MAX_COLUMNS_PER_TABLE)
                .map((col) => ({
                  label: col.name,
                  apply: quoteIdentifier(col.name, dbType),
                  type: "property",
                  detail: col.db_type,
                  score: 200,
                }));
              columnFastCache.set(fastKey, { cols: built, ts: now });
              const matched = built
                .map((c) => {
                  const match = matchesQuery(c.label, partialColumn);
                  return {
                    ...c,
                    matches: match.matches,
                    score: c.score + match.score,
                  };
                })
                .filter((c) => c.matches);

              console.debug(
                `[Autocomplete] Matched columns: ${matched
                  .map((c) => c.label)
                  .join(", ")} (${matched.length}/${
                  built.length
                }) for "${partialColumn}"`,
              );
              completions = matched;
            }

            // Add * for SELECT clause
            if (
              queryContext.currentClause === "SELECT" &&
              (!partialColumn || "*".startsWith(partialColumn))
            ) {
              completions.unshift({
                label: "*",
                type: "keyword",
                detail: "all columns",
                score: 250,
              });
            }

            const finalOptions = completions.slice(0, MAX_COMPLETIONS);
            console.debug(
              `[Autocomplete] Returning ${finalOptions.length} suggestions for ${tableOrAlias}.${partialColumn}`,
              `Options:`,
              finalOptions.map((c) => `${c.label}(${c.score})`).join(", "),
            );

            // Always return when we have a table.column pattern match
            // Even if empty, to prevent fallthrough to other suggestions
            return {
              from: word.from + tableOrAlias.length + 1,
              options: finalOptions,
              validFor: /^[\w.]*$/,
            };
          } catch (error) {
            console.warn(
              `[Autocomplete] Error fetching columns for ${tableName}:`,
              error,
            );
            // Return empty suggestions instead of falling through
            return {
              from: word.from + tableOrAlias.length + 1,
              options: [],
              validFor: /^[\w.]*$/,
            };
          }
        } else {
          console.debug(
            `[Autocomplete] Could not resolve table/alias: ${tableOrAlias}`,
          );
        }
      }

      // 2. Handle context-based completions using AST
      switch (queryContext.currentClause) {
        case "SELECT":
          // In SELECT clause
          if (queryContext.tablesInScope.length > 0) {
            // We have tables, suggest columns
            for (const table of queryContext.tablesInScope) {
              try {
                const columns = await schemaCache.getTableColumns(
                  connectionId,
                  table.schema || effectiveSchema,
                  table.table,
                );

                // Add columns - prioritize qualified if multiple tables in scope
                const useQualified = queryContext.tablesInScope.length > 1;
                for (const col of columns) {
                  const colMatch = matchesQuery(col.name, currentWord);
                  if (colMatch.matches) {
                    if (useQualified) {
                      // Add qualified version when multiple tables
                      const prefix = table.alias || table.table;
                      completions.push({
                        label: `${prefix}.${col.name}`,
                        apply: `${quoteIdentifier(
                          prefix,
                          dbType,
                        )}.${quoteIdentifier(col.name, dbType)}`,
                        type: "property",
                        detail: col.db_type,
                        score: 100 + colMatch.score,
                      });
                    } else {
                      // Add unqualified when single table
                      completions.push({
                        label: col.name,
                        apply: quoteIdentifier(col.name, dbType),
                        type: "property",
                        detail: col.db_type,
                        score: 100 + colMatch.score,
                      });
                    }
                  }
                }
              } catch (error) {
                console.debug("Failed to get columns:", error);
              }
            }

            // Add SQL functions (aggregate, window, string, etc.)
            const dialectFunctions = getFunctionsForDialect(dbType);
            for (const func of dialectFunctions) {
              const funcMatch = matchesQuery(func.name, currentWord);
              if (funcMatch.matches) {
                // Build function signature for display
                const params = func.parameters
                  .map((p) => (p.optional ? `[${p.name}]` : p.name))
                  .join(", ");
                const signature = `${func.name}(${params})`;

                completions.push({
                  label: func.name,
                  apply: `${func.name}()`,
                  type: "function",
                  detail: func.category,
                  info: `${signature}\n\n${func.description}${
                    func.example ? `\n\nExample: ${func.example}` : ""
                  }`,
                  score:
                    func.category === "aggregate"
                      ? 90 + funcMatch.score
                      : 70 + funcMatch.score,
                });
              }
            }
          } else {
            // No tables yet, suggest FROM
            if (!currentWord || "from".startsWith(currentWord)) {
              completions.push({
                label: "FROM",
                type: "keyword",
                score: 1000,
              });
            }
          }
          break;

        case "FROM":
          // In FROM clause, suggest tables and CTEs
          try {
            const tables = await schemaCache.getTables(
              connectionId,
              effectiveSchema,
            );

            completions = tables
              .map((table) => {
                const match = matchesQuery(table.name, currentWord);
                return {
                  label: table.name,
                  apply: quoteIdentifier(table.name, dbType),
                  type: "type",
                  detail: "table",
                  score: 100 + match.score,
                  matches: match.matches,
                };
              })
              .filter((item) => item.matches);

            // Add CTEs to table suggestions
            for (const [cteName] of queryContext.ctes) {
              const match = matchesQuery(cteName, currentWord);
              if (match.matches) {
                completions.push({
                  label: cteName,
                  apply: quoteIdentifier(cteName, dbType),
                  type: "type",
                  detail: "CTE",
                  score: 110 + match.score, // Higher priority than regular tables
                });
              }
            }
          } catch (error) {
            console.debug("Failed to get tables:", error);
          }
          break;

        case "WHERE":
        case "HAVING":
          // In WHERE/HAVING clause
          if (queryContext.tablesInScope.length > 0) {
            // Add columns from all tables in scope
            for (const table of queryContext.tablesInScope) {
              try {
                const columns = await schemaCache.getTableColumns(
                  connectionId,
                  table.schema || effectiveSchema,
                  table.table,
                );

                for (const col of columns) {
                  const match = matchesQuery(col.name, currentWord);
                  if (match.matches) {
                    completions.push({
                      label: col.name,
                      apply: quoteIdentifier(col.name, dbType),
                      type: "property",
                      detail: col.db_type,
                      score: 70 + match.score,
                    });
                  }
                }

                // Only add table prefix suggestions if not already typing one
                // (avoid duplicating: user types "u" → sees "users." → selects → gets "u.users.")
                if (!textBefore.match(/[a-zA-Z_][\w.]*\.$/)) {
                  const prefix = table.alias || table.table;
                  const match = matchesQuery(prefix, currentWord);
                  if (match.matches) {
                    completions.push({
                      label: `${prefix}.`,
                      apply: `${quoteIdentifier(prefix, dbType)}.`,
                      type: "variable",
                      detail: table.alias ? "alias" : "table",
                      score: 90 + match.score,
                    });
                  }
                }
              } catch (error) {
                console.debug("Failed to get columns:", error);
              }
            }

            // Add operators
            const operators = [
              "=",
              "!=",
              "<>",
              ">",
              "<",
              ">=",
              "<=",
              "LIKE",
              "IN",
              "NOT IN",
              "IS NULL",
              "IS NOT NULL",
            ];
            for (const op of operators) {
              if (!currentWord || op.toLowerCase().startsWith(currentWord)) {
                completions.push({
                  label: op,
                  type: "operator",
                  score: 60,
                });
              }
            }

            // Add logical operators
            const logical = ["AND", "OR", "NOT"];
            for (const op of logical) {
              if (!currentWord || op.toLowerCase().startsWith(currentWord)) {
                completions.push({
                  label: op,
                  type: "keyword",
                  score: 50,
                });
              }
            }

            // Enum value suggestions: detect `<col> = <valuePrefix>` or `IN (<valuePrefix>`
            const valueCtx =
              /([a-zA-Z_][\w.]*)\s*(=|!=|<>|IN\s*\()\s*(['"]?)([a-zA-Z0-9_-]*)(['"]?)\s*\)?\s*$/i.exec(
                textBefore,
              );
            if (valueCtx) {
              const colRefRaw = valueCtx[1] ?? "";
              const typedQuote = valueCtx[3] ?? "";
              const valuePrefix = valueCtx[4] ?? "";

              let targetSchema = effectiveSchema;
              let targetTable: string | undefined;
              let targetColumn: string | undefined;

              if (colRefRaw.includes(".")) {
                const parts = colRefRaw.split(".");
                const aliasOrTable = (
                  parts[parts.length - 2] ?? ""
                ).toLowerCase();
                const columnName = (
                  parts[parts.length - 1] ?? ""
                ).toLowerCase();

                // Resolve alias to table
                const aliasRef = queryContext.aliases.get(aliasOrTable);
                if (aliasRef?.table) {
                  targetTable = aliasRef.table;
                  targetSchema = aliasRef.schema || targetSchema;
                } else {
                  // Fallback: find by table name in scope
                  const t = queryContext.tablesInScope.find(
                    (t) => t.table.toLowerCase() === aliasOrTable,
                  );
                  if (t) {
                    targetTable = t.table;
                    targetSchema = t.schema || targetSchema;
                  }
                }
                targetColumn = columnName;
              } else if (queryContext.tablesInScope.length === 1) {
                // Single table in scope, unqualified column
                const only = queryContext.tablesInScope[0];
                if (only) {
                  targetTable = only.table;
                  targetSchema = only.schema || targetSchema;
                }
                targetColumn = colRefRaw.toLowerCase();
              }

              if (targetTable && targetColumn) {
                try {
                  // Prefer full structure to get richer enum metadata if needed
                  console.debug(
                    `[Autocomplete] Enum attempt for ${targetSchema}.${targetTable}.${targetColumn}`,
                  );
                  const enumVals = await schemaCache.getColumnEnumValues(
                    connectionId,
                    targetSchema,
                    targetTable,
                    targetColumn,
                  );
                  console.debug(
                    `[Autocomplete] Enum values count=${enumVals.length}`,
                  );

                  if (enumVals.length > 0) {
                    const options = enumVals
                      .filter(
                        (v: string) =>
                          !valuePrefix ||
                          v.toLowerCase().startsWith(valuePrefix.toLowerCase()),
                      )
                      .map((v: string) => {
                        const apply = typedQuote ? v : `'${v}'`;
                        return {
                          label: v,
                          apply,
                          type: "enum",
                          detail: `${targetTable}.${targetColumn}`,
                          score: 500,
                        } as RankedCompletion;
                      });

                    if (options.length > 0) {
                      let fromPos = context.pos - valuePrefix.length;
                      let toPos = context.pos;
                      const prevChar = fullText[context.pos - 1] || "";
                      const prevPrevChar = fullText[context.pos - 2] || "";
                      // If we are after two quotes: ... = ''|
                      if (
                        valuePrefix.length === 0 &&
                        typedQuote &&
                        prevChar === typedQuote &&
                        prevPrevChar === typedQuote
                      ) {
                        fromPos = context.pos - 2;
                        toPos = context.pos;
                      }

                      return {
                        from: fromPos,
                        to: toPos,
                        options: options.slice(0, MAX_COMPLETIONS),
                        validFor: /^[a-zA-Z0-9_-]*$/,
                      };
                    }
                  }
                } catch {
                  // ignore
                }
              }
            }

            // Add SQL functions (date/time functions particularly useful in WHERE)
            const dialectFunctions = getFunctionsForDialect(dbType);
            for (const func of dialectFunctions) {
              const funcMatch = matchesQuery(func.name, currentWord);
              if (funcMatch.matches) {
                // Build function signature for display
                const params = func.parameters
                  .map((p) => (p.optional ? `[${p.name}]` : p.name))
                  .join(", ");
                const signature = `${func.name}(${params})`;

                completions.push({
                  label: func.name,
                  apply: `${func.name}()`,
                  type: "function",
                  detail: func.category,
                  info: `${signature}\n\n${func.description}${
                    func.example ? `\n\nExample: ${func.example}` : ""
                  }`,
                  score: 60 + funcMatch.score,
                });
              }
            }
          }
          break;

        case "JOIN":
          // In JOIN clause, suggest tables based on FK relationships
          try {
            const tables = await schemaCache.getTables(
              connectionId,
              effectiveSchema,
            );

            // Get relationship graph for smart suggestions
            let relationshipGraph = null;
            try {
              relationshipGraph = await schemaCache.getRelationshipGraph(
                connectionId,
                effectiveSchema,
              );
            } catch (err) {
              console.debug("Could not load relationship graph:", err);
            }

            // If we have tables in scope, prioritize FK-related tables
            if (queryContext.tablesInScope.length > 0 && relationshipGraph) {
              // Get smart join suggestions with alias support
              const joinSuggestions = relationshipService.getJoinSuggestions(
                relationshipGraph,
                queryContext.tablesInScope,
                effectiveSchema,
              );

              // Add FK-related tables with higher scores
              for (const suggestion of joinSuggestions) {
                const match = matchesQuery(suggestion.table, currentWord);
                if (match.matches) {
                  completions.push({
                    label: suggestion.table,
                    apply: `${quoteIdentifier(suggestion.table, dbType)} ON ${
                      suggestion.onCondition
                    }`,
                    type: "type",
                    detail: suggestion.description || "table",
                    info: suggestion.onCondition,
                    score: 150 + match.score, // Higher score for FK-related
                  });
                }
              }
            }

            // Add all other tables (with fuzzy matching)
            for (const table of tables) {
              const match = matchesQuery(table.name, currentWord);
              if (match.matches) {
                // Check if already suggested via FK
                if (!completions.some((c) => c.label === table.name)) {
                  completions.push({
                    label: table.name,
                    apply: quoteIdentifier(table.name, dbType),
                    type: "type",
                    detail: "table",
                    score: 100 + match.score,
                  });
                }
              }
            }

            // Add CTEs to JOIN suggestions
            for (const [cteName] of queryContext.ctes) {
              const match = matchesQuery(cteName, currentWord);
              if (match.matches) {
                completions.push({
                  label: cteName,
                  apply: quoteIdentifier(cteName, dbType),
                  type: "type",
                  detail: "CTE",
                  score: 140 + match.score,
                });
              }
            }

            // Suggest ON keyword after table name
            const exactTableMatch = tables.find(
              (table) =>
                table.name.toLowerCase() === (currentWord || "").toLowerCase(),
            );

            if (
              exactTableMatch ||
              textBeforeLower.match(/\bjoin\s+[a-zA-Z_]\w+\s+$/i)
            ) {
              const onMatch = matchesQuery("ON", currentWord);
              if (onMatch.matches) {
                completions.push({
                  label: "ON",
                  type: "keyword",
                  score: 200,
                });
              }
            }

            // Return only if we have completions to show
            if (completions.length > 0) {
              return {
                from: word.from,
                options: completions.slice(0, 50),
                validFor: /^[\w.]*$/,
              };
            }
          } catch (error) {
            console.debug("Failed to get tables for JOIN:", error);
          }
          break;

        case "GROUP BY":
        case "ORDER BY":
          // In GROUP BY/ORDER BY clause
          if (queryContext.tablesInScope.length > 0) {
            for (const table of queryContext.tablesInScope) {
              try {
                const columns = await schemaCache.getTableColumns(
                  connectionId,
                  table.schema || effectiveSchema,
                  table.table,
                );

                for (const col of columns) {
                  if (
                    !currentWord ||
                    col.name.toLowerCase().startsWith(currentWord)
                  ) {
                    completions.push({
                      label: col.name,
                      apply: quoteIdentifier(col.name, dbType),
                      type: "property",
                      detail: col.db_type,
                      score: 70,
                    });
                  }
                }
              } catch (error) {
                console.debug("Failed to get columns:", error);
              }
            }

            // For ORDER BY, add ASC/DESC
            if (queryContext.currentClause === "ORDER BY") {
              if (!currentWord || "asc".startsWith(currentWord)) {
                completions.push({ label: "ASC", type: "keyword", score: 60 });
              }
              if (!currentWord || "desc".startsWith(currentWord)) {
                completions.push({ label: "DESC", type: "keyword", score: 60 });
              }
            }
          }
          break;
      }

      // 2.5. Type-aware value suggestions
      // Detect if we're after a comparison operator and suggest values based on column type
      const comparisonMatch = textBeforeLower.match(
        /\b([a-zA-Z_][\w.]*)\s*(=|!=|<>|<|>|<=|>=|<=>|is|is\s+not|in|not\s+in|like|not\s+like)\s+([^,\s]*)$/i,
      );

      if (comparisonMatch && queryContext.tablesInScope.length > 0) {
        const columnRef = comparisonMatch[1]; // Could be "column" or "table.column"
        const operator = comparisonMatch[2];

        // Try to find the column
        let foundColumn = null;
        let columnName = columnRef;
        let tableFilter: string | null = null;

        // Check if it's a qualified reference (table.column)
        if (columnRef.includes(".")) {
          const parts = columnRef.split(".");
          tableFilter = parts[0];
          columnName = parts[1];
        }

        // Search for the column in tables in scope
        for (const table of queryContext.tablesInScope) {
          // Skip if we have a table filter and it doesn't match
          if (
            tableFilter &&
            tableFilter !== table.table &&
            tableFilter !== table.alias
          ) {
            continue;
          }

          try {
            const columns = await schemaCache.getTableColumns(
              connectionId,
              table.schema || effectiveSchema,
              table.table,
            );

            const column = columns.find((c) => c.name === columnName);
            if (column) {
              foundColumn = column;
              break;
            }
          } catch (error) {
            console.debug(
              "Failed to get columns for value suggestions:",
              error,
            );
          }
        }

        // If we found the column, suggest appropriate values
        if (foundColumn) {
          const valueSuggestions = getValueSuggestionsForColumn(
            foundColumn,
            dbType,
          );

          // Adjust scores based on operator
          const scoreAdjustment = operator.toLowerCase().includes("is")
            ? 10
            : 0;

          for (const suggestion of valueSuggestions) {
            // Filter NULL suggestions for operators that don't support NULL
            if (
              suggestion.label === "NULL" &&
              !operator.toLowerCase().includes("is")
            ) {
              continue;
            }

            completions.push({
              ...suggestion,
              score: suggestion.score + scoreAdjustment,
            });
          }
        }
      }

      // 3. Check for special patterns regardless of AST clause

      // Pattern-based fallbacks when AST parsing fails
      // Skip if we already have good results from AST
      if (completions.length >= 10) {
        // AST worked well, skip expensive pattern matching
        return {
          from: word.from,
          options: completions
            .slice(0, MAX_COMPLETIONS)
            .sort((a, b) => b.score - a.score),
          validFor: /^[\w.]*$/,
        };
      }

      // After "JOIN table_name ON" - suggest FK-based conditions (but NOT after AND/OR)
      // Check we're not in the middle of an ON condition (after AND/OR)
      const inOnCondition = /\bon\s+.*\b(and|or)\s+[a-zA-Z_.\w]*$/i.test(
        textBeforeLower,
      );

      const joinOnMatch =
        /\bjoin\s+([a-zA-Z_]\w+)(?:\s+([a-zA-Z_]\w+))?\s+on\s+([a-zA-Z_.\w]*)?$/i.exec(
          textBeforeLower,
        );

      if (
        joinOnMatch &&
        !inOnCondition &&
        queryContext.tablesInScope.length > 0
      ) {
        const joinedTable = joinOnMatch[1];
        const partialCondition = joinOnMatch[3] || "";

        try {
          const relationshipGraph = await schemaCache.getRelationshipGraph(
            connectionId,
            effectiveSchema,
          );

          // Find the ON condition between existing tables and the joined table
          for (const tableInScope of queryContext.tablesInScope) {
            const onCondition = relationshipService.getJoinCondition(
              relationshipGraph,
              tableInScope,
              joinedTable,
            );

            if (onCondition) {
              // Suggest the complete ON condition
              const match = matchesQuery(onCondition, partialCondition);
              if (match.matches) {
                completions.push({
                  label: onCondition,
                  apply: onCondition,
                  type: "keyword",
                  detail: "FK relationship",
                  info: "Based on foreign key constraint",
                  score: 200 + match.score,
                });
              }
            }
          }

          // Also suggest individual columns from the joined table
          const columns = await schemaCache.getTableColumns(
            connectionId,
            effectiveSchema,
            joinedTable,
          );

          for (const col of columns) {
            const colName = `${joinedTable}.${col.name}`;
            const match = matchesQuery(colName, partialCondition);
            if (match.matches) {
              completions.push({
                label: colName,
                apply: `${quoteIdentifier(
                  joinedTable,
                  dbType,
                )}.${quoteIdentifier(col.name, dbType)}`,
                type: "property",
                detail: col.db_type,
                score: 100 + match.score,
              });
            }
          }

          if (completions.length > 0) {
            return {
              from: word.from,
              options: completions.slice(0, 50),
              validFor: /^[\w.=\s]*$/,
            };
          }
        } catch (error) {
          console.debug("Failed to get FK suggestions for JOIN ON:", error);
        }
      }

      // After JOIN partial word - suggest tables
      const joinMatch = /\bjoin\s+([a-zA-Z_]\w*)?$/i.exec(textBeforeLower);
      if (joinMatch) {
        const partialTable = joinMatch[1] || "";
        try {
          const tables = await schemaCache.getTables(
            connectionId,
            effectiveSchema || "public",
          );

          const matchingTables = tables.filter(
            (table) =>
              !partialTable ||
              table.name.toLowerCase().startsWith(partialTable.toLowerCase()),
          );

          if (matchingTables.length > 0) {
            completions = matchingTables.map((table) => ({
              label: table.name,
              apply: quoteIdentifier(table.name, dbType),
              type: "type",
              detail: "table",
              score: 120,
            }));
          }

          // Always return here to prevent keyword fallback
          return {
            from: word.from,
            options: completions.slice(0, 50),
            validFor: /^[\w.]*$/,
          };
        } catch (error) {
          console.debug("Failed to get tables for JOIN pattern:", error);
          // Don't return here - let keywords be suggested below
        }
      }

      // After ORDER BY/GROUP BY/WHERE/HAVING - suggest columns
      const columnClauseMatch =
        /\b(order\s+by|group\s+by|where|having)\s+([a-zA-Z_]\w*)?$/i.exec(
          textBeforeLower,
        );
      if (columnClauseMatch && queryContext.tablesInScope.length > 0) {
        const clause = (columnClauseMatch[1] ?? "").toLowerCase();
        const partialColumn = columnClauseMatch[2] ?? "";

        for (const table of queryContext.tablesInScope) {
          try {
            const columns = await schemaCache.getTableColumns(
              connectionId,
              table.schema || effectiveSchema,
              table.table,
            );

            for (const col of columns) {
              if (
                !partialColumn ||
                col.name.toLowerCase().startsWith(partialColumn.toLowerCase())
              ) {
                completions.push({
                  label: col.name,
                  apply: quoteIdentifier(col.name, dbType),
                  type: "property",
                  detail: col.db_type,
                  score: 110,
                });

                // Add table.column format for WHERE/HAVING
                if (clause === "where" || clause === "having") {
                  const prefix = table.alias || table.table;
                  completions.push({
                    label: `${prefix}.${col.name}`,
                    apply: `${quoteIdentifier(
                      prefix,
                      dbType,
                    )}.${quoteIdentifier(col.name, dbType)}`,
                    type: "property",
                    detail: col.db_type,
                    score: 105,
                  });
                }
              }
            }
          } catch (error) {
            console.debug("Failed to get columns for", clause, ":", error);
          }
        }

        // Add operators for WHERE/HAVING
        if (
          (clause === "where" || clause === "having") &&
          completions.length > 0
        ) {
          const operators = [
            "=",
            "!=",
            ">",
            "<",
            ">=",
            "<=",
            "LIKE",
            "IN",
            "IS NULL",
            "IS NOT NULL",
          ];
          for (const op of operators) {
            if (
              !partialColumn ||
              op.toLowerCase().startsWith(partialColumn.toLowerCase())
            ) {
              completions.push({
                label: op,
                type: "operator",
                score: 80,
              });
            }
          }
        }

        // Add ASC/DESC for ORDER BY
        if (clause === "order by") {
          if (!partialColumn || "asc".startsWith(partialColumn.toLowerCase())) {
            completions.push({ label: "ASC", type: "keyword", score: 85 });
          }
          if (
            !partialColumn ||
            "desc".startsWith(partialColumn.toLowerCase())
          ) {
            completions.push({ label: "DESC", type: "keyword", score: 85 });
          }
        }

        if (completions.length > 0) {
          return {
            from: word.from,
            options: completions.slice(0, 50),
            validFor: /^[\w.]*$/,
          };
        }
      }

      // After FROM table, suggest WHERE/JOIN/GROUP BY/ORDER BY
      // But NOT if we're already after a JOIN keyword (which needs table suggestions)
      if (
        textBeforeLower.match(
          /\bfrom\s+[a-zA-Z_]\w*(?:\s+[a-zA-Z_]\w*)?\s+\w*$/i,
        ) &&
        !textBeforeLower.match(
          /\b(join|left\s+join|right\s+join|inner\s+join|outer\s+join|cross\s+join|full\s+join)\s+\w*$/i,
        )
      ) {
        const afterFromKeywords = [
          "WHERE",
          "JOIN",
          "LEFT JOIN",
          "RIGHT JOIN",
          "INNER JOIN",
          "GROUP BY",
          "ORDER BY",
          "HAVING",
          "LIMIT",
          "OFFSET",
        ];
        for (const kw of afterFromKeywords) {
          if (!currentWord || kw.toLowerCase().startsWith(currentWord)) {
            completions.push({
              label: kw,
              type: "keyword",
              score: 120,
            });
          }
        }
      }

      // After WHERE with some content, suggest AND/OR
      if (textBeforeLower.match(/\bwhere\s+.+\s+\w*$/i)) {
        const logical = ["AND", "OR"];
        for (const op of logical) {
          if (!currentWord || op.toLowerCase().startsWith(currentWord)) {
            completions.push({
              label: op,
              type: "keyword",
              score: 100,
            });
          }
        }
      }

      // 4. Add general SQL keywords as fallback
      if (completions.length < 10) {
        const keywordCompletions = SQL_KEYWORDS.filter(
          (kw) => !currentWord || kw.toLowerCase().startsWith(currentWord),
        ).map((kw) => ({
          label: kw,
          type: "keyword",
          score: 10,
        }));

        // Merge with existing completions
        completions = [...completions, ...keywordCompletions.slice(0, 20)];
      }

      // Remove duplicates
      const seen = new Set<string>();
      completions = completions.filter((c) => {
        if (seen.has(c.label)) return false;
        seen.add(c.label);
        return true;
      });

      // Sort by score
      completions.sort((a, b) => b.score - a.score);

      // 4. Add SQL snippets for common patterns
      // Only add snippets when:
      // - We're not in a qualified column reference (table.column)
      // - We don't have many context-specific suggestions already
      // - We're likely at the start of a statement
      const isQualifiedReference = /[a-zA-Z_][\w."]*?\.\w*$/.test(textBefore);
      const hasContextSuggestions = completions.length > 5;
      const isInMiddleOfClause = /\b(where|having|and|or|set|on)\s+\S+/i.test(
        textBeforeLower,
      );

      if (
        !isQualifiedReference &&
        !hasContextSuggestions &&
        !isInMiddleOfClause &&
        currentWord.length >= 2
      ) {
        // Filter snippets based on current word and context
        for (const snippet of SQL_SNIPPETS) {
          // Check if snippet matches current word
          const snippetMatch = fuzzyMatch(currentWord, snippet.id);
          const labelMatch = fuzzyMatch(
            currentWord,
            snippet.label.toLowerCase(),
          );

          if (snippetMatch.matches || labelMatch.matches) {
            // Check dialect compatibility
            if (!snippet.dialects || snippet.dialects.includes(dbType)) {
              const snippetCompletion = createSnippetCompletion(
                `⚡ ${snippet.label}`,
                snippet.template,
                snippet.category,
                `${snippet.description}\n\n${snippet.template}`,
                50 + (snippetMatch.score || labelMatch.score),
              );

              completions.push(snippetCompletion as RankedCompletion);
            }
          }
        }
      }

      return {
        from: word.from,
        options: completions.slice(0, 50),
        validFor: /^[\w.]*$/,
      };
    } catch (error) {
      console.error("Autocomplete error:", error);

      // Return basic keywords on error
      const word = context.matchBefore(/[\w.]*/) || {
        from: context.pos,
        text: "",
      };
      const currentWord = word.text.toLowerCase();

      const fallbackCompletions = SQL_KEYWORDS.filter(
        (kw) => !currentWord || kw.toLowerCase().startsWith(currentWord),
      )
        .slice(0, 20)
        .map((kw) => ({
          label: kw,
          type: "keyword",
        }));

      return {
        from: word.from,
        options: fallbackCompletions,
        validFor: /^[\w.]*$/,
      };
    }
  };
}
