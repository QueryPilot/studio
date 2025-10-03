import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { createContextualCompletionSource } from "./sources-v3";
import { SqlQueryParser } from "./parser-v2-fixed";
import { schemaCache } from "@/services/schemaCache";
import { type SqlDialect } from "../types";

export interface AutocompleteConfig {
  connectionId: string;
  dialect: SqlDialect;
  database?: string;
  schema?: string;
  mode?: "editor" | "filter";
}

function dialectToDbType(
  dialect: AutocompleteConfig["dialect"],
): "PostgreSQL" | "MySQL" | "SQLite" | "MSSQL" {
  switch (dialect) {
    case "postgresql":
    case "plsql":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "sqlite":
      return "SQLite";
    case "mssql":
      return "MSSQL";
    default:
      return "PostgreSQL";
  }
}

export function createSqlAutocomplete(config: AutocompleteConfig): Extension {
  const { connectionId, dialect, database, schema } = config;
  const dbType = dialectToDbType(dialect);
  const parser = new SqlQueryParser();

  // Set connection context for cache
  schemaCache.setConnection(connectionId);

  // Create our improved contextual source
  const contextual = createContextualCompletionSource({
    connectionId,
    dbType,
    parser,
    database,
    schema,
  });

  return autocompletion({
    override: [contextual],
    activateOnTyping: true,
    maxRenderedOptions: 50,
    defaultKeymap: true,
    closeOnBlur: true,
    icons: true,
    aboveCursor: false,
    tooltipClass: () => "cm-autocomplete-tooltip",
    optionClass: (completion) => {
      // Add CSS classes based on completion type
      return `cm-completion-${completion.type || "default"}`;
    },
    // Note: Debouncing handled via completion source caching and early exits
  });
}

// Export utilities
export { startCompletion, schemaCache };
