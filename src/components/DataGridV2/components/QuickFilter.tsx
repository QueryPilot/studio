import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from "react";
import { Search, Code, Sparkles, X, Loader2, CopyIcon } from "lucide-react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { useTheme } from "@/components/theme-provider";
import { linter, type Diagnostic } from "@codemirror/lint";
import { PgParser } from "@supabase/pg-parser";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FilterMode, ColumnMeta } from "@/utils/filterParser";
import { useAIChatStore } from "@/stores/aiChatStore";
import { Shimmer } from "@/components/ai-elements/shimmer";

interface QuickFilterProps {
  columns: ColumnMeta[];
  value: string;
  mode: FilterMode;
  onValueChange: (value: string) => void;
  onModeChange: (mode: FilterMode) => void;
  onSubmit: () => void;
  isLoading?: boolean;
  error?: string | null;
  explanation?: string | null;
}

export interface QuickFilterRef {
  focus: () => void;
}

const modeConfig: Record<
  FilterMode,
  {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    description: string;
    placeholder: string;
  }
> = {
  search: {
    icon: Search,
    label: "Simple Search",
    description: "Match any column",
    placeholder: "Search anything... (! case-sensitive, ? SQL, # AI)",
  },
  where: {
    icon: Code,
    label: "WHERE Clause",
    description: "SQL expressions",
    placeholder: "age > 25 AND status = 'active'",
  },
  ai: {
    icon: Sparkles,
    label: "AI Assistant",
    description: "Natural language",
    placeholder: "active users from last week",
  },
};

export const QuickFilter = forwardRef<QuickFilterRef, QuickFilterProps>(
  function QuickFilter(
    {
      columns,
      value,
      mode,
      onValueChange,
      onModeChange,
      onSubmit,
      isLoading = false,
      error = null,
      explanation = null,
    },
    ref,
  ) {
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [suggestions, setSuggestions] = useState<ColumnMeta[]>([]);
    const [enumSuggestions, setEnumSuggestions] = useState<string[]>([]);
    const [suggestionType, setSuggestionType] = useState<"column" | "enum">(
      "column",
    );
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [hasLintError, setHasLintError] = useState(false);
    const pgParserRef = useRef<PgParser | null>(null);

    // Theme for CodeMirror
    const { resolvedTheme } = useTheme();
    const editorViewRef = useRef<EditorView | null>(null);

    // Initialize pg-parser
    useEffect(() => {
      const initParser = async () => {
        if (!pgParserRef.current) {
          const parser = new PgParser();
          await parser.ready;
          pgParserRef.current = parser;
        }
      };
      initParser().catch(console.error);
    }, []);

    // Expose focus method to parent
    useImperativeHandle(ref, () => ({
      focus: () => {
        editorViewRef.current?.focus();
      },
    }));

    const config = modeConfig[mode];
    const ModeIcon = config.icon;

    // CodeMirror extensions for SQL highlighting
    const sqlExtensions = useMemo(() => {
      const actualTheme = resolvedTheme === "dark" ? "dark" : "light";

      // Get syntax highlighting styles only (we'll override backgrounds)
      const themeExts = getThemeExtensions(actualTheme);

      return [
        sql({ dialect: PostgreSQL }),
        ...themeExts,
        // Override theme backgrounds - must come after theme extensions
        EditorView.theme(
          {
            "&.cm-editor": {
              fontSize: "12px",
              backgroundColor: "transparent !important",
            },
            ".cm-scroller": {
              overflow: "hidden",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            },
            ".cm-content": {
              padding: "6px 0",
              minHeight: "auto",
              caretColor: actualTheme === "dark" ? "#FCA311" : "#EA9A0F",
            },
            ".cm-line": {
              padding: "0",
            },
            ".cm-gutters": {
              display: "none !important",
            },
            ".cm-activeLineGutter": {
              backgroundColor: "transparent !important",
            },
            ".cm-activeLine": {
              backgroundColor: "transparent !important",
            },
            "&.cm-focused": {
              outline: "none",
            },
            ".cm-placeholder": {
              color: "hsl(var(--muted-foreground))",
              fontStyle: "normal",
            },
          },
          { dark: actualTheme === "dark" },
        ),
        EditorView.lineWrapping,
        // SQL linter for WHERE clause validation
        linter(
          async (view: EditorView): Promise<Diagnostic[]> => {
            const content = view.state.doc.toString().trim();
            if (!content || !pgParserRef.current) {
              setHasLintError(false);
              return [];
            }

            try {
              // Wrap WHERE clause in SELECT to make it valid SQL
              const testSql = `SELECT * FROM t WHERE ${content}`;
              const result = await pgParserRef.current.parse(testSql);

              if (result.error) {
                setHasLintError(true);
                // Adjust position to account for "SELECT * FROM t WHERE " prefix (23 chars)
                const prefixLen = 23;
                let from = 0;
                let to = content.length;

                const errorWithPosition = result.error as unknown as { position?: number };
                if (errorWithPosition.position !== undefined && errorWithPosition.position > prefixLen) {
                  from = errorWithPosition.position - prefixLen - 1;
                  to = Math.min(from + 20, content.length);
                }

                return [{
                  from: Math.max(0, from),
                  to: Math.min(to, content.length),
                  severity: "error",
                  message: result.error.message || "Syntax error",
                }];
              }

              setHasLintError(false);
              return [];
            } catch (error) {
              setHasLintError(false);
              return [];
            }
          },
          { delay: 200 }
        ),
      ];
    }, [resolvedTheme]);

    // AI model selection
    const {
      selectedProvider,
      selectedModel,
      availableProviders,
      configuredProviders,
      isLoadingProviders,
      setProvider,
      setModel,
      loadProviders,
    } = useAIChatStore();

    // Load providers when entering AI mode
    useEffect(() => {
      if (mode === "ai") {
        void loadProviders();
      }
    }, [mode, loadProviders]);

    // Update suggestions based on input
    useEffect(() => {
      if (mode !== "where" && mode !== "ai") {
        setShowSuggestions(false);
        return;
      }

      // Get word at cursor
      const beforeCursor = value.slice(0, cursorPosition);
      const match = beforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);

      if (match) {
        // Check if we're in a value context (after an operator)
        const textBeforeWord = beforeCursor
          .slice(0, beforeCursor.length - match[0].length)
          .trim();
        const isAfterOperator =
          /[=<>!]+\s*$|(?:LIKE|ILIKE|IN|IS|BETWEEN)\s*$/i.test(textBeforeWord);
        const isAfterQuote = /['"]$/.test(textBeforeWord);

        if (isAfterOperator || isAfterQuote) {
          // We're typing a value - check if the column has enum values
          // Extract the column name before the operator
          const columnMatch = textBeforeWord.match(
            /([a-zA-Z_][a-zA-Z0-9_]*)\s*[=<>!]+\s*$|([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:LIKE|ILIKE|IN|IS|BETWEEN)\s*$/i,
          );
          const columnName = columnMatch?.[1] || columnMatch?.[2];

          if (columnName) {
            const column = columns.find(
              (c) => c.name.toLowerCase() === columnName.toLowerCase(),
            );
            if (column?.enumValues && column.enumValues.length > 0) {
              const searchTerm = match[0].toLowerCase();
              const filtered = column.enumValues.filter((v) =>
                v.toLowerCase().includes(searchTerm),
              );
              if (filtered.length > 0) {
                setEnumSuggestions(filtered);
                setSuggestionType("enum");
                setShowSuggestions(true);
                setSelectedIndex(0);
                return;
              }
            }
          }
          setShowSuggestions(false);
          return;
        }

        // We're typing a column name
        const searchTerm = match[0].toLowerCase();
        const filtered = columns.filter((c) =>
          c.name.toLowerCase().includes(searchTerm),
        );
        setSuggestions(filtered);
        setSuggestionType("column");
        setShowSuggestions(filtered.length > 0);
        setSelectedIndex(0);
      } else {
        // Check if cursor is right after operator with no text yet
        const trimmedBefore = beforeCursor.trim();
        const operatorMatch = trimmedBefore.match(
          /([a-zA-Z_][a-zA-Z0-9_]*)\s*[=<>!]+\s*$|([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:LIKE|ILIKE|IN|IS|BETWEEN)\s*$/i,
        );

        if (operatorMatch) {
          const columnName = operatorMatch[1] || operatorMatch[2];
          const column = columns.find(
            (c) => c.name.toLowerCase() === columnName.toLowerCase(),
          );
          if (column?.enumValues && column.enumValues.length > 0) {
            setEnumSuggestions(column.enumValues);
            setSuggestionType("enum");
            setShowSuggestions(true);
            setSelectedIndex(0);
            return;
          }
        }
        setShowSuggestions(false);
      }
    }, [value, cursorPosition, columns, mode]);

    const insertSuggestion = useCallback(
      (text: string, isEnum: boolean = false) => {
        const beforeCursor = value.slice(0, cursorPosition);
        const afterCursor = value.slice(cursorPosition);

        // Find start of current word
        const match = beforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
        const wordStart = match
          ? cursorPosition - match[0].length
          : cursorPosition;

        // For enum values, wrap in quotes
        const insertText = isEnum ? `'${text}'` : text;
        const newValue = value.slice(0, wordStart) + insertText + afterCursor;
        onValueChange(newValue);
        setShowSuggestions(false);

        // Focus back to editor and set cursor position
        setTimeout(() => {
          const view = editorViewRef.current;
          if (view) {
            view.focus();
            const newPos = wordStart + insertText.length;
            view.dispatch({
              selection: { anchor: newPos, head: newPos },
            });
          }
        }, 0);
      },
      [value, cursorPosition, onValueChange],
    );

    // Get icon for current mode/prefix
    const getModeIcon = () => {
      if (value.startsWith("?")) return Code;
      if (value.startsWith("#")) return Sparkles;
      if (value.startsWith("!")) return Search;
      return null;
    };

    const ActiveModeIcon = getModeIcon();

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center">
          {/* Input with mode selector inside */}
          <div className="relative flex-1">
            <Popover open={showSuggestions} onOpenChange={setShowSuggestions}>
              <PopoverAnchor asChild>
                <div className="relative">
                  {/* Mode selector - inside input at left */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "absolute left-1 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center focus:outline-none",
                          "!h-6 !w-6 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-accent",
                          isLoading && "pointer-events-none opacity-50",
                        )}
                        disabled={isLoading}
                      >
                        {ActiveModeIcon ? (
                          <ActiveModeIcon className="h-3 w-3" />
                        ) : (
                          <ModeIcon className="h-3 w-3" />
                        )}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      {(Object.keys(modeConfig) as FilterMode[]).map((m) => {
                        const cfg = modeConfig[m];
                        const Icon = cfg.icon;
                        return (
                          <DropdownMenuItem
                            key={m}
                            onClick={(e) => {
                              // Keep dropdown open for AI mode to let user select model
                              if (m === "ai") {
                                e.preventDefault();
                              }
                              onModeChange(m);
                              // Auto-add/replace prefix based on mode
                              const currentValue = value.replace(
                                /^[?#]\s*/,
                                "",
                              );
                              if (m === "where") {
                                onValueChange(
                                  currentValue ? `?${currentValue}` : "?",
                                );
                              } else if (m === "ai") {
                                onValueChange(
                                  currentValue ? `#${currentValue}` : "#",
                                );
                              } else {
                                onValueChange(currentValue);
                              }
                              // Focus input after mode change (not for AI mode - user selects model first)
                              if (m !== "ai") {
                                setTimeout(() => inputRef.current?.focus(), 0);
                              }
                            }}
                            className={cn("text-xs", mode === m && "bg-accent")}
                          >
                            <Icon className="h-3.5 w-3.5 mr-2" />
                            <div className="flex flex-col">
                              <span className="text-xs">{cfg.label}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {cfg.description}
                              </span>
                            </div>
                          </DropdownMenuItem>
                        );
                      })}

                      {/* AI Model selector - nested in mode dropdown */}
                      {mode === "ai" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            AI Model
                          </DropdownMenuLabel>
                          {isLoadingProviders ? (
                            <DropdownMenuItem disabled className="text-xs pl-4">
                              <Loader2 className="h-3 w-3 animate-spin mr-2" />
                              Loading...
                            </DropdownMenuItem>
                          ) : (
                            (() => {
                              const configured = availableProviders.filter(
                                (p) => configuredProviders.includes(p.name),
                              );
                              if (configured.length === 0) {
                                return (
                                  <DropdownMenuItem
                                    disabled
                                    className="text-xs pl-4"
                                  >
                                    No providers configured
                                  </DropdownMenuItem>
                                );
                              }
                              return configured.map((provider) => (
                                <div key={provider.name}>
                                  <DropdownMenuLabel className="text-[10px] text-muted-foreground pl-4">
                                    {provider.name}
                                  </DropdownMenuLabel>
                                  {provider.models.map((model) => (
                                    <DropdownMenuItem
                                      key={`${provider.name}-${model}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setProvider(provider.name);
                                        setModel(model);
                                      }}
                                      className={cn(
                                        "text-xs pl-6",
                                        selectedProvider === provider.name &&
                                          selectedModel === model &&
                                          "bg-accent",
                                      )}
                                    >
                                      {model}
                                    </DropdownMenuItem>
                                  ))}
                                </div>
                              ));
                            })()
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div
                    className={cn(
                      "min-h-7 max-h-20 w-full rounded-md border border-input bg-background pl-8 pr-7 text-xs",
                      "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
                      error &&
                        "border-destructive focus-within:ring-destructive/50",
                      value && !error && "border-primary/50",
                    )}
                  >
                    <CodeMirror
                      value={
                        // Always strip mode prefixes from display
                        value.startsWith("?") || value.startsWith("#") || value.startsWith("!")
                          ? value.slice(1)
                          : value
                      }
                      onChange={(newValue) => {
                        // Always add prefix based on current mode
                        const prefix =
                          mode === "where"
                            ? "?"
                            : mode === "ai"
                            ? "#"
                            : "";
                        onValueChange(prefix + newValue);
                      }}
                      extensions={[
                        // Only use SQL highlighting for where mode
                        ...(mode === "where"
                          ? sqlExtensions
                          : [
                              // Basic extensions for non-SQL modes
                              ...getThemeExtensions(
                                resolvedTheme === "dark" ? "dark" : "light",
                              ),
                              EditorView.theme(
                                {
                                  "&.cm-editor": {
                                    fontSize: "12px",
                                    backgroundColor: "transparent !important",
                                  },
                                  ".cm-scroller": {
                                    overflow: "hidden",
                                    fontFamily:
                                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                  },
                                  ".cm-content": {
                                    padding: "6px 0",
                                    minHeight: "auto",
                                  },
                                  ".cm-line": {
                                    padding: "0",
                                  },
                                  ".cm-gutters": {
                                    display: "none !important",
                                  },
                                  ".cm-activeLineGutter": {
                                    backgroundColor: "transparent !important",
                                  },
                                  ".cm-activeLine": {
                                    backgroundColor: "transparent !important",
                                  },
                                  "&.cm-focused": {
                                    outline: "none",
                                  },
                                  ".cm-placeholder": {
                                    color: "hsl(var(--muted-foreground))",
                                    fontStyle: "normal",
                                  },
                                },
                                { dark: resolvedTheme === "dark" },
                              ),
                              EditorView.lineWrapping,
                            ]),
                        Prec.highest(
                          keymap.of([
                            {
                              key: "Enter",
                              run: () => {
                                if (showSuggestions) {
                                  const currentSuggestions =
                                    suggestionType === "enum"
                                      ? enumSuggestions
                                      : suggestions;
                                  if (currentSuggestions.length > 0) {
                                    if (suggestionType === "enum") {
                                      const enumValue =
                                        enumSuggestions[selectedIndex];
                                      if (enumValue) {
                                        insertSuggestion(enumValue, true);
                                      }
                                    } else {
                                      const suggestion =
                                        suggestions[selectedIndex];
                                      if (suggestion) {
                                        insertSuggestion(
                                          suggestion.name,
                                          false,
                                        );
                                      }
                                    }
                                    return true;
                                  }
                                }
                                // Block submission if there's a lint error in WHERE mode
                                if (mode === "where" && hasLintError) {
                                  return true;
                                }
                                onSubmit();
                                return true;
                              },
                            },
                            {
                              key: "Escape",
                              run: () => {
                                if (showSuggestions) {
                                  setShowSuggestions(false);
                                  return true;
                                }
                                if (value) {
                                  onValueChange("");
                                  return true;
                                }
                                return false;
                              },
                            },
                            {
                              key: "ArrowDown",
                              run: () => {
                                if (showSuggestions) {
                                  const currentSuggestions =
                                    suggestionType === "enum"
                                      ? enumSuggestions
                                      : suggestions;
                                  setSelectedIndex((i) =>
                                    Math.min(
                                      i + 1,
                                      currentSuggestions.length - 1,
                                    ),
                                  );
                                  return true;
                                }
                                return false;
                              },
                            },
                            {
                              key: "ArrowUp",
                              run: () => {
                                if (showSuggestions) {
                                  setSelectedIndex((i) => Math.max(i - 1, 0));
                                  return true;
                                }
                                return false;
                              },
                            },
                            {
                              key: "Tab",
                              run: () => {
                                if (showSuggestions) {
                                  const currentSuggestions =
                                    suggestionType === "enum"
                                      ? enumSuggestions
                                      : suggestions;
                                  if (currentSuggestions.length > 0) {
                                    if (suggestionType === "enum") {
                                      const enumValue =
                                        enumSuggestions[selectedIndex];
                                      if (enumValue) {
                                        insertSuggestion(enumValue, true);
                                      }
                                    } else {
                                      const suggestion =
                                        suggestions[selectedIndex];
                                      if (suggestion) {
                                        insertSuggestion(
                                          suggestion.name,
                                          false,
                                        );
                                      }
                                    }
                                    return true;
                                  }
                                }
                                return false;
                              },
                            },
                            {
                              key: "Backspace",
                              run: () => {
                                // Get display value (without prefix)
                                const displayValue =
                                  (value.startsWith("?") && mode === "where") ||
                                  (value.startsWith("#") && mode === "ai") ||
                                  (value.startsWith("!") && mode === "search")
                                    ? value.slice(1)
                                    : value;

                                if (displayValue === "") {
                                  // Remove prefix and go back to search mode
                                  if (
                                    value.startsWith("?") ||
                                    value.startsWith("#") ||
                                    value.startsWith("!")
                                  ) {
                                    onValueChange("");
                                    onModeChange("search");
                                    return true;
                                  }
                                }
                                return false;
                              },
                            },
                            {
                              key: "Mod-.",
                              run: () => {
                                setSuggestions(columns);
                                setSuggestionType("column");
                                setShowSuggestions(columns.length > 0);
                                setSelectedIndex(0);
                                return true;
                              },
                            },
                          ]),
                        ),
                      ]}
                      placeholder={config.placeholder}
                      editable={!isLoading}
                      basicSetup={false}
                      height="auto"
                      minHeight="28px"
                      maxHeight="80px"
                      onCreateEditor={(view) => {
                        editorViewRef.current = view;
                      }}
                      onUpdate={(update) => {
                        if (update.selectionSet) {
                          const pos = update.state.selection.main.head;
                          // Calculate prefix length
                          const prefixLen =
                            (value.startsWith("?") && mode === "where") ||
                            (value.startsWith("#") && mode === "ai") ||
                            (value.startsWith("!") && mode === "search")
                              ? 1
                              : 0;
                          setCursorPosition(pos + prefixLen);
                        }
                      }}
                    />
                  </div>
                  {/* Shimmer overlay when loading */}
                  {isLoading && value && (
                    <div className="absolute inset-0 flex items-center pl-8 pr-7 pointer-events-none bg-background rounded-md">
                      <Shimmer
                        as="span"
                        className="text-xs truncate"
                        duration={30}
                        spread={1}
                      >
                        {value || "Generating..."}
                      </Shimmer>
                    </div>
                  )}
                  {/* Clear/Loading indicator - inside the wrapper */}
                  <div className="absolute right-1 top-1/2 -translate-y-1/2">
                    {isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : value ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 mt-0.5"
                        onClick={() => {
                          onValueChange("");
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </PopoverAnchor>
              <PopoverContent
                className="w-64 p-1"
                align="start"
                onOpenAutoFocus={(e) => {
                  e.preventDefault();
                }}
              >
                <div className="max-h-48 overflow-y-auto">
                  {suggestionType === "enum"
                    ? enumSuggestions.map((enumValue, idx) => (
                        <button
                          key={enumValue}
                          type="button"
                          onClick={() => {
                            insertSuggestion(enumValue, true);
                          }}
                          className={cn(
                            "w-full text-left px-2 py-1 text-xs rounded",
                            "hover:bg-accent",
                            idx === selectedIndex && "bg-accent",
                          )}
                        >
                          <span className="font-mono">'{enumValue}'</span>
                        </button>
                      ))
                    : suggestions.map((col, idx) => (
                        <button
                          key={col.name}
                          type="button"
                          onClick={() => {
                            insertSuggestion(col.name, false);
                          }}
                          className={cn(
                            "w-full text-left px-2 py-1 text-xs rounded",
                            "hover:bg-accent",
                            idx === selectedIndex && "bg-accent",
                          )}
                        >
                          <span className="font-mono">{col.name}</span>
                          <span className="ml-2 text-muted-foreground">
                            ({col.dataType})
                          </span>
                        </button>
                      ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <p className="text-xs text-destructive px-1 truncate" title={error}>
            {error}
          </p>
        )}

        {/* AI explanation */}
        {explanation && !error && (
          <div className="flex items-center gap-1 ml-2">
            <CopyIcon className="h-3 w-3 text-muted-foreground" />
            <p
              className="text-xs text-muted-foreground px-1 truncate select-text"
              title={explanation}
            >
              {explanation}
            </p>
          </div>
        )}
      </div>
    );
  },
);
