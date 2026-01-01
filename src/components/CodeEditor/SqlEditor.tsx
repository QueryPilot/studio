/**
 * High-Performance SQL Editor
 *
 * A blazing-fast SQL editor with:
 * - Direct CodeMirror 6 integration (no wrapper overhead)
 * - Multi-cursor editing
 * - SQL snippets
 * - Parameter hints
 * - Debounced dialect detection
 * - Optimized completions
 */

import {
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
  memo,
} from "react";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  placeholder as placeholderExt,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  foldGutter,
  codeFolding,
  foldKeymap,
} from "@codemirror/language";
import {
  searchKeymap,
  highlightSelectionMatches,
  search,
} from "@codemirror/search";
import {
  autocompletion,
  acceptCompletion,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  sql,
  PostgreSQL,
  MySQL,
  SQLite,
  MSSQL,
  PLSQL,
} from "@codemirror/lang-sql";
import { lintGutter } from "@codemirror/lint";

import { useTheme } from "@/components/theme-provider";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import { eventBus } from "@/services/eventBus";
import { debounce } from "@/utils/debounce";
import { detectSqlDialect } from "@/utils/dialectDetector";
import { getThemeExtensions } from "./themes";
import { getQueryAtCursor, getStatementAtPosition, isDestructiveQuery } from "./core";
import { sqlFoldService } from "./extensions";

// Extensions
import { createMultiCursorExtension } from "./extensions/multi-cursor";
import { createSnippetExtension } from "./extensions/snippets";
import { createParameterHintsExtension } from "./extensions/parameter-hints";
import {
  createFormatterExtension,
  formatEditorContent,
} from "./extensions/formatter";
import { createGotoDefinitionExtension } from "./extensions/goto-definition";
import { createSemanticHighlightingExtension } from "./extensions/semantic-highlighting";
import { createStatementHighlightExtension } from "./extensions/statement-highlight";
import { createRunGutterExtension } from "./extensions/run-gutter";

// SQL language support
import { createDialectLinter } from "./languages/sql/linter-strategy";
import { createSemanticLinter } from "./languages/sql/sql-linter";
import { createSqlHoverExtension } from "./languages/sql/hover";
import { createSqlMetadataProvider } from "./languages/sql/metadataProvider";
import { createExpandStarExtension } from "./languages/sql/code-actions";
import { createOptimizedCompletionSource } from "./languages/sql/optimized-completion";
import {
  acquireLinterWorker,
  releaseLinterWorker,
} from "./languages/sql/linter-worker-manager";
import {
  acquirePgParserWorker,
  releasePgParserWorker,
} from "./languages/sql/pg-parser-worker-manager";
import { usesWorkerLinter } from "./languages/sql/linter-strategy";

import type { SqlDialect } from "./types";

export interface SqlEditorRef {
  view: EditorView | null;
  focus: () => void;
  blur: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  getSelection: () => string;
  replaceSelection: (text: string) => void;
  getCursorPosition: () => number;
  setCursorPosition: (pos: number) => void;
  revealLine: (line: number) => void;
  getQueryAtCursor: () => string | undefined;
  format: () => void;
}

export interface SqlEditorProps {
  /** Initial SQL content (deprecated, use value) */
  initialValue?: string;
  /** Controlled value */
  value?: string;
  /** Called when content changes (debounced) */
  onChange?: (value: string) => void;
  /** Debounce delay for onChange (ms) */
  onChangeDelay?: number;
  /** Called when user triggers query execution (Cmd/Ctrl+Enter) */
  onExecute?: (query: string) => void;
  /** Called when user navigates to a definition (Cmd+Click or F12) */
  onGotoDefinition?: (event: {
    type: "table" | "column";
    name: string;
    schema?: string;
    table?: string;
  }) => void;
  /** Connection ID for metadata */
  connectionId: string;
  /** Database name */
  database: string;
  /** Schema name */
  schema?: string;
  /** Database type for dialect detection */
  dbType?: string;
  /** Override auto-detected dialect */
  dialectOverride?: SqlDialect;
  /** Called when dialect is detected */
  onDialectDetected?: (dialect: SqlDialect) => void;
  /** Read-only mode */
  readOnly?: boolean;
  /** Auto-focus on mount */
  autoFocus?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** CSS class name */
  className?: string;
  /** Height */
  height?: string;
}

// Compartment factory - creates instance-level compartments
// This fixes the critical bug where module-level singletons caused state corruption
// across multiple editor instances
interface EditorCompartments {
  theme: Compartment;
  dialect: Compartment;
  completion: Compartment;
  readOnly: Compartment;
  placeholder: Compartment;
}

function createCompartments(): EditorCompartments {
  return {
    theme: new Compartment(),
    dialect: new Compartment(),
    completion: new Compartment(),
    readOnly: new Compartment(),
    placeholder: new Compartment(),
  };
}

// SQL dialect mapping
const getDialectExtension = (dialect: SqlDialect) => {
  switch (dialect) {
    case "mysql":
      return MySQL;
    case "sqlite":
      return SQLite;
    case "mssql":
      return MSSQL;
    case "plsql":
      return PLSQL;
    default:
      return PostgreSQL;
  }
};

// Base theme for layout
const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  ".cm-editor": {
    height: "100%",
  },
  ".cm-scroller": {
    overflowX: "hidden", // Prevent horizontal scroll shift when autocomplete opens/closes
    overflowY: "auto",
    flex: "1",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: "12px",
    lineHeight: "1.6",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "8px 0",
  },
  ".cm-gutters": {
    minHeight: "100%",
    borderRight: "1px solid var(--border)",
  },
  ".cm-cursor": {
    borderLeftWidth: "2px",
  },
  // Fix multi-line selection to have consistent left edge
  // Reserve space for statement highlight border to prevent layout shift
  ".cm-line": {
    paddingLeft: "4px",
    borderLeft: "2px solid transparent",
  },
});

export const SqlEditor = memo(
  forwardRef<SqlEditorRef, SqlEditorProps>(function SqlEditor(
    {
      initialValue = "",
      value,
      onChange,
      onChangeDelay = 0,
      onExecute,
      onGotoDefinition,
      connectionId,
      database,
      schema,
      dbType = "postgres",
      dialectOverride,
      onDialectDetected,
      readOnly = false,
      autoFocus = false,
      placeholder = "Enter your SQL query...",
      className = "",
      height = "100%",
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onExecuteRef = useRef(onExecute);
    const onGotoDefinitionRef = useRef(onGotoDefinition);
    const onDialectDetectedRef = useRef(onDialectDetected);
    const { resolvedTheme } = useTheme();
    const keyboardServices = useKeyboardServicesOptional();
    const contextServiceRef = useRef(keyboardServices?.contextService);

    // Determine startup value: value prop takes precedence over initialValue
    const startValue = value !== undefined ? value : initialValue;

    const [currentDialect, setCurrentDialect] = useState<SqlDialect>(() =>
      detectSqlDialect(dbType, startValue),
    );

    // Instance-level compartments - fixes state corruption across multiple editors
    // Using useState initializer ensures these are created exactly once per instance
    const [compartments] = useState<EditorCompartments>(() => createCompartments());

    // FIX: Use uncontrolled mode to avoid "typing latch" bug
    // We only pass the initial value to the editor, and handle subsequent updates manually
    const [initialDoc] = useState(startValue);

    // Manual synchronization for external value changes
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      // If value is undefined, we don't sync (uncontrolled mode)
      if (value === undefined) return;

      const currentValue = view.state.doc.toString();

      // Only dispatch update if value is effectively different
      if (value !== currentValue) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value }
        });
      }
    }, [value]);

    // Keep refs updated
    useEffect(() => {
      onChangeRef.current = onChange;
      onExecuteRef.current = onExecute;
      onGotoDefinitionRef.current = onGotoDefinition;
      onDialectDetectedRef.current = onDialectDetected;
      contextServiceRef.current = keyboardServices?.contextService;
    }, [onChange, onExecute, onGotoDefinition, onDialectDetected, keyboardServices]);

    // Debounced dialect detection
    const handleDialectDetection = useCallback(
      (value: string) => {
        const detected = detectSqlDialect(dbType, value);
        setCurrentDialect(detected);
        onDialectDetectedRef.current?.(detected);
      },
      [dbType],
    );

    const detectDialect = useMemo(
      () => debounce(handleDialectDetection, 500),
      [handleDialectDetection],
    );

    // Use override or detected dialect
    const effectiveDialect = dialectOverride ?? currentDialect;

    // Acquire/release linter worker for dialects using worker-based linting
    useEffect(() => {
      if (!usesWorkerLinter(effectiveDialect)) {
        return;
      }

      acquireLinterWorker();
      return () => {
        releaseLinterWorker();
      };
    }, [effectiveDialect]);

    // Acquire/release pg-parser worker for PostgreSQL dialect
    useEffect(() => {
      if (effectiveDialect !== "postgresql") {
        return;
      }

      acquirePgParserWorker();
      return () => {
        releasePgParserWorker();
      };
    }, [effectiveDialect]);

    // Create debounced onChange
    const handleChange = useCallback((value: string) => {
      onChangeRef.current?.(value);
    }, []);

    const debouncedOnChange = useMemo(
      () =>
        onChangeDelay > 0
          ? debounce(handleChange, onChangeDelay)
          : handleChange,
      [onChangeDelay, handleChange],
    );

    // Execute query with safety check
    const executeQuery = useCallback((query: string) => {
      if (!onExecuteRef.current) return;

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

      onExecuteRef.current(query);
    }, []);

    // Create execute keymap
    const executeKeymap = useMemo(() => {
      if (!onExecute) return [];

      return Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: (view) => {
              const selection = view.state.selection.main;

              // Priority 1: If text is selected, execute the selection
              if (selection.from !== selection.to) {
                const selectedText = view.state.doc
                  .sliceString(selection.from, selection.to)
                  .trim();
                if (selectedText) {
                  executeQuery(selectedText);
                  return true;
                }
              }

              // Priority 2: Execute statement at cursor (current active block)
              const statementAtCursor = getStatementAtPosition(
                view.state,
                selection.head,
              );
              if (statementAtCursor) {
                executeQuery(statementAtCursor.text);
                return true;
              }

              // No statement found -> do nothing
              return false;
            },
          },
        ]),
      );
    }, [onExecute, executeQuery]);

    // Handle external execute events (e.g. from Command Palette)
    useEffect(() => {
      const handleExecute = () => {
        if (!viewRef.current || !onExecuteRef.current) return;
        const view = viewRef.current;

        // Use exact same logic as keymap
        const selection = view.state.selection.main;

        // Priority 1: If text is selected, execute the selection
        if (selection.from !== selection.to) {
          const selectedText = view.state.doc
            .sliceString(selection.from, selection.to)
            .trim();
          if (selectedText) {
            executeQuery(selectedText);
            return;
          }
        }

        // Priority 2: Execute statement at cursor (current active block)
        const statementAtCursor = getStatementAtPosition(
          view.state,
          selection.head,
        );
        if (statementAtCursor) {
          executeQuery(statementAtCursor.text);
        }
      };

      eventBus.on("query-editor:execute", handleExecute);
      eventBus.on("query-editor:execute-background", handleExecute);
      return () => {
        eventBus.off("query-editor:execute", handleExecute);
        eventBus.off("query-editor:execute-background", handleExecute);
      };
    }, [executeQuery]);

    // Stable reference for schema
    const defaultSchema = schema || "public";

    // Create completion source - this is the only extension that needs connection context
    // Memoize to prevent unnecessary recreations
    const completionSource = useMemo(
      () =>
        createOptimizedCompletionSource({
          connectionId,
          database,
          schema: defaultSchema,
          dialect: effectiveDialect,
        }),
      [connectionId, database, defaultSchema, effectiveDialect],
    );

    // SQL language instance - stable reference, only changes with dialect
    const sqlLang = useMemo(() => {
      const dialectLang = getDialectExtension(effectiveDialect);
      return sql({
        dialect: dialectLang,
        upperCaseKeywords: true,
      });
    }, [effectiveDialect]);

    // Dialect extensions - only recreates when dialect changes (expensive operations)
    const dialectExtensions = useMemo(() => {
      const provider = createSqlMetadataProvider(connectionId, defaultSchema);
      return [
        // SQL language support with built-in keyword completion
        sqlLang,
        // Autocompletion UI settings (no override - uses language-provided sources)
        autocompletion({
          activateOnTyping: true,
          maxRenderedOptions: 30,
          defaultKeymap: true,
        }),
        // Hover tooltips
        createSqlHoverExtension(provider, defaultSchema),
        // Semantic linting
        createSemanticLinter(provider, defaultSchema),
        // Code actions
        createExpandStarExtension(provider, defaultSchema, effectiveDialect),
      ];
    }, [connectionId, defaultSchema, effectiveDialect, sqlLang]);

    // Completion extension - lightweight, separate compartment for fast updates
    const completionExtension = useMemo(() => {
      return sqlLang.language.data.of({
        autocomplete: completionSource,
      });
    }, [sqlLang, completionSource]);

    // Imperative handle
    useImperativeHandle(
      ref,
      () => ({
        view: viewRef.current,
        focus: () => viewRef.current?.focus(),
        blur: () => viewRef.current?.contentDOM.blur(),
        getValue: () => viewRef.current?.state.doc.toString() || "",
        setValue: (value: string) => {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: value },
          });
        },
        getSelection: () => {
          const view = viewRef.current;
          if (!view) return "";
          const { from, to } = view.state.selection.main;
          return view.state.doc.sliceString(from, to);
        },
        replaceSelection: (text: string) => {
          viewRef.current?.dispatch(
            viewRef.current.state.replaceSelection(text),
          );
        },
        getCursorPosition: () =>
          viewRef.current?.state.selection.main.head || 0,
        setCursorPosition: (pos: number) => {
          viewRef.current?.dispatch({ selection: { anchor: pos } });
        },
        revealLine: (lineNumber: number) => {
          const view = viewRef.current;
          if (!view) return;
          try {
            const line = view.state.doc.line(lineNumber);
            view.dispatch({
              selection: { anchor: line.from, head: line.to },
              effects: EditorView.scrollIntoView(line.from, { y: "center" }),
            });
            view.focus();
          } catch {
            // Invalid line
          }
        },
        getQueryAtCursor: () => {
          const view = viewRef.current;
          return view ? getQueryAtCursor(view) : undefined;
        },
        format: () => {
          const view = viewRef.current;
          if (view) {
            formatEditorContent(view, effectiveDialect);
          }
        },
      }),
      [effectiveDialect],
    );

    // Initialize editor
    useEffect(() => {
      if (!containerRef.current || viewRef.current) return;

      const actualTheme = resolvedTheme === "dark" ? "dark" : "light";

      // Update listener for changes - uses RAF to avoid blocking cursor rendering
      let pendingUpdate: EditorView | null = null;
      const flushUpdate = () => {
        if (pendingUpdate) {
          const value = pendingUpdate.state.doc.toString();
          debouncedOnChange(value);
          detectDialect(value);
          pendingUpdate = null;
        }
      };

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          pendingUpdate = update.view;
          requestAnimationFrame(flushUpdate);
        }
      });

      const state = EditorState.create({
        doc: initialDoc,
        extensions: [
          // Base setup
          baseTheme,

          // History MUST come first to ensure undo/redo works properly
          history(),

          bracketMatching(),
          highlightSelectionMatches({
            minSelectionLength: 3,
            maxMatches: 50,
            wholeWords: false,
          }),
          indentOnInput(),
          indentUnit.of("  "),
          codeFolding({ placeholderText: "..." }),
          sqlFoldService,

          // Line numbers and gutter
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          foldGutter(),
          // Note: lintGutter() is added by run-gutter extension if onExecute is provided

          // Search
          search({ top: true }),

          // Keymaps - history keymap with high precedence to prevent override
          Prec.high(keymap.of(historyKeymap)),
          keymap.of([
            ...completionKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...foldKeymap,
          ]),

          // Execute keymap
          executeKeymap,

          // Tab handling - accept completion first, then indent
          Prec.high(
            keymap.of([
              {
                key: "Tab",
                run: (view) => {
                  if (acceptCompletion(view)) return true;
                  return indentWithTab.run ? indentWithTab.run(view) : false;
                },
              },
            ]),
          ),

          // Dynamic compartments (instance-level to prevent state corruption)
          compartments.theme.of(getThemeExtensions(actualTheme)),
          compartments.dialect.of([
            ...createDialectLinter(effectiveDialect),
            ...dialectExtensions,
          ]),
          compartments.completion.of(completionExtension),
          compartments.readOnly.of(EditorView.editable.of(!readOnly)),
          compartments.placeholder.of(
            placeholder ? placeholderExt(placeholder) : [],
          ),

          // Smart features
          createMultiCursorExtension(),
          createSnippetExtension(),
          createParameterHintsExtension(),
          createFormatterExtension(effectiveDialect),
          createGotoDefinitionExtension(),
          createSemanticHighlightingExtension(),

          // Statement highlighting - highlight active statement block
          createStatementHighlightExtension(),

          // Run gutter - play button for each statement (includes lintGutter)
          ...(onExecute
            ? [
                createRunGutterExtension((query) => {
                  if (query) executeQuery(query);
                }),
              ]
            : [lintGutter()]),

          // Update listener
          updateListener,
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;

      // Listen for goto-definition events
      const handleGotoDefinition = (event: Event) => {
        const customEvent = event as CustomEvent<{
          type: "table" | "column";
          name: string;
          schema?: string;
          table?: string;
        }>;
        onGotoDefinitionRef.current?.(customEvent.detail);
      };
      view.dom.addEventListener("goto-definition", handleGotoDefinition);

      // Track focus state for keyboard shortcuts using CodeMirror's focus tracking
      // This allows global shortcuts like Cmd+Z to know when editor has focus
      // Using DOM events on view.dom (not contentDOM) for more reliable focus detection
      const handleFocus = () => {
        contextServiceRef.current?.setValue("editorTextFocus", true);
        contextServiceRef.current?.setValue("queryEditor", true);
      };
      const handleBlur = (e: FocusEvent) => {
        // Only clear focus if focus is leaving the editor entirely
        // (not moving to another element within the editor like scrollbar)
        if (!view.dom.contains(e.relatedTarget as Node)) {
          contextServiceRef.current?.setValue("editorTextFocus", false);
          contextServiceRef.current?.setValue("queryEditor", false);
        }
      };
      // Use focusin/focusout on the editor container for bubble-phase capture
      view.dom.addEventListener("focusin", handleFocus);
      view.dom.addEventListener("focusout", handleBlur);

      if (autoFocus) {
        requestAnimationFrame(() => {
          view.focus();
        });
      }

      return () => {
        view.dom.removeEventListener("goto-definition", handleGotoDefinition);
        view.dom.removeEventListener("focusin", handleFocus);
        view.dom.removeEventListener("focusout", handleBlur);
        // Reset context on unmount
        contextServiceRef.current?.setValue("editorTextFocus", false);
        contextServiceRef.current?.setValue("queryEditor", false);
        view.destroy();
        viewRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty deps - only mount once

    // Update theme
    useEffect(() => {
      const actualTheme = resolvedTheme === "dark" ? "dark" : "light";
      viewRef.current?.dispatch({
        effects: compartments.theme.reconfigure(
          getThemeExtensions(actualTheme),
        ),
      });
    }, [resolvedTheme, compartments]);

    // Update dialect extensions (heavy - only when dialect changes)
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: compartments.dialect.reconfigure([
          ...createDialectLinter(effectiveDialect),
          ...dialectExtensions,
        ]),
      });
    }, [effectiveDialect, dialectExtensions, compartments]);

    // Update completion extension (lightweight - separate from dialect)
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: compartments.completion.reconfigure(completionExtension),
      });
    }, [completionExtension, compartments]);

    // Update read-only
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: compartments.readOnly.reconfigure(
          EditorView.editable.of(!readOnly),
        ),
      });
    }, [readOnly, compartments]);

    // Update placeholder
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: compartments.placeholder.reconfigure(
          placeholder ? placeholderExt(placeholder) : [],
        ),
      });
    }, [placeholder, compartments]);

    return (
      <div
        ref={containerRef}
        className={`sql-editor h-full ${className}`}
        style={{ height }}
      />
    );
  }),
);

SqlEditor.displayName = "SqlEditor";
