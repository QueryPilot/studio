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
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "./themes";
import { getEditorExtensions } from "./extensions";
import type { CodeEditorProps } from "./types";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import { useScopedKeybindings, useContextKey } from "@/hooks/useContextKey";

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
            console.log('[executeQuery command] Handler called with args:', args);

            // If args provided, use them
            const queryArg =
              typeof args === "string"
                ? args
                : Array.isArray(args) && typeof args[0] === "string"
                ? args[0]
                : undefined;

            // If we have an editor view, extract query at cursor
            if (!queryArg && editorRef.current) {
              console.log('[executeQuery command] No args, extracting query at cursor from EditorView');
              const view = editorRef.current;
              const state = view.state;
              const doc = state.doc.toString();
              const selection = state.selection.main;

              console.log('[executeQuery command] Editor state:', {
                docLength: doc.length,
                cursorPos: selection.from,
                hasSelection: selection.from !== selection.to,
              });

              // If there's a selection, use it
              if (selection.from !== selection.to) {
                const selectedQuery = state
                  .sliceDoc(selection.from, selection.to)
                  .trim()
                  .replace(/;\s*$/, "");
                console.log('[executeQuery command] Using selected text:', selectedQuery);
                handleExecute(selectedQuery);
                return;
              }

              // Otherwise extract query at cursor (same logic as getQueryAtCursor)
              const findSemicolonsNotInStrings = (text: string): number[] => {
                const positions: number[] = [];
                let inSingleQuote = false;
                let inDoubleQuote = false;
                let inBacktick = false;
                let inDollarQuote = false;
                let dollarQuoteTag = "";
                let inLineComment = false;
                let inBlockComment = false;

                for (let i = 0; i < text.length; i++) {
                  const char = text[i];
                  const nextChar = i < text.length - 1 ? text[i + 1] : "";
                  const prevChar = i > 0 ? text[i - 1] : "";

                  if (!inBlockComment && !inSingleQuote && !inDoubleQuote && !inBacktick && !inDollarQuote) {
                    if (char === "-" && nextChar === "-") {
                      inLineComment = true;
                      i++;
                      continue;
                    }
                  }

                  if (inLineComment) {
                    if (char === "\n") inLineComment = false;
                    continue;
                  }

                  if (!inLineComment && !inSingleQuote && !inDoubleQuote && !inBacktick && !inDollarQuote) {
                    if (char === "/" && nextChar === "*") {
                      inBlockComment = true;
                      i++;
                      continue;
                    }
                  }

                  if (inBlockComment) {
                    if (char === "*" && nextChar === "/") {
                      inBlockComment = false;
                      i++;
                    }
                    continue;
                  }

                  if (char === "$" && !inSingleQuote && !inDoubleQuote && !inBacktick && !inLineComment && !inBlockComment) {
                    const dollarMatch = text.slice(i).match(/^(\$\w*\$)/);
                    if (dollarMatch && dollarMatch[1]) {
                      const tag = dollarMatch[1];
                      if (inDollarQuote && tag === dollarQuoteTag) {
                        inDollarQuote = false;
                        dollarQuoteTag = "";
                        i += tag.length - 1;
                        continue;
                      } else if (!inDollarQuote) {
                        inDollarQuote = true;
                        dollarQuoteTag = tag;
                        i += tag.length - 1;
                        continue;
                      }
                    }
                  }

                  if (!inDollarQuote && !inLineComment && !inBlockComment) {
                    if (char === "'" && prevChar !== "\\") {
                      inSingleQuote = !inSingleQuote;
                    } else if (char === '"' && prevChar !== "\\") {
                      inDoubleQuote = !inDoubleQuote;
                    } else if (char === "`" && prevChar !== "\\") {
                      inBacktick = !inBacktick;
                    }
                  }

                  if (
                    char === ";" &&
                    !inSingleQuote &&
                    !inDoubleQuote &&
                    !inBacktick &&
                    !inDollarQuote &&
                    !inLineComment &&
                    !inBlockComment
                  ) {
                    positions.push(i);
                  }
                }

                return positions;
              };

              const cursorPos = selection.from;
              const semicolons = findSemicolonsNotInStrings(doc);

              let queryStart = 0;
              let queryEnd = doc.length;

              for (const pos of semicolons) {
                if (pos < cursorPos) {
                  queryStart = pos + 1;
                } else {
                  queryEnd = pos;
                  break;
                }
              }

              const query = doc.slice(queryStart, queryEnd).trim();
              const cleanedQuery = query.replace(/;\s*$/, "");

              console.log('[executeQuery command] Extracted query at cursor:', {
                queryStart,
                queryEnd,
                semicolonCount: semicolons.length,
                query: cleanedQuery,
              });

              handleExecute(cleanedQuery);
              return;
            }

            console.log('[executeQuery command] Using queryArg:', queryArg);
            handleExecute(queryArg);
          },
        },
        "default",
      );
      commandRegisteredRef.current = true;
    }, [handleExecute, keyboardServices, onExecute]);

    // Memoize the theme extensions
    const themeExtensions = useMemo(() => {
      return getThemeExtensions(actualTheme);
    }, [actualTheme]);

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
          { disableExecuteKeymap },
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
      disableExecuteKeymap,
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
              }, 100);
            }
          }}
          basicSetup={{
            lineNumbers: false, // We handle this in extensions
            foldGutter: false,
            autocompletion: false, // Managed by extensions
            defaultKeymap: false, // We add this manually in extensions
          }}
          onFocus={() => {
            setIsFocused(true);
            registerExecuteCommand();
          }}
          onBlur={() => {
            setIsFocused(false);
            if (keyboardServices && commandRegisteredRef.current) {
              keyboardServices.commandService.unregister(
                "editor.action.executeQuery",
              );
              commandRegisteredRef.current = false;
            }
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
