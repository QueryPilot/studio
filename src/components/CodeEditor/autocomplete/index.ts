import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createContextualCompletionSource } from "./sources";
import { SqlQueryParser } from "./parser";
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

  return [
    autocompletion({
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
    }),
    // Force brand colors with EditorView.theme to override CodeMirror defaults
    EditorView.theme({
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
        background: "rgba(252, 163, 17, 0.15) !important", // 15% opacity amber
        color: "#14213D !important", // Dark navy text for contrast
        borderLeft: "3px solid #FCA311 !important",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]:hover": {
        background: "rgba(252, 163, 17, 0.25) !important", // 25% opacity on hover
        color: "#14213D !important",
      },
    }),
  ];
}

// Export utilities
export { startCompletion, schemaCache };
