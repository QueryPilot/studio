import type {
  Completion,
  CompletionSource,
  CompletionContext,
} from "@codemirror/autocomplete";
// (No direct import needed here; enum values provided via schemaCache)
import { schemaCache } from "@/services/schemaCache";
import type { QueryContext } from "./parser";
import { fuzzyMatch } from "@/utils/fuzzyMatch";

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
        const partialColumn = tableColumnMatch[2].toLowerCase();

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
              completions = cached.cols
                .map((c) => {
                  const match = matchesQuery(c.label, partialColumn);
                  return {
                    ...c,
                    matches: match.matches,
                    score: c.score + match.score,
                  };
                })
                .filter((c) => c.matches);
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
              completions = built
                .map((c) => {
                  const match = matchesQuery(c.label, partialColumn);
                  return {
                    ...c,
                    matches: match.matches,
                    score: c.score + match.score,
                  };
                })
                .filter((c) => c.matches);
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

            console.debug(
              `[Autocomplete] Returning ${completions.length} suggestions for ${tableOrAlias}.${partialColumn}`,
            );

            // Always return when we have a table.column pattern match
            // Even if empty, to prevent fallthrough to other suggestions
            return {
              from: word.from + tableOrAlias.length + 1,
              options: completions.slice(0, MAX_COMPLETIONS),
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

            // Add aggregate functions
            const aggregates = ["COUNT", "SUM", "AVG", "MIN", "MAX"];
            for (const agg of aggregates) {
              if (!currentWord || agg.toLowerCase().startsWith(currentWord)) {
                completions.push({
                  label: agg,
                  type: "function",
                  score: 70,
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
          }
          break;

        case "JOIN":
          // In JOIN clause, always suggest tables and CTEs first
          try {
            const tables = await schemaCache.getTables(
              connectionId,
              effectiveSchema,
            );

            // Check if current word could be a complete table name
            const matchingTables = tables.filter(
              (table) =>
                !currentWord ||
                table.name.toLowerCase().startsWith(currentWord),
            );

            if (matchingTables.length > 0) {
              // Suggest matching tables
              completions = matchingTables.map((table) => ({
                label: table.name,
                apply: quoteIdentifier(table.name, dbType),
                type: "type",
                detail: "table",
                score: 100,
              }));
            }

            // Add CTEs to JOIN suggestions
            for (const [cteName] of queryContext.ctes) {
              if (
                !currentWord ||
                cteName.toLowerCase().startsWith(currentWord)
              ) {
                completions.push({
                  label: cteName,
                  apply: quoteIdentifier(cteName, dbType),
                  type: "type",
                  detail: "CTE",
                  score: 110,
                });
              }
            }

            // Only suggest ON if we have a complete table name and it matches exactly
            const exactTableMatch = tables.find(
              (table) =>
                table.name.toLowerCase() === (currentWord || "").toLowerCase(),
            );

            if (
              exactTableMatch ||
              textBeforeLower.match(/\bjoin\s+[a-zA-Z_]\w+\s+$/i)
            ) {
              if (!currentWord || "on".startsWith(currentWord)) {
                completions.push({
                  label: "ON",
                  type: "keyword",
                  score: 150,
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
      if (
        textBeforeLower.match(
          /\bfrom\s+[a-zA-Z_]\w*(?:\s+[a-zA-Z_]\w*)?\s+\w*$/i,
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
