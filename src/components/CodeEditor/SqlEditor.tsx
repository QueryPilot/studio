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
  closeHoverTooltips,
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
  pickedCompletion,
} from "@codemirror/autocomplete";
import {
  sql,
  PostgreSQL,
  MySQL,
  SQLite,
  MSSQL,
  PLSQL,
} from "@codemirror/lang-sql";

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
import { createRunGutterExtension } from "./extensions/run-gutter";
import { createRefactoringExtension } from "./extensions/sql-refactoring";
import { createFormatOnPasteExtension } from "./extensions/format-on-paste";
import { createQueryHistoryNavExtension } from "./extensions/query-history-navigation";
import { ExtractCteDialog } from "./components/ExtractCteDialog";
import { EditorContextMenu } from "./components/EditorContextMenu";

// SQL language support
import { createDialectLinter } from "./languages/sql/linter-strategy";
import { createSqlHoverExtension } from "./languages/sql/hover";
import {
  createSqlMetadataProvider,
  clearProviderCache,
} from "./languages/sql/metadataProvider";
import { createExpandStarExtension } from "./languages/sql/code-actions";
import {
  createOptimizedCompletionSource,
  clearCompletionCache,
  recordCompletionUsage,
} from "./languages/sql/optimized-completion";
import { useRustSchemaSync } from "@/hooks/useRustSchemaSync";
import { useQueryHistoryStore } from "@/stores/queryHistoryStore";

// Extracted hooks
import { useSqlEditorSetup } from "./hooks/useSqlEditorSetup";
import { useSqlEditorEffects } from "./hooks/useSqlEditorEffects";
import { useSqlEditorCompartments } from "./hooks/useSqlEditorCompartments";
import { useExtensionPhasing } from "./hooks/useExtensionPhasing";

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

const getFallbackSchema = (dbType: string, database: string): string => {
  const normalized = dbType.toLowerCase();
  if (normalized.includes("mysql") || normalized.includes("mariadb")) {
    return database || "default";
  }
  if (normalized.includes("sqlite")) {
    return "main";
  }
  if (normalized.includes("mssql") || normalized.includes("sqlserver")) {
    return "dbo";
  }
  return "public";
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
    const docValueRef = useRef(initialDoc);
    const hasLocalEditsSinceFocusRef = useRef(false);

    // --- Effects hook: onChange, execute, event bus ---
    const {
      onGotoDefinitionRef,
      lastEmittedValueRef,
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
      if (value === currentValue) {
        docValueRef.current = value;
        return;
      }

      // Ignore stale controlled write-backs while this focused editor has local edits.
      // This prevents char reverts and cursor jumps from delayed state echoes.
      if (view.hasFocus && hasLocalEditsSinceFocusRef.current) {
        if (value === lastEmittedValueRef.current) {
          return;
        }
        return;
      }

      const selectionAnchor = view.state.selection.main.head;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        ...(view.hasFocus
          ? { selection: { anchor: Math.min(selectionAnchor, value.length) } }
          : {}),
      });
      docValueRef.current = value;
    }, [value, lastEmittedValueRef]);

    // Stable reference for schema
    const defaultSchema = schema || getFallbackSchema(dbType, database);

    const handlePickedCompletion = useCallback(
      (picked: { label: string; type?: string | null }) => {
        const normalizedLabel = picked.label
          .replaceAll("`", "")
          .replaceAll('"', "")
          .replaceAll("[", "")
          .replaceAll("]", "")
          .replace(/\.$/, "")
          .trim();
        if (!normalizedLabel) return;

        const type = (picked.type || "").toLowerCase();
        if (type === "function") {
          recordCompletionUsage("function", normalizedLabel);
          return;
        }
        if (type === "property") {
          recordCompletionUsage("column", normalizedLabel);
          return;
        }
        if (
          type === "class" ||
          type === "constant" ||
          type === "namespace" ||
          type === "variable"
        ) {
          recordCompletionUsage("table", normalizedLabel);
        }
      },
      [],
    );

    useEffect(() => {
      clearCompletionCache(connectionId);
      clearProviderCache(connectionId);
    }, [connectionId, defaultSchema, effectiveDialect]);

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
      schema: defaultSchema,
    });

    // --- Extension phasing: split non-critical extensions into phases ---
    const phase1Extensions = useMemo(
      () => [
        scrollPastEnd(),
        codeFolding({ placeholderText: "..." }),
        sqlFoldService,
        foldGutter(),
        createMultiCursorExtension(),
      ],
      [],
    );

    const phase2Extensions = useMemo(
      () => [
        createSnippetExtension(),
        createParameterHintsExtension(),
        createFormatterExtension(effectiveDialect),
        createGotoDefinitionExtension(),
        createRefactoringExtension({
          dialect: effectiveDialect,
          onExtractCte: (selectionSpan) => {
            setExtractCteSelection(selectionSpan);
            setExtractCteDialogOpen(true);
          },
        }),
        createFormatOnPasteExtension(effectiveDialect),
        createQueryHistoryNavExtension({
          getHistory: () =>
            useQueryHistoryStore
              .getState()
              .recentHistory.map((h) => h.query),
        }),
      ],
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const phasingCompartments = useExtensionPhasing(
      viewRef,
      phase1Extensions,
      phase2Extensions,
    );

    // === Editor sleep/wake for unfocused performance ===
    // When an editor loses focus, strip all heavy extensions (linter, completions,
    // code folding, hover, etc.) to make the unfocused editor near-zero-cost.
    // On regain focus, restore everything. This eliminates cross-editor interference
    // when multiple split editors are open.
    const sleepingRef = useRef(false);
    const wakeExtRef = useRef({
      sqlLang,
      effectiveDialect,
      connectionId,
      defaultSchema,
      dialectExtensions,
      completionExtension,
      phase1Extensions,
      phase2Extensions,
    });
    useEffect(() => {
      wakeExtRef.current = {
        sqlLang,
        effectiveDialect,
        connectionId,
        defaultSchema,
        dialectExtensions,
        completionExtension,
        phase1Extensions,
        phase2Extensions,
      };
    }, [sqlLang, effectiveDialect, connectionId, defaultSchema, dialectExtensions, completionExtension, phase1Extensions, phase2Extensions]);

    // Reconfigure phase2 compartment when dialect changes so formatter/refactoring
    // extensions pick up the new dialect instead of using the stale initial closure.
    // Skip initial mount — the phasing hook handles initial loading via its 2s timer.
    const dialectMountedRef = useRef(false);
    useEffect(() => {
      if (!dialectMountedRef.current) {
        dialectMountedRef.current = true;
        return;
      }
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: phasingCompartments.phase2.reconfigure([
          createSnippetExtension(),
          createParameterHintsExtension(),
          createFormatterExtension(effectiveDialect),
          createGotoDefinitionExtension(),
          createRefactoringExtension({
            dialect: effectiveDialect,
            onExtractCte: (selectionSpan) => {
              setExtractCteSelection(selectionSpan);
              setExtractCteDialogOpen(true);
            },
          }),
          createFormatOnPasteExtension(effectiveDialect),
          createQueryHistoryNavExtension({
            getHistory: () =>
              useQueryHistoryStore
                .getState()
                .recentHistory.map((h) => h.query),
          }),
        ]),
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveDialect]);

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
      const tooltipParent = containerRef.current.ownerDocument.body;

      // Update listener - uses RAF to avoid blocking cursor rendering
      let rafId: number | null = null;
      let pendingUpdate: EditorView | null = null;
      const flushUpdate = () => {
        rafId = null;
        const pending = pendingUpdate;
        if (!pending) return;

        const val = pending.state.doc.toString();
        docValueRef.current = val;
        debouncedOnChange(val);
        detectDialect(val);
        pendingUpdate = null;
      };

      const updateListener = EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          const picked = tr.annotation(pickedCompletion);
          if (picked) {
            handlePickedCompletion(picked);
          }
        }

        if (update.docChanged) {
          hasLocalEditsSinceFocusRef.current = true;
          pendingUpdate = update.view;
          if (rafId === null) {
            rafId = requestAnimationFrame(flushUpdate);
          }
        }
      });

      const state = EditorState.create({
        doc: initialDoc,
        extensions: [
          baseTheme,
          // Render tooltips in document.body to avoid clipping by panel containers.
          tooltips({ parent: tooltipParent, position: "fixed" }),
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

          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),

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
            ...createDialectLinter(effectiveDialect, {
              connectionId,
              schema: defaultSchema,
            }),
            ...dialectExtensions,
          ]),
          compartments.completion.of(completionExtension),
          compartments.readOnly.of(EditorView.editable.of(!readOnly)),
          compartments.placeholder.of(
            placeholder ? placeholderExt(placeholder) : [],
          ),

          // Phased extension placeholders — populated by useExtensionPhasing
          phasingCompartments.phase1.of([]),
          phasingCompartments.phase2.of([]),

          ...(onExecute
            ? [
                createRunGutterExtension((query) => {
                  if (query) executeQuery(query);
                }),
              ]
            : []),

          updateListener,
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;
      docValueRef.current = view.state.doc.toString();

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

      // Close hover tooltips when clicking outside this editor.
      // Only dispatches to THIS editor when the click is outside its DOM tree,
      // preventing unnecessary CM6 update cycles on other editors.
      const ownerDocument = containerRef.current.ownerDocument;
      const handleOutsidePointerDown = (event: PointerEvent) => {
        const target = event.target as Element | null;
        if (!target) return;

        // Skip if click is inside this editor — CM6 handles it natively
        if (view.dom.contains(target)) return;

        // Keep lint tooltip interactive so users can select/copy diagnostic text.
        if (target.closest(".cm-tooltip-lint")) return;

        // Only dismiss tooltips for this editor if it actually had focus
        // (unfocused editors won't have visible hover tooltips)
        if (!view.hasFocus) return;

        view.dispatch({
          effects: closeHoverTooltips,
        });
      };
      ownerDocument.addEventListener(
        "pointerdown",
        handleOutsidePointerDown,
        true,
      );

      // === Sleep/Wake: strip heavy extensions on blur, restore on focus ===
      // WAKE handler runs in capture phase so it fires BEFORE
      // useSqlEditorCompartments' bubble-phase pending flush (correct ordering:
      // wake restores saved state → pending flush may overwrite with newer values).
      const handleWake = () => {
        if (sleepingRef.current) {
          sleepingRef.current = false;
          const ext = wakeExtRef.current;
          view.dispatch({
            effects: [
              compartments.dialect.reconfigure([
                ...createDialectLinter(ext.effectiveDialect, {
                  connectionId: ext.connectionId,
                  schema: ext.defaultSchema,
                }),
                ...ext.dialectExtensions,
              ]),
              compartments.completion.reconfigure(ext.completionExtension),
              phasingCompartments.phase1.reconfigure(ext.phase1Extensions),
              phasingCompartments.phase2.reconfigure(ext.phase2Extensions),
            ],
          });
        }
      };

      // Track focus state for keyboard shortcuts
      const handleFocus = () => {
        hasLocalEditsSinceFocusRef.current = false;
        contextServiceRef.current?.setValue("editorTextFocus", true);
        contextServiceRef.current?.setValue("queryEditor", true);
      };
      const handleBlur = (e: FocusEvent) => {
        const relatedTarget = e.relatedTarget as Element | null;

        // Hover/tooltips can briefly receive focus; keep editor context active.
        if (relatedTarget?.closest(".cm-tooltip")) {
          return;
        }

        if (!relatedTarget || !view.dom.contains(relatedTarget)) {
          hasLocalEditsSinceFocusRef.current = false;
          contextServiceRef.current?.setValue("editorTextFocus", false);
          contextServiceRef.current?.setValue("queryEditor", false);

          // SLEEP: Strip heavy extensions from unfocused editor.
          // Keeps only syntax highlighting (sqlLang) for near-zero-cost display.
          if (!sleepingRef.current) {
            sleepingRef.current = true;
            const ext = wakeExtRef.current;
            view.dispatch({
              effects: [
                compartments.dialect.reconfigure([ext.sqlLang]),
                compartments.completion.reconfigure([]),
                phasingCompartments.phase1.reconfigure([]),
                phasingCompartments.phase2.reconfigure([]),
              ],
            });
          }
        }
      };
      view.dom.addEventListener("focusin", handleWake, true); // capture: wake before other listeners
      view.dom.addEventListener("focusin", handleFocus);
      view.dom.addEventListener("focusout", handleBlur);

      if (autoFocus) {
        requestAnimationFrame(() => {
          view.focus();
        });
      }

      // Auto-sleep unfocused editors after phase2 loads (3s).
      // Catches editors created unfocused (e.g., from panel split) that
      // never receive a blur event to trigger the sleep path above.
      const autoSleepTimer = setTimeout(() => {
        if (view.dom.isConnected && !view.hasFocus && !sleepingRef.current) {
          sleepingRef.current = true;
          const ext = wakeExtRef.current;
          view.dispatch({
            effects: [
              compartments.dialect.reconfigure([ext.sqlLang]),
              compartments.completion.reconfigure([]),
              phasingCompartments.phase1.reconfigure([]),
              phasingCompartments.phase2.reconfigure([]),
            ],
          });
        }
      }, 3000);

      return () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        pendingUpdate = null;
        view.dom.removeEventListener("goto-definition", handleGotoDefinition);
        ownerDocument.removeEventListener(
          "pointerdown",
          handleOutsidePointerDown,
          true,
        );
        clearTimeout(autoSleepTimer);
        view.dom.removeEventListener("focusin", handleWake, true);
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
