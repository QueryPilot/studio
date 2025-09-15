import type {
  Completion,
  CompletionResult,
  CompletionSource,
  CompletionContext,
} from "@codemirror/autocomplete";
import { schemaCache } from "@/services/schemaCache";
import type { QueryContext } from "./parser";

type DbType = "PostgreSQL" | "MySQL" | "SQLite";

const QUOTE_CHARS: Record<
  DbType,
  {
    identifier: string | [string, string];
    escape: string;
    needsQuoting: (name: string) => boolean;
  }
> = {
  PostgreSQL: {
    identifier: '"',
    escape: '""',
    needsQuoting: (name: string) => /[^a-z0-9_]/.test(name.toLowerCase()),
  },
  MySQL: {
    identifier: "`",
    escape: "``",
    needsQuoting: (name: string) => /[^a-zA-Z0-9_$]/.test(name),
  },
  SQLite: {
    identifier: '"',
    escape: '""',
    needsQuoting: (name: string) => /[^a-zA-Z0-9_]/.test(name),
  },
};

const SCHEMA_SUPPORT: Record<
  DbType,
  { hasSchemas: boolean; defaultSchema: string | null }
> = {
  PostgreSQL: { hasSchemas: true, defaultSchema: "public" },
  MySQL: { hasSchemas: false, defaultSchema: null },
  SQLite: { hasSchemas: false, defaultSchema: "main" },
};

function autoQuoteIdentifier(name: string, dbType: DbType): string {
  const config = QUOTE_CHARS[dbType];
  if (!config.needsQuoting(name)) return name;
  if (Array.isArray(config.identifier))
    return `${config.identifier[0]}${name}${config.identifier[1]}`;
  return `${config.identifier}${name}${config.identifier}`;
}

export function createContextualCompletionSource(params: {
  connectionId: string;
  dbType: DbType;
  parser: { parseContext: (state: any, pos: number) => QueryContext };
}): CompletionSource {
  const { connectionId, dbType, parser } = params;
  return async (context) => {
    const q = parser.parseContext(context.state, context.pos);
    switch (q.currentClause) {
      case "FROM":
      case "JOIN": {
        const res = await getTableCompletions(q, context, dbType, connectionId);
        return res && res.options.length > 0 ? res : null;
      }
      case "SELECT": {
        const res = await getColumnCompletions(
          q,
          context,
          dbType,
          connectionId,
        );
        return res && res.options.length > 0 ? res : null;
      }
      case "WHERE":
      case "HAVING":
      case "ORDER BY":
      case "GROUP BY":
      default:
        return null;
    }
  };
}

async function getTableCompletions(
  queryContext: QueryContext,
  context: CompletionContext,
  dbType: DbType,
  connectionId: string,
): Promise<CompletionResult | null> {
  const completions: Completion[] = [];
  const schemaSupport = SCHEMA_SUPPORT[dbType];

  if (schemaSupport.hasSchemas) {
    const schemas = await schemaCache.getSchemas(connectionId);
    schemas.forEach((schema) => {
      const quotedName = autoQuoteIdentifier(schema.name, dbType);
      completions.push({
        label: schema.name,
        apply: quotedName,
        type: "namespace",
        detail: "schema",
      });
    });
  }

  const tables = await schemaCache.getTables(
    connectionId,
    queryContext.currentSchema,
  );
  tables.forEach((table) => {
    const needsQuoting = QUOTE_CHARS[dbType].needsQuoting(table.name);
    const displayName =
      schemaSupport.hasSchemas && table.schema !== schemaSupport.defaultSchema
        ? `${table.schema}.${table.name}`
        : table.name;
    const applyText = needsQuoting
      ? autoQuoteIdentifier(table.name, dbType)
      : table.name;
    completions.push({
      label: displayName,
      apply: applyText,
      type: "type",
      detail: `table`,
    });
  });

  const word = context.matchBefore(/[\w\[\]"`$]+$/);
  if (!word && !context.explicit) return null;
  const from = word ? word.from : context.pos;

  return { from, options: completions, validFor: /^(?:[\w\[\]"`$]+)?$/ };
}

async function getColumnCompletions(
  queryContext: QueryContext,
  context: CompletionContext,
  dbType: DbType,
  connectionId: string,
): Promise<CompletionResult | null> {
  const completions: Completion[] = [];

  for (const table of queryContext.tablesInScope) {
    const columns = await schemaCache.getTableColumns(
      connectionId,
      table.schema || SCHEMA_SUPPORT[dbType].defaultSchema || "public",
      table.table,
    );
    columns.forEach((col) => {
      const needsQuoting = QUOTE_CHARS[dbType].needsQuoting(col.name);
      const prefix =
        table.alias ||
        (needsQuoting ? autoQuoteIdentifier(table.table, dbType) : table.table);
      const label = table.alias ? `${table.alias}.${col.name}` : col.name;
      const apply = table.alias
        ? needsQuoting
          ? `${prefix}.${autoQuoteIdentifier(col.name, dbType)}`
          : `${prefix}.${col.name}`
        : needsQuoting
        ? autoQuoteIdentifier(col.name, dbType)
        : col.name;
      completions.push({ label, apply, type: "property", detail: col.db_type });
    });
  }

  const word = context.matchBefore(/[\w\[\]"`$]+$/);
  if (!word && !context.explicit) return null;
  const from = word ? word.from : context.pos;
  return { from, options: completions, validFor: /^(?:[\w\[\]"`$]+)?$/ };
}
