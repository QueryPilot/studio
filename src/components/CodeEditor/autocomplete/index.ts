import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { createContextualCompletionSource } from "./sources";
import { snippetsCompletionSource } from "./snippets";
import { SqlQueryParser } from "./parser";
import { keywordCompletionSource } from "./keywords";
import { type SqlDialect } from "../types";

export interface AutocompleteConfig {
  connectionId: string;
  dialect: SqlDialect;
  database?: string;
  schema?: string;
  mode?: "editor" | "filter";
}

function dialectToDbType(dialect: AutocompleteConfig["dialect"]) {
  switch (dialect) {
    case "plsql":
      return "PostgreSQL" as const;
    case "mysql":
      return "MySQL" as const;
    case "sqlite":
      return "SQLite" as const;
    default:
      return "PostgreSQL" as const;
  }
}

export function createSqlAutocomplete(config: AutocompleteConfig): Extension {
  const { connectionId, dialect } = config;
  const dbType = dialectToDbType(dialect);
  const parser = new SqlQueryParser();

  const contextual = createContextualCompletionSource({
    connectionId,
    dbType,
    parser,
  });

  return autocompletion({
    override: [contextual, keywordCompletionSource, snippetsCompletionSource],
    activateOnTyping: true,
    maxRenderedOptions: 50,
  });
}

export { startCompletion };
