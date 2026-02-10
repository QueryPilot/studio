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
import { StateEffect } from "@codemirror/state";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "./themes";
import { getEditorExtensions } from "./extensions";
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
    const [hasSelection, setHasSelection] = useState(false);
    const isQueryEditor = Boolean(onExecute);

    // FIX: Use uncontrolled mode to avoid "typing latch" bug in @uiw/react-codemirror
    // We only pass the initial value to the editor, and handle subsequent updates manually
    // This prevents the race condition where React renders stale state during the 200ms latch window
    // Use useState to capture the initial value once on mount - avoiding ref access during render
    const [initialDoc] = useState(value);

    // Manual synchronization for external value changes
    useEffect(() => {
      const view = editorRef.current;
      if (!view) return;

      const currentValue = view.state.doc.toString();

      // Only dispatch update if value is effectively different
      // This handles the "loopback" case where user types -> onChange -> parent state update -> prop update
      if (value !== currentValue) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
      }
    }, [value]);

    useContextKey("editorTextFocus", isFocused, {
      scopeId,
      resetOnUnmount: true,
    });

    useContextKey("queryEditor", isQueryEditor, {
      scopeId,
      resetOnUnmount: true,
    });

    useContextKey("hasSelection", isFocused && hasSelection, {
      scopeId,
      resetOnUnmount: true,
    });

    useEffect(() => {
      return () => {
        focusCleanupRef.current?.();
        focusCleanupRef.current = null;
        setIsFocused(false);
        setHasSelection(false);
      };
    }, []);

    // Note: Worker lifecycle removed - Tauri-only app uses Rust backend directly

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

    // NOTE: We DO NOT register a global command for executeQuery here because:
    // 1. Multiple editor instances would conflict (they all use the same command ID)
    // 2. CodeMirror's keymap already handles Cmd+Enter locally per-editor
    // 3. The global keybinding would trigger the last-registered handler, causing multiple tabs to execute
    //
    // If we need global command palette support, we should use a different approach like:
    // - Query the focused editor instance from a registry
    // - Or dispatch an event that only the focused editor listens to

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
      [],
    );

    // Theme extensions - only changes when theme changes
    const themeExtensions = useMemo(
      () => getThemeExtensions(actualTheme),
      [actualTheme],
    );

    // Stable refs for callbacks to avoid extension rebuilds
    const onExecuteRef = useRef(onExecute);
    const onEnterRef = useRef(onEnter);

    useEffect(() => {
      onExecuteRef.current = onExecute;
      onEnterRef.current = onEnter;
    }, [onExecute, onEnter]);

    // Create stable wrappers to pass to extensions
    // This avoids accessing refs during render while keeping the dependency stable
    const onExecuteWrapper = useCallback((query?: string) => {
      onExecuteRef.current?.(query);
    }, []);

    const onEnterWrapper = useCallback(() => {
      return onEnterRef.current?.() ?? false;
    }, []);

    // Core extensions - stable, only rebuilds when language/connection config changes
    const coreExtensions = useMemo(
      () =>
        getEditorExtensions(
          language,
          dialect,
          readOnly,
          lineNumbers,
          // eslint-disable-next-line react-hooks/refs
          onExecuteWrapper,
          // eslint-disable-next-line react-hooks/refs
          onEnterWrapper,
          connectionId,
          database,
          schema,
          { disableExecuteKeymap },
        ),
      [
        language,
        dialect,
        readOnly,
        lineNumbers,
        onExecuteWrapper,
        onEnterWrapper,
        connectionId,
        database,
        schema,
        disableExecuteKeymap,
      ],
    );

    // Combined extensions array
    const extensions = useMemo(
      () => [...coreExtensions, ...themeExtensions, layoutExtensions],
      [coreExtensions, themeExtensions, layoutExtensions],
    );

    // Consolidated auto-focus effect
    // Handles: initial mount, autoFocus prop change, and tab activation (value change)
    useEffect(() => {
      if (!autoFocus || !editorRef.current) return;

      // Don't auto-focus if the value change came from typing (editor already has focus)
      if (editorRef.current.hasFocus) return;

      const timeoutId = setTimeout(() => {
        editorRef.current?.focus();
      }, FOCUS_DELAY_MS);

      return () => {
        clearTimeout(timeoutId);
      };
    }, [autoFocus, value]);

    return (
      <div
        className={`code-editor h-full flex flex-col select-text ${className}`}
        style={{ userSelect: "text" }}
      >
        <CodeMirror
          key={`${language}-${dialect}`}
          value={initialDoc}
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
            const updateSelectionState = () => {
              const selection = view.state.selection.main;
              setHasSelection(selection.from !== selection.to);
            };
            const handleFocus = () => {
              setIsFocused(true);
            };
            const handleBlur = () => {
              setIsFocused(false);
            };
            view.dom.addEventListener("focus", handleFocus, true);
            view.dom.addEventListener("blur", handleBlur, true);
            focusCleanupRef.current = () => {
              view.dom.removeEventListener("focus", handleFocus, true);
              view.dom.removeEventListener("blur", handleBlur, true);
            };
            setIsFocused(view.hasFocus);
            updateSelectionState();
            view.dispatch({
              effects: StateEffect.appendConfig.of(
                EditorView.updateListener.of((update) => {
                  if (update.selectionSet) {
                    const selection = update.state.selection.main;
                    setHasSelection(selection.from !== selection.to);
                  }
                }),
              ),
            });
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
