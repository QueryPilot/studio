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
import { EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  placeholder as placeholderExt,
  scrollPastEnd,
  tooltips,
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
  closeBrackets,
  closeBracketsKeymap,
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
import { logger } from "@/lib/logger";
import { getThemeExtensions } from "./themes";
import { getQueryAtCursor } from "./core";
import { sqlFoldService, preInitSqlWorkers } from "./extensions";

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
import { createRefactoringExtension } from "./extensions/sql-refactoring";
import { createScrollbarMarkersExtension } from "./extensions/scrollbar-markers";
import { createFormatOnPasteExtension } from "./extensions/format-on-paste";
import { createQueryHistoryNavExtension } from "./extensions/query-history-navigation";
import { ExtractCteDialog } from "./components/ExtractCteDialog";
import { EditorContextMenu } from "./components/EditorContextMenu";

// SQL language support
import { createDialectLinter } from "./languages/sql/linter-strategy";
import { createSqlHoverExtension } from "./languages/sql/hover";
import { createSqlMetadataProvider } from "./languages/sql/metadataProvider";
import { createExpandStarExtension } from "./languages/sql/code-actions";
import { createOptimizedCompletionSource } from "./languages/sql/optimized-completion";
import { useRustSchemaSync } from "@/hooks/useRustSchemaSync";
import { useQueryHistoryStore } from "@/stores/queryHistoryStore";

// Extracted hooks
import { useSqlEditorSetup } from "./hooks/useSqlEditorSetup";
import { useSqlEditorEffects } from "./hooks/useSqlEditorEffects";
import { useSqlEditorCompartments } from "./hooks/useSqlEditorCompartments";

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
  /** Extra bottom padding in pixels for scrolling past end */
  extraBottomPadding?: number;
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
    overflow: "auto",
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
      extraBottomPadding: _extraBottomPadding = 100,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const { resolvedTheme } = useTheme();
    const keyboardServices = useKeyboardServicesOptional();
    const contextServiceRef = useRef(keyboardServices?.contextService);

    // Keep context service ref updated
    useEffect(() => {
      contextServiceRef.current = keyboardServices?.contextService;
    }, [keyboardServices]);

    // Extract CTE dialog state
    const [extractCteDialogOpen, setExtractCteDialogOpen] = useState(false);
    const [extractCteSelection, setExtractCteSelection] = useState<{
      start: number;
      end: number;
    } | null>(null);

    // --- Setup hook: compartments, dialect detection, initial doc ---
    const { initialDoc, compartments, effectiveDialect, detectDialect } =
      useSqlEditorSetup({
        initialValue,
        value,
        dbType,
        dialectOverride,
        onDialectDetected,
      });

    // --- Effects hook: onChange, execute, event bus ---
    const {
      onGotoDefinitionRef,
      debouncedOnChange,
      executeQuery,
      executeKeymap,
    } = useSqlEditorEffects({
      onChange,
      onChangeDelay,
      onExecute,
      onGotoDefinition,
      onDialectDetected,
      detectDialect,
      viewRef,
    });

    // Manual synchronization for external value changes
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      if (value === undefined) return;

      const currentValue = view.state.doc.toString();
      if (value !== currentValue) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
      }
    }, [value]);

    // Stable reference for schema
    const defaultSchema = schema || "public";

    // Sync schema to Rust for completion/validation
    useRustSchemaSync({
      connectionId,
      schema: defaultSchema,
      enabled: !!connectionId && !!database,
    });

    // Create completion source
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

    // SQL language instance
    const sqlLang = useMemo(() => {
      const dialectLang = getDialectExtension(effectiveDialect);
      return sql({
        dialect: dialectLang,
        upperCaseKeywords: true,
      });
    }, [effectiveDialect]);

    // Dialect extensions
    const dialectExtensions = useMemo(() => {
      const provider = createSqlMetadataProvider(connectionId, defaultSchema);
      return [
        sqlLang,
        tooltips({ parent: document.body }),
        autocompletion({
          activateOnTyping: true,
          activateOnTypingDelay: 150,
          maxRenderedOptions: 50,
          defaultKeymap: true,
        }),
        createSqlHoverExtension(provider, defaultSchema),
        createExpandStarExtension(provider, defaultSchema, effectiveDialect),
      ];
    }, [connectionId, defaultSchema, effectiveDialect, sqlLang]);

    // Completion extension
    const completionExtension = useMemo(() => {
      return sqlLang.language.data.of({
        autocomplete: completionSource,
      });
    }, [sqlLang, completionSource]);

    // --- Compartments hook: dynamic reconfiguration ---
    useSqlEditorCompartments({
      viewRef,
      compartments,
      resolvedTheme,
      effectiveDialect,
      dialectExtensions,
      completionExtension,
      readOnly,
      placeholder,
      connectionId,
      schema,
    });

    // Imperative handle
    useImperativeHandle(
      ref,
      () => ({
        view: viewRef.current,
        focus: () => viewRef.current?.focus(),
        blur: () => viewRef.current?.contentDOM.blur(),
        getValue: () => viewRef.current?.state.doc.toString() || "",
        setValue: (val: string) => {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: val },
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

      preInitSqlWorkers();

      const actualTheme = resolvedTheme === "dark" ? "dark" : "light";

      // Update listener - uses RAF to avoid blocking cursor rendering
      let pendingUpdate: EditorView | null = null;
      const flushUpdate = () => {
        if (pendingUpdate) {
          const val = pendingUpdate.state.doc.toString();
          debouncedOnChange(val);
          detectDialect(val);
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
          baseTheme,
          history(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches({
            minSelectionLength: 3,
            maxMatches: 50,
            wholeWords: false,
          }),
          indentOnInput(),
          indentUnit.of("  "),
          codeFolding({ placeholderText: "..." }),
          sqlFoldService,

          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          foldGutter(),

          scrollPastEnd(),
          search({ top: true }),

          Prec.high(keymap.of(historyKeymap)),
          keymap.of([
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...foldKeymap,
          ]),

          executeKeymap,

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

          compartments.theme.of(getThemeExtensions(actualTheme)),
          compartments.dialect.of([
            ...createDialectLinter(effectiveDialect, { connectionId, schema }),
            ...dialectExtensions,
          ]),
          compartments.completion.of(completionExtension),
          compartments.readOnly.of(EditorView.editable.of(!readOnly)),
          compartments.placeholder.of(
            placeholder ? placeholderExt(placeholder) : [],
          ),

          createMultiCursorExtension(),
          createSnippetExtension(),
          createParameterHintsExtension(),
          createFormatterExtension(effectiveDialect),
          createGotoDefinitionExtension(),
          createSemanticHighlightingExtension(),

          createRefactoringExtension({
            dialect: effectiveDialect,
            onExtractCte: (selectionSpan) => {
              setExtractCteSelection(selectionSpan);
              setExtractCteDialogOpen(true);
            },
          }),

          createStatementHighlightExtension(),
          createScrollbarMarkersExtension(),
          createFormatOnPasteExtension(effectiveDialect),

          createQueryHistoryNavExtension({
            getHistory: () =>
              useQueryHistoryStore
                .getState()
                .recentHistory.map((h) => h.query),
          }),

          ...(onExecute
            ? [
                createRunGutterExtension((query) => {
                  if (query) executeQuery(query);
                }),
              ]
            : [
                lintGutter({
                  hoverTime: 300,
                }),
              ]),

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

      // Track focus state for keyboard shortcuts
      const handleFocus = () => {
        contextServiceRef.current?.setValue("editorTextFocus", true);
        contextServiceRef.current?.setValue("queryEditor", true);
      };
      const handleBlur = (e: FocusEvent) => {
        if (!view.dom.contains(e.relatedTarget as Node)) {
          contextServiceRef.current?.setValue("editorTextFocus", false);
          contextServiceRef.current?.setValue("queryEditor", false);
        }
      };
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
        contextServiceRef.current?.setValue("editorTextFocus", false);
        contextServiceRef.current?.setValue("queryEditor", false);
        view.destroy();
        viewRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty deps - only mount once

    // Rename handler for context menu
    const handleRenameFromContextMenu = useCallback(() => {
      if (viewRef.current) {
        void import("./extensions/inline-rename").then(({ startRename }) => {
          if (viewRef.current) {
            void startRename(viewRef.current, effectiveDialect);
          }
        });
      }
    }, [effectiveDialect]);

    return (
      <>
        <EditorContextMenu
          editorRef={viewRef}
          onRename={handleRenameFromContextMenu}
          onExtractCte={(span) => {
            setExtractCteSelection(span);
            setExtractCteDialogOpen(true);
          }}
          onGotoTableStructure={(table, tableSchema) => {
            onGotoDefinitionRef.current?.({
              type: "table",
              name: table,
              schema: tableSchema,
            });
          }}
        >
          <div
            ref={containerRef}
            className={`sql-editor h-full ${className}`}
            style={{ height }}
          />
        </EditorContextMenu>
        <ExtractCteDialog
          open={extractCteDialogOpen}
          onOpenChange={setExtractCteDialogOpen}
          onConfirm={async (cteName) => {
            if (!viewRef.current || !extractCteSelection) return;

            try {
              const sqlText = viewRef.current.state.doc.toString();
              const { applyRefactor } =
                await import("./languages/sql/refactor-service");

              const result = await applyRefactor(sqlText, effectiveDialect, {
                kind: "extract_cte",
                selection_span: extractCteSelection,
                cte_name: cteName,
              });

              viewRef.current.dispatch({
                changes: {
                  from: 0,
                  to: viewRef.current.state.doc.length,
                  insert: result.new_sql,
                },
              });

              viewRef.current.dispatch({
                selection: { anchor: result.cursor_position },
              });

              viewRef.current.focus();
            } catch (error) {
              logger.error("[ExtractCTE] Failed:", error);
              throw error;
            }
          }}
        />
      </>
    );
  }),
);

SqlEditor.displayName = "SqlEditor";
