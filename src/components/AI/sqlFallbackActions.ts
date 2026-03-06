import type { AIConnectionContext } from "@/types/aiContext";
import type { ParsedCommand, QueryRunParams } from "@/types/aiCommands";

type SqlDialect = "mysql" | "postgres" | "mssql" | "sqlite";

const FENCED_BLOCK_REGEX = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
const INLINE_SQL_REGEX = /(?:^|\n)\s*(SELECT|WITH|SHOW|EXPLAIN)\b[\s\S]*?;/gi;
const SQL_START_REGEX = /^(SELECT|WITH|SHOW|EXPLAIN)\b/i;
const SQL_CONTINUATION_PREFIX_REGEX =
  /^(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|ON|AND|OR|UNION|INTERSECT|EXCEPT|WINDOW)\b/i;
const SQL_LEADING_SYMBOL_REGEX = /^[(),]/;

function normalizeSqlStatement(statement: string): string {
  return statement.trim().replace(/\n{3,}/g, "\n\n");
}

function statementKey(statement: string): string {
  return statement.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractStatementsFromSqlText(sqlText: string): string[] {
  const out: string[] = [];
  INLINE_SQL_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INLINE_SQL_REGEX.exec(sqlText)) !== null) {
    const raw = normalizeSqlStatement(match[0]);
    if (raw) {
      out.push(raw);
    }
  }

  if (out.length > 0) {
    return out;
  }

  // Recovery path: handle assistant SQL blocks that omit trailing semicolons.
  // We split on new top-level SELECT/WITH/SHOW/EXPLAIN lines.
  const lines = sqlText.replace(/\r/g, "").split("\n");
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const raw = normalizeSqlStatement(current.join("\n"));
    if (raw) {
      out.push(raw);
    }
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current.length > 0) {
        current.push("");
      }
      continue;
    }

    const startsSql = SQL_START_REGEX.test(trimmed);
    const topLevelStart = SQL_START_REGEX.test(line);

    if (current.length === 0) {
      if (startsSql) {
        current.push(line);
      }
      continue;
    }

    if (topLevelStart) {
      flush();
      current.push(line);
      continue;
    }

    const isLikelySqlContinuation =
      SQL_CONTINUATION_PREFIX_REGEX.test(trimmed) ||
      SQL_LEADING_SYMBOL_REGEX.test(trimmed) ||
      /^[A-Z_][A-Z0-9_]*\s*(,|$)/i.test(trimmed);

    if (!isLikelySqlContinuation) {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return out;
}

function isSqlFenceLanguage(language: string): boolean {
  const lang = language.trim().toLowerCase();
  return (
    lang === "sql" ||
    lang === "postgresql" ||
    lang === "postgres" ||
    lang === "pgsql" ||
    lang === "mysql" ||
    lang === "sqlite" ||
    lang === "mssql" ||
    lang === "tsql" ||
    lang === "plpgsql"
  );
}

function looksLikeSqlSnippet(text: string): boolean {
  const snippet = text.trim();
  if (!snippet) return false;
  return /^(SELECT|WITH|SHOW|EXPLAIN)\b/i.test(snippet);
}

/**
 * Extract SQL statements from assistant text, including fenced and inline SQL.
 */
export function extractSqlStatements(text: string): string[] {
  if (!text) return [];

  const statements: string[] = [];
  const seen = new Set<string>();
  let withoutFences = text;

  FENCED_BLOCK_REGEX.lastIndex = 0;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = FENCED_BLOCK_REGEX.exec(text)) !== null) {
    const language = fenceMatch[1] ?? "";
    const body = fenceMatch[2] ?? "";

    if (!isSqlFenceLanguage(language) && !looksLikeSqlSnippet(body)) {
      continue;
    }

    for (const statement of extractStatementsFromSqlText(body)) {
      const key = statementKey(statement);
      if (seen.has(key)) continue;
      seen.add(key);
      statements.push(statement);
    }

    withoutFences = withoutFences.replace(fenceMatch[0], "\n");
  }

  for (const statement of extractStatementsFromSqlText(withoutFences)) {
    const key = statementKey(statement);
    if (seen.has(key)) continue;
    seen.add(key);
    statements.push(statement);
  }

  return statements;
}

/**
 * Infer a likely SQL dialect from dialect-specific function/catalog usage.
 */
export function inferSqlDialect(query: string): SqlDialect | null {
  const text = query.toLowerCase();

  if (
    text.includes("pg_total_relation_size") ||
    text.includes("pg_size_pretty") ||
    text.includes("from pg_tables") ||
    text.includes("schemaname ||")
  ) {
    return "postgres";
  }

  if (
    text.includes("from sys.tables") ||
    text.includes("sys.indexes") ||
    text.includes("sys.partitions") ||
    text.includes("allocation_units") ||
    text.includes("is_ms_shipped")
  ) {
    return "mssql";
  }

  if (
    text.includes("data_length") ||
    text.includes("index_length") ||
    text.includes("table_rows") ||
    text.includes("information_schema.tables")
  ) {
    return "mysql";
  }

  if (text.includes("sqlite_master") || text.includes("pragma ")) {
    return "sqlite";
  }

  return null;
}

function matchesDialect(connection: AIConnectionContext, dialect: SqlDialect): boolean {
  const type = connection.dbType.toLowerCase();

  switch (dialect) {
    case "mysql":
      return type.includes("mysql") || type.includes("mariadb");
    case "postgres":
      return (
        type.includes("postgres") ||
        type.includes("postgresql") ||
        type.includes("cockroach") ||
        type.includes("redshift")
      );
    case "mssql":
      return (
        type.includes("mssql") ||
        type.includes("sql server") ||
        type.includes("sqlserver")
      );
    case "sqlite":
      return type.includes("sqlite");
    default:
      return false;
  }
}

function buildCommandId(prefix: string, statementIndex: number, connectionId: string): string {
  return `${prefix}-${statementIndex}-${connectionId}`;
}

/**
 * Synthesize `query.run` commands from raw SQL text when no qp-action blocks were emitted.
 * This keeps responses interactive even when the model misses structured action formatting.
 */
export function buildFallbackQueryRunCommands(options: {
  text: string;
  connections: AIConnectionContext[];
  defaultConnectionId?: string | null;
  commandIdPrefix?: string;
}): ParsedCommand<QueryRunParams>[] {
  const {
    text,
    connections,
    defaultConnectionId = null,
    commandIdPrefix = "sql-fallback",
  } = options;

  const sqlConnections = connections.filter((conn) => conn.paradigm === "sql");
  if (sqlConnections.length === 0) return [];

  const statements = extractSqlStatements(text);
  if (statements.length === 0) return [];

  const commands: ParsedCommand<QueryRunParams>[] = [];
  const emitted = new Set<string>();

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (!statement) continue;

    const dialect = inferSqlDialect(statement);
    let targets: AIConnectionContext[] = [];

    if (dialect) {
      targets = sqlConnections.filter((conn) => matchesDialect(conn, dialect));
    }

    if (targets.length === 0) {
      if (defaultConnectionId) {
        const fallback = sqlConnections.find((conn) => conn.id === defaultConnectionId);
        if (fallback) {
          targets = [fallback];
        }
      } else if (sqlConnections.length === 1) {
        const only = sqlConnections[0];
        if (only) {
          targets = [only];
        }
      }
    }

    for (const connection of targets) {
      const key = `${connection.id}::${statementKey(statement)}`;
      if (emitted.has(key)) continue;
      emitted.add(key);

      const params: QueryRunParams = {
        connectionId: connection.id,
        database: connection.database || undefined,
        query: statement,
        title: `Extracted query (${connection.name})`,
      };

      commands.push({
        id: buildCommandId(commandIdPrefix, index, connection.id),
        name: "query.run",
        params,
        approval: "auto",
        raw: statement,
        startIndex: 0,
        endIndex: 0,
        confidence: "high",
      });
    }
  }

  return commands;
}
