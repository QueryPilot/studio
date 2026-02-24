import type { Extension } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import {
  keymap,
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
} from "@codemirror/view";
import {
  defaultKeymap,
  indentWithTab,
  history,
  historyKeymap,
  selectAll,
} from "@codemirror/commands";
import {
  sql,
  PLSQL,
  PostgreSQL,
  MySQL,
  SQLite,
  MSSQL,
} from "@codemirror/lang-sql";
import { json as jsonLang } from "@codemirror/lang-json";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  foldService,
  indentUnit,
  codeFolding,
  foldKeymap,
} from "@codemirror/language";
import {
  searchKeymap,
  highlightSelectionMatches,
  search,
} from "@codemirror/search";
import type { SqlDialect, CodeEditorLanguage } from "./types";
import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { dbmlMixed } from "./languages/dbml/dbml-mixed";
// NOTE: Legacy createSemanticLinter removed - validation handled by createDialectLinter (unified-linter)
import { createDialectLinter } from "./languages/sql/linter-strategy";
import { createOptimizedCompletionSource } from "./languages/sql/optimized-completion";

/**
 * Pre-initialize SQL workers (no-op for Tauri-only app).
 * Kept for API compatibility but does nothing - Rust backend handles everything.
 */
export function preInitSqlWorkers(): void {
  // No-op: Tauri-only app uses Rust backend directly, no workers needed
}
import { createSqlHoverExtension } from "./languages/sql/hover";
import { createSqlMetadataProvider } from "./languages/sql/metadataProvider";
import { createExpandStarExtension } from "./languages/sql/code-actions";
import { getQueryAtCursor, isDestructiveQuery } from "./core";

// Enhanced SQL folding service using syntax tree for better nested support
export const sqlFoldService = foldService.of((state, from) => {
  const line = state.doc.lineAt(from);
  const lineText = line.text.trim();
  const lineTextUpper = lineText.toUpperCase();

  // Helper to find matching END for block statements
  const findBlockEnd = (
    startLine: number,
    startPattern: string,
    endPatterns: string[],
  ): number | null => {
    let depth = 1;
    const lines = state.doc.lines;

    for (let i = startLine + 1; i <= lines && i <= startLine + 1000; i++) {
      const checkLine = state.doc.line(i);
      const checkText = checkLine.text.trim().toUpperCase();

      // Skip empty lines and comments
      if (!checkText || checkText.startsWith("--")) continue;

      // Check for nested blocks
      if (startPattern === "BEGIN") {
        if (checkText === "BEGIN") depth++;
        else if (checkText === "END" || checkText === "END;") {
          depth--;
          if (depth === 0) return checkLine.to;
        }
      } else if (startPattern === "IF") {
        // Handle IF...ELSIF...ELSE...END IF
        if (checkText.startsWith("IF ") && !checkText.startsWith("END IF")) {
          depth++;
        } else if (
          checkText.startsWith("END IF") ||
          checkText === "ENDIF" ||
          checkText === "ENDIF;"
        ) {
          depth--;
          if (depth === 0) return checkLine.to;
        }
      } else if (startPattern === "CASE") {
        if (checkText.startsWith("CASE ")) depth++;
        else if (checkText.startsWith("END CASE") || checkText === "END") {
          depth--;
          if (depth === 0) return checkLine.to;
        }
      } else if (startPattern === "LOOP") {
        if (
          checkText === "LOOP" ||
          checkText.startsWith("FOR ") ||
          checkText.startsWith("WHILE ")
        ) {
          depth++;
        } else if (checkText.startsWith("END LOOP")) {
          depth--;
          if (depth === 0) return checkLine.to;
        }
      } else {
        // Generic pattern matching
        for (const endPattern of endPatterns) {
          if (checkText.startsWith(endPattern) || checkText === endPattern) {
            return checkLine.to;
          }
        }
      }
    }

    return null;
  };

  // Check different SQL block patterns
  if (lineTextUpper === "BEGIN" || lineTextUpper.endsWith(" BEGIN")) {
    const endPos = findBlockEnd(line.number, "BEGIN", ["END", "END;"]);
    if (endPos) return { from: line.from, to: endPos };
  }

  if (
    (lineTextUpper.startsWith("IF ") || lineTextUpper.includes(" IF ")) &&
    !lineTextUpper.startsWith("END IF") &&
    !lineTextUpper.includes("END IF")
  ) {
    const endPos = findBlockEnd(line.number, "IF", ["END IF", "ENDIF"]);
    if (endPos) return { from: line.from, to: endPos };
  }

  if (lineTextUpper.startsWith("CASE ")) {
    const endPos = findBlockEnd(line.number, "CASE", ["END CASE", "END"]);
    if (endPos) return { from: line.from, to: endPos };
  }

  if (
    lineTextUpper === "LOOP" ||
    lineTextUpper.startsWith("FOR ") ||
    lineTextUpper.startsWith("WHILE ")
  ) {
    const endPos = findBlockEnd(line.number, "LOOP", ["END LOOP"]);
    if (endPos) return { from: line.from, to: endPos };
  }

  // Handle CREATE statements
  if (
    lineTextUpper.startsWith("CREATE ") ||
    lineTextUpper.startsWith("CREATE OR REPLACE ")
  ) {
    if (
      lineTextUpper.includes("FUNCTION") ||
      lineTextUpper.includes("PROCEDURE") ||
      lineTextUpper.includes("TRIGGER")
    ) {
      // Look for $$ or END
      for (
        let i = line.number + 1;
        i <= state.doc.lines && i <= line.number + 200;
        i++
      ) {
        const checkLine = state.doc.line(i);
        const checkText = checkLine.text.trim();
        if (
          checkText === "$$" ||
          checkText === "$function$" ||
          checkText === "$procedure$" ||
          checkText.startsWith("END;") ||
          checkText === "END"
        ) {
          // If we find $$, look for the closing $$
          if (checkText.startsWith("$")) {
            for (let j = i + 1; j <= state.doc.lines && j <= i + 500; j++) {
              const endLine = state.doc.line(j);
              if (endLine.text.trim() === checkText) {
                return { from: line.from, to: endLine.to };
              }
            }
          } else {
            return { from: line.from, to: checkLine.to };
          }
        }
      }
    }
  }

  // Handle DECLARE blocks
  if (lineTextUpper === "DECLARE" || lineTextUpper.startsWith("DECLARE ")) {
    // Find the corresponding BEGIN
    for (
      let i = line.number + 1;
      i <= state.doc.lines && i <= line.number + 100;
      i++
    ) {
      const checkLine = state.doc.line(i);
      if (checkLine.text.trim().toUpperCase() === "BEGIN") {
        return { from: line.from, to: checkLine.from - 1 };
      }
    }
  }

  // Handle AS blocks
  if (lineTextUpper.startsWith("AS ")) {
    // Find the corresponding BEGIN
    for (
      let i = line.number + 1;
      i <= state.doc.lines && i <= line.number + 50;
      i++
    ) {
      const checkLine = state.doc.line(i);
      const checkText = checkLine.text.trim().toUpperCase();
      if (checkText === "BEGIN") {
        return { from: line.from, to: checkLine.from - 1 };
      }
    }
  }

  return null;
});

// Map our dialect types to CodeMirror SQL dialects
const getDialect = (dialect?: SqlDialect) => {
  switch (dialect) {
    case "mysql":
      return MySQL;
    case "sqlite":
      return SQLite;
    case "plsql":
      return PLSQL;
    case "mssql":
      return MSSQL;
    default:
      return PostgreSQL;
  }
};

// Get language extension based on language type
export const getLanguageExtension = (
  language: CodeEditorLanguage = "sql",
  dialect?: SqlDialect,
  connectionId?: string,
  database?: string,
  schema?: string,
): Extension => {
  const fallbackSchemaForDialect = (targetDialect?: SqlDialect) => {
    switch (targetDialect) {
      case "mysql":
        return database || "default";
      case "sqlite":
        return "main";
      case "mssql":
        return "dbo";
      default:
        return "public";
    }
  };

  switch (language) {
    case "sql": {
      const dialectLang = getDialect(dialect);
      const extensions: Extension[] = [
        sql({
          dialect: dialectLang,
          upperCaseKeywords: true,
          // Disable default schema completions when we have custom completions
          schema: connectionId && database ? {} : undefined,
        }),
        // Enable autocompletion UI with 150ms debounce to fix cursor lag
        autocompletion({
          activateOnTyping: true,
          activateOnTypingDelay: 150,
          maxRenderedOptions: 50,
          defaultKeymap: true,
        }),
      ];

      // Add context-aware completion and hover if connection info is available
      if (connectionId && database) {
        const defaultSchema = schema || fallbackSchemaForDialect(dialect);
        const provider = createSqlMetadataProvider(connectionId, defaultSchema);

        extensions.push(
          dialectLang.language.data.of({
            autocomplete: createOptimizedCompletionSource({
              connectionId,
              database,
              schema: defaultSchema,
              dialect: dialect || "postgresql",
            }),
          }),
          // Add hover tooltips for table/column info
          createSqlHoverExtension(provider, defaultSchema),
          // NOTE: Semantic linting removed - handled by createDialectLinter (unified-linter)
          // which uses Rust sql_validate when available
          // Add Expand Star code action
          createExpandStarExtension(provider, defaultSchema, dialect),
        );
      }

      return extensions;
    }
    case "json":
      return jsonLang();
    case "dbml":
      return dbmlMixed();
    case "redis":
      // Redis CLI mode - basic text with command highlighting
      // For now, use JSON mode as a placeholder since Redis commands
      // are simple and don't require complex syntax highlighting
      return [];
    case "text":
    default:
      return [];
  }
};

// Check if a query is a potentially destructive mutation without WHERE clause
// Moved to core/query-utils.ts but kept here for backward compatibility or direct usage if needed
// const isDestructiveQuery = ... (imported from core)

// Execute query with destructive action protection
const executeWithSafetyCheck = (
  query: string,
  onExecute: (query?: string) => void,
): void => {
  const check = isDestructiveQuery(query);

  if (check.isDestructive) {
    const message =
      check.type === "TRUNCATE"
        ? `⚠️ Warning: You are running a TRUNCATE command. This will delete ALL rows in the table. Proceed?`
        : check.type === "DROP"
          ? `⚠️ Warning: You are running a DROP command. This will permanently delete the database object. Proceed?`
          : `⚠️ Warning: You are running a ${check.type} without a WHERE clause. This will affect ALL rows. Proceed?`;

    if (!window.confirm(message)) {
      return;
    }
  }

  onExecute(query);
};

// Create execute command keymap with highest precedence
export const createExecuteKeymap = (
  onExecute?: (query?: string) => void,
): Extension => {
  if (!onExecute) return [];

  return Prec.highest(
    keymap.of([
      {
        key: "Cmd-Enter",
        mac: "Cmd-Enter",
        run: (view) => {
          const query = getQueryAtCursor(view);
          if (query) {
            executeWithSafetyCheck(query, onExecute);
          } else {
            onExecute();
          }
          return true;
        },
      },
      {
        key: "Ctrl-Enter",
        run: (view) => {
          const query = getQueryAtCursor(view);
          if (query) {
            executeWithSafetyCheck(query, onExecute);
          } else {
            onExecute();
          }
          return true;
        },
      },
      {
        key: "Mod-Enter",
        run: (view) => {
          const query = getQueryAtCursor(view);
          if (query) {
            executeWithSafetyCheck(query, onExecute);
          } else {
            onExecute();
          }
          return true;
        },
      },
    ]),
  );
};

// Create Enter keymap for custom handlers
export const createEnterKeymap = (onEnter?: () => boolean): Extension => {
  if (!onEnter) return [];

  return Prec.highest(
    keymap.of([
      {
        key: "Enter",
        run: () => {
          return onEnter();
        },
      },
      {
        key: "Cmd-Enter",
        mac: "Cmd-Enter",
        run: () => {
          return onEnter();
        },
      },
      {
        key: "Ctrl-Enter",
        run: () => {
          return onEnter();
        },
      },
      {
        key: "Shift-Enter",
        run: () => {
          return false; // Allow default behavior (insert newline)
        },
      },
    ]),
  );
};

// Create read-only keymap that blocks all editing commands
const createReadOnlyKeymap = (): Extension => {
  // List of keys that should do nothing in read-only mode
  const blockedKeys = [
    "Backspace",
    "Delete",
    "Enter",
    "Mod-d", // Delete line
    "Shift-Mod-k", // Delete line
    "Mod-Backspace",
    "Mod-Delete",
    "Ctrl-d",
    "Ctrl-h",
    "Ctrl-k",
  ];

  return Prec.highest(
    keymap.of(
      blockedKeys.map((key) => ({
        key,
        run: () => true, // Block the command by returning true
      })),
    ),
  );
};

// Get editor extensions based on configuration
export const getEditorExtensions = (
  language: CodeEditorLanguage = "sql",
  dialect?: SqlDialect,
  readOnly = false,
  showLineNumbers = true,
  onExecute?: (query?: string) => void,
  onEnter?: () => boolean,
  connectionId?: string,
  database?: string,
  schema?: string,
  options?: { disableExecuteKeymap?: boolean },
): Extension[] => {
  const disableExecuteKeymap = options?.disableExecuteKeymap ?? false;
  const extensions: Extension[] = [
    // Basic setup
    bracketMatching(),
    highlightSelectionMatches(),
    indentOnInput(),

    // Set indent unit for SQL
    indentUnit.of("  "),

    // History (undo/redo)
    history(),

    // Disable line wrapping - horizontal scroll instead
    // EditorView.lineWrapping, // Commented out to prevent wrapping

    // Language support
    getLanguageExtension(language, dialect, connectionId, database, schema),

    // Search and replace support
    search({
      top: true, // Show search panel at the top
      caseSensitive: false,
      literal: false,
      regexp: false,
      wholeWord: false,
      createPanel: (_view) => {
        const dom = document.createElement("div");
        dom.className = "cm-search-panel";
        return { dom, top: true };
      },
    }),

    // Code folding support
    codeFolding({
      placeholderText: "...",
    }),

    // Custom SQL folding for nested blocks
    sqlFoldService,

    // Keymaps for search, folding, and history (always enabled)
    keymap.of([...searchKeymap, ...foldKeymap, ...historyKeymap]),
  ];

  // Add read-only keymap with highest precedence to block editing commands
  if (readOnly) {
    extensions.unshift(createReadOnlyKeymap());
  }

  // Add select all shortcut (Cmd+A / Ctrl+A) - always enabled
  extensions.push(keymap.of([{ key: "Mod-a", run: selectAll }]));

  // Add default keymap only when not read-only (allows editing commands)
  if (!readOnly) {
    extensions.push(keymap.of(defaultKeymap));
  }

  // Add line numbers and fold gutter if enabled
  if (showLineNumbers) {
    extensions.push(
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter({
        markerDOM: (open) => {
          const marker = document.createElement("span");
          marker.style.cursor = "pointer";
          marker.style.display = "inline-flex";
          marker.style.alignItems = "center";
          marker.style.justifyContent = "center";
          marker.style.width = "20px";
          marker.style.height = "20px";
          marker.style.transition = "color 0.2s";

          // Create SVG element for Lucide-style chevron icon
          const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          svg.setAttribute("width", "16");
          svg.setAttribute("height", "16");
          svg.setAttribute("viewBox", "0 0 24 24");
          svg.setAttribute("fill", "none");
          svg.setAttribute("stroke", "currentColor");
          svg.setAttribute("stroke-width", "2");
          svg.setAttribute("stroke-linecap", "round");
          svg.setAttribute("stroke-linejoin", "round");
          svg.style.color = "#888";
          svg.style.transition = "color 0.2s";

          const path = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
          );
          if (open) {
            // ChevronDown icon
            path.setAttribute("d", "M6 9l6 6 6-6");
          } else {
            // ChevronRight icon
            path.setAttribute("d", "M9 6l6 6-6 6");
          }

          svg.appendChild(path);
          marker.appendChild(svg);

          marker.onmouseenter = () => {
            svg.style.color = "#D4A52B";
          };
          marker.onmouseleave = () => {
            svg.style.color = "#888";
          };

          return marker;
        },
      }),
    );
  }

  // Tab indentation will be added later with proper precedence handling for autocomplete

  // Add execute keymap FIRST if handler provided to override default behavior
  if (onExecute && !disableExecuteKeymap) {
    extensions.unshift(createExecuteKeymap(onExecute));
  }

  // Add Enter keymap if handler provided
  if (onEnter) {
    extensions.unshift(createEnterKeymap(onEnter));
  }

  // Add read-only extension if needed (but still allow selection)
  if (readOnly) {
    extensions.push(
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({ tabindex: "0" }), // Allow focus and selection
    );
  }

  // Add base theme
  extensions.push(
    EditorView.theme({
      ".cm-scroller": {
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: "12px",
      },
      ".cm-content": {
        userSelect: "text !important",
        WebkitUserSelect: "text !important",
        MozUserSelect: "text !important",
        msUserSelect: "text !important",
      },
      ".cm-line": {
        userSelect: "text !important",
        WebkitUserSelect: "text !important",
        MozUserSelect: "text !important",
        msUserSelect: "text !important",
      },
    }),
  );

  // Enable clipboard operations
  extensions.push(
    EditorView.domEventHandlers({
      copy: (_event, _view) => {
        // Let the browser handle copy natively
        return false;
      },
      cut: (_event, _view) => {
        // Let the browser handle cut natively
        return false;
      },
      paste: (_event, _view) => {
        // Let the browser handle paste natively
        return false;
      },
    }),
  );

  if (language === "sql") {
    // Add dialect-specific linter using unified strategy
    extensions.push(...createDialectLinter(dialect, { connectionId, schema }));
  }

  // Add tab handling: prioritize autocomplete acceptance over indentation
  if (!readOnly) {
    extensions.push(
      Prec.high(
        keymap.of([
          {
            key: "Tab",
            run: (view) => {
              // Try to accept completion first
              if (acceptCompletion(view)) {
                return true;
              }
              // If no completion, use default indentation
              return indentWithTab.run ? indentWithTab.run(view) : false;
            },
          },
        ]),
      ),
    );
  }

  return extensions;
};
