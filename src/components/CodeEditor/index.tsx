import { useEffect, useRef, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
// Autocomplete and triggers are provided via getEditorExtensions
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { githubLight } from "@uiw/codemirror-theme-github";
import { useTheme } from "@/components/theme-provider";
import { foldGutterTheme } from "./themes";
import { getEditorExtensions } from "./extensions";
import type { CodeEditorProps } from "./types";
import "./autocomplete.css";

export function CodeEditor({
  value,
  onChange,
  onExecute,
  language = "sql",
  dialect = "plsql",
  connectionId,
  readOnly = false,
  height = "100%",
  theme = "auto",
  placeholder = "",
  autoFocus = false,
  lineNumbers = true,
  className = "",
  minHeight = "100px",
  maxHeight = "100%",
}: CodeEditorProps) {
  const editorRef = useRef<EditorView | null>(null);
  const { resolvedTheme } = useTheme();

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

  // Memoize the theme object to prevent recreation
  const editorTheme = useMemo(() => {
    return actualTheme === "dark" ? vscodeDark : githubLight;
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
        connectionId,
      ),
      foldGutterTheme,
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
    minHeight,
    maxHeight,
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
    if (autoFocus && editorRef.current && value !== undefined) {
      // Small delay to ensure editor is fully rendered
      setTimeout(() => {
        editorRef.current?.focus();
      }, 100);
    }
  }, [value, autoFocus]);

  return (
    <div className={`code-editor h-full flex flex-col ${className}`}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        editable={!readOnly}
        placeholder={placeholder}
        height={height}
        minHeight={minHeight}
        maxHeight={maxHeight}
        theme={editorTheme}
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
        }}
      />
    </div>
  );
}

// Export types for external use
export type {
  CodeEditorProps,
  CodeEditorLanguage,
  SqlDialect,
  EditorTheme,
} from "./types";
