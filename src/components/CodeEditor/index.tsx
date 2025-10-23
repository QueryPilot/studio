import {
  useEffect,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "./themes";
import { getEditorExtensions } from "./extensions";
import type { CodeEditorProps } from "./types";
import "./autocomplete.css";

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
    const { resolvedTheme } = useTheme();

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

    // Memoize the theme extensions
    const themeExtensions = useMemo(() => {
      return getThemeExtensions(actualTheme);
    }, [actualTheme]);

    // Create extensions
    const extensions = useMemo(() => {
      return [
        ...getEditorExtensions(
          language,
          dialect,
          readOnly,
          lineNumbers,
          onExecute,
          onEnter,
          connectionId,
          database,
          schema,
        ),
        ...themeExtensions,
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
      ];
    }, [
      language,
      dialect,
      readOnly,
      lineNumbers,
      onExecute,
      onEnter,
      connectionId,
      database,
      schema,
      themeExtensions,
    ]);

    // Handle auto-focus - focus on mount and when autoFocus changes
    useEffect(() => {
      if (autoFocus && editorRef.current) {
        // Small delay to ensure editor is fully rendered
        setTimeout(() => {
          editorRef.current?.focus();
        }, 100);
      }
    }, [autoFocus]);

    // Also focus when value changes (e.g., when tab becomes active)
    useEffect(() => {
      if (autoFocus && editorRef.current) {
        // Small delay to ensure editor is fully rendered
        setTimeout(() => {
          editorRef.current?.focus();
        }, 100);
      }
    }, [value, autoFocus]);

    return (
      <div
        className={`code-editor h-full flex flex-col select-text ${className}`}
        style={{ userSelect: "text" }}
      >
        <CodeMirror
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
            editorRef.current = view;
            // Auto-focus when editor is created if autoFocus is true
            if (autoFocus) {
              setTimeout(() => {
                view.focus();
              }, 100);
            }
          }}
          basicSetup={{
            lineNumbers: false, // We handle this in extensions
            foldGutter: false,
            autocompletion: false, // Managed by extensions
            defaultKeymap: false, // We add this manually in extensions
          }}
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
