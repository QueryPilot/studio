import {
  useEffect,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { getStatementAtPosition } from "./core";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "./themes";
import { getEditorExtensions } from "./extensions";
import {
  acquireLinterWorker,
  releaseLinterWorker,
} from "./languages/sql/linter-worker-manager";
import {
  acquirePgParserWorker,
  releasePgParserWorker,
} from "./languages/sql/pg-parser-worker-manager";
import { usesWorkerLinter } from "./languages/sql/linter-strategy";
import type { CodeEditorProps } from "./types";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import { useScopedKeybindings, useContextKey } from "@/hooks/useContextKey";

// Delay for focus operations to ensure editor is fully rendered
const FOCUS_DELAY_MS = 100;

export interface CodeEditorRef {
  focus: () => void;
  revealLine: (lineNumber: number) => void;
}

export const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  (
    {
      value,
      onChange,
      onExecute,
      onEnter,
      language = "sql",
      dialect = "plsql",
      connectionId,
      database,
      schema,
      readOnly = false,
      height = "100%",
      theme = "auto",
      placeholder = "",
      autoFocus = false,
      lineNumbers = true,
      className = "",
      minHeight = "100px",
      maxHeight = "100%",
    },
    ref,
  ) => {
    const editorRef = useRef<EditorView | null>(null);
    const focusCleanupRef = useRef<(() => void) | null>(null);
    const { resolvedTheme } = useTheme();
    const keyboardServices = useKeyboardServicesOptional();
    const disableExecuteKeymap = Boolean(keyboardServices);
    const scopeId = useScopedKeybindings();
    const [isFocused, setIsFocused] = useState(false);
    const isQueryEditor = Boolean(onExecute);

    useContextKey("editorTextFocus", isFocused, {
      scopeId,
      resetOnUnmount: true,
    });

    useContextKey("queryEditor", isQueryEditor, {
      scopeId,
      resetOnUnmount: true,
    });

    useEffect(() => {
      return () => {
        focusCleanupRef.current?.();
        focusCleanupRef.current = null;
        setIsFocused(false);
      };
    }, []);

    // Acquire/release linter worker for SQL editors that use worker-based linting
    // Uses reference counting to properly cleanup when last editor unmounts
    useEffect(() => {
      if (language !== "sql" || !usesWorkerLinter(dialect)) {
        return;
      }

      acquireLinterWorker();
      return () => {
        releaseLinterWorker();
      };
    }, [language, dialect]);

    // Acquire/release pg-parser worker for PostgreSQL dialect
    // PostgreSQL uses its own dedicated worker for WASM parsing
    useEffect(() => {
      if (language !== "sql" || dialect !== "postgresql") {
        return;
      }

      acquirePgParserWorker();
      return () => {
        releasePgParserWorker();
      };
    }, [language, dialect]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          editorRef.current?.focus();
        },
        revealLine: (lineNumber: number) => {
          const view = editorRef.current;
          if (!view) return;

          // Convert 0-based line number to position
          const line = view.state.doc.line(lineNumber);

          // Scroll to the line and center it
          view.dispatch({
            selection: { anchor: line.from, head: line.to },
            effects: EditorView.scrollIntoView(line.from, {
              y: "center",
              yMargin: 100,
            }),
          });

          // Focus the editor
          view.focus();
        },
      }),
      [],
    );

    // Determine actual theme based on 'auto' setting
    const actualTheme = useMemo(() => {
      if (theme === "auto") {
        // Use resolvedTheme if available, otherwise check DOM
        if (resolvedTheme) {
          return resolvedTheme === "dark" ? "dark" : "light";
        }
        // Fallback to DOM check if theme not resolved yet
        return document.documentElement.classList.contains("dark")
          ? "dark"
          : "light";
      }
      return theme;
    }, [theme, resolvedTheme]);

    const commandRegisteredRef = useRef(false);

    const handleExecute = useCallback(
      (query?: string) => {
        if (onExecute) {
          onExecute(query);
        }
      },
      [onExecute],
    );

    const registerExecuteCommand = useCallback(() => {
      if (!keyboardServices || !onExecute) {
        return;
      }
      keyboardServices.commandService.register(
        {
          id: "editor.action.executeQuery",
          label: "Run Query",
          category: "Editor",
          when: "editorTextFocus && queryEditor",
          handler: (args) => {
            // If args provided, use them
            const queryArg =
              typeof args === "string"
                ? args
                : Array.isArray(args) && typeof args[0] === "string"
                ? args[0]
                : undefined;

            // If we have an editor view, extract query at cursor
            if (!queryArg && editorRef.current) {
              const view = editorRef.current;
              const selection = view.state.selection.main;
              const selectedText = selection.from !== selection.to
                ? view.state.doc.sliceString(selection.from, selection.to).trim()
                : "";

              if (selectedText) {
                handleExecute(selectedText);
                return;
              }

              const statement = getStatementAtPosition(view.state, selection.head);
              if (statement?.text) {
                handleExecute(statement.text);
                return;
              }

              // No statement found: do nothing instead of running whole document
              return;
            }

            handleExecute(queryArg);
          },
        },
        "default",
      );
      commandRegisteredRef.current = true;
    }, [handleExecute, keyboardServices, onExecute]);

    // Static layout theme - never changes
    const layoutExtensions = useMemo(
      () =>
        EditorView.theme({
          "&": {
            height: "100%",
            display: "flex",
            flexDirection: "column",
          },
          ".cm-editor": {
            height: "100%",
            display: "flex",
            flexDirection: "column",
          },
          ".cm-scroller": {
            overflow: "auto",
            flex: "1",
          },
          ".cm-content": {
            minHeight: "100%",
          },
          ".cm-gutters": {
            minHeight: "100%",
          },
        }),
      []
    );

    // Theme extensions - only changes when theme changes
    const themeExtensions = useMemo(
      () => getThemeExtensions(actualTheme),
      [actualTheme]
    );

    // Stable refs for callbacks to avoid extension rebuilds
    const onExecuteRef = useRef(onExecute);
    const onEnterRef = useRef(onEnter);
    useEffect(() => {
      onExecuteRef.current = onExecute;
      onEnterRef.current = onEnter;
    }, [onExecute, onEnter]);

    useEffect(() => {
      return () => {
        if (keyboardServices && commandRegisteredRef.current) {
          keyboardServices.commandService.unregister(
            "editor.action.executeQuery",
          );
          commandRegisteredRef.current = false;
        }
      };
    }, [keyboardServices]);

    // Core extensions - stable, only rebuilds when language/connection config changes
    const coreExtensions = useMemo(
      () =>
        getEditorExtensions(
          language,
          dialect,
          readOnly,
          lineNumbers,
          onExecuteRef.current,
          onEnterRef.current,
          connectionId,
          database,
          schema,
          { disableExecuteKeymap }
        ),
      [
        language,
        dialect,
        readOnly,
        lineNumbers,
        connectionId,
        database,
        schema,
        disableExecuteKeymap,
      ]
    );

    // Combined extensions array
    const extensions = useMemo(
      () => [...coreExtensions, ...themeExtensions, layoutExtensions],
      [coreExtensions, themeExtensions, layoutExtensions]
    );

    // Consolidated auto-focus effect
    // Handles: initial mount, autoFocus prop change, and tab activation (value change)
    useEffect(() => {
      if (!autoFocus || !editorRef.current) return;

      const timeoutId = setTimeout(() => {
        editorRef.current?.focus();
      }, FOCUS_DELAY_MS);

      return () => { clearTimeout(timeoutId); };
    }, [autoFocus, value]);

    return (
      <div
        className={`code-editor h-full flex flex-col select-text ${className}`}
        style={{ userSelect: "text" }}
      >
        <CodeMirror
          key={`${language}-${dialect}`}
          value={value}
          onChange={onChange}
          extensions={extensions}
          editable={!readOnly}
          placeholder={placeholder}
          height={height}
          minHeight={minHeight}
          maxHeight={maxHeight}
          theme="none"
          style={{ height: "100%", display: "flex", flexDirection: "column" }}
          onCreateEditor={(view) => {
            focusCleanupRef.current?.();
            editorRef.current = view;
            const handleFocus = () => {
              setIsFocused(true);
              registerExecuteCommand();
            };
            const handleBlur = () => {
              setIsFocused(false);
              if (keyboardServices && commandRegisteredRef.current) {
                keyboardServices.commandService.unregister(
                  "editor.action.executeQuery",
                );
                commandRegisteredRef.current = false;
              }
            };
            view.dom.addEventListener("focus", handleFocus, true);
            view.dom.addEventListener("blur", handleBlur, true);
            focusCleanupRef.current = () => {
              view.dom.removeEventListener("focus", handleFocus, true);
              view.dom.removeEventListener("blur", handleBlur, true);
            };
            setIsFocused(view.hasFocus);
            if (view.hasFocus) {
              registerExecuteCommand();
            }
            // Auto-focus when editor is created if autoFocus is true
            if (autoFocus) {
              setTimeout(() => {
                view.focus();
              }, FOCUS_DELAY_MS);
            }
          }}
          basicSetup={{
            lineNumbers: false, // We handle this in extensions
            foldGutter: false,
            autocompletion: false, // Managed by extensions
            defaultKeymap: false, // We add this manually in extensions
          }}
          // Focus handling is managed via DOM event listeners in onCreateEditor
          // to ensure reliable capture-phase handling and proper cleanup
        />
      </div>
    );
  },
);

CodeEditor.displayName = "CodeEditor";

// Export types for external use
export type {
  CodeEditorProps,
  CodeEditorLanguage,
  SqlDialect,
  EditorTheme,
} from "./types";
