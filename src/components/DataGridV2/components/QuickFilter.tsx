import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
  memo,
} from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { IconSearch, IconCode, IconSparkles, IconX, IconLoader2, IconCopy } from '@tabler/icons-react';
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
    icon: IconSearch,
    label: "Simple Search",
    description: "Match any column",
    placeholder: "Search anything... (! case-sensitive, ? SQL, # AI)",
  },
  where: {
    icon: IconCode,
    label: "WHERE Clause",
    description: "SQL expressions",
    placeholder: "age > 25 AND status = 'active'",
  },
  ai: {
    icon: IconSparkles,
    label: "AI Assistant",
    description: "Natural language",
    placeholder: "active users from last week",
  },
};

// Pre-compiled regex patterns for performance (Phase 3.1)
const WORD_AT_CURSOR_REGEX = /[a-zA-Z_][a-zA-Z0-9_]*$/;
const OPERATOR_REGEX = /[=<>!]+\s*$|(?:LIKE|ILIKE|IN|IS|BETWEEN)\s*$/i;
const QUOTE_REGEX = /['"]$/;
const COLUMN_EXTRACTION_REGEX = /([a-zA-Z_][a-zA-Z0-9_]*)\s*[=<>!]+\s*['"]?$|([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:LIKE|ILIKE|IN|IS|BETWEEN)\s*['"]?$/i;

// Memoized suggestion item components (Phase 2.3)
interface EnumSuggestionItemProps {
  value: string;
  isSelected: boolean;
  onSelect: (value: string) => void;
}

const EnumSuggestionItem = memo<EnumSuggestionItemProps>(({ value, isSelected, onSelect }) => {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        "w-full text-left px-2 py-1 text-xs rounded",
        "hover:bg-accent",
        isSelected && "bg-accent"
      )}
    >
      <span className="font-mono">'{value}'</span>
    </button>
  );
});
EnumSuggestionItem.displayName = "EnumSuggestionItem";

interface ColumnSuggestionItemProps {
  column: ColumnMeta;
  isSelected: boolean;
  onSelect: (name: string) => void;
}

const ColumnSuggestionItem = memo<ColumnSuggestionItemProps>(({ column, isSelected, onSelect }) => {
  return (
    <button
      type="button"
      onClick={() => onSelect(column.name)}
      className={cn(
        "w-full text-left px-2 py-1 text-xs rounded",
        "hover:bg-accent",
        isSelected && "bg-accent"
      )}
    >
      <span className="font-mono">{column.name}</span>
      <span className="ml-2 text-muted-foreground">({column.dataType})</span>
    </button>
  );
});
ColumnSuggestionItem.displayName = "ColumnSuggestionItem";

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
    const justAcceptedSuggestion = useRef(false);

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
      getProviderEnabledModels,
    } = useAIChatStore();

    // Load providers when entering AI mode
    useEffect(() => {
      if (mode === "ai") {
        void loadProviders();
      }
    }, [mode, loadProviders]);

    // Debounce value and cursor position to reduce expensive operations (Phase 1.1)
    const debouncedValue = useDebounce(value, 150);
    const debouncedCursor = useDebounce(cursorPosition, 150);

    // Memoize column map for O(1) lookups (Phase 1.3)
    const columnMap = useMemo(() => {
      const map = new Map<string, ColumnMeta>();
      columns.forEach(col => map.set(col.name.toLowerCase(), col));
      return map;
    }, [columns]);

    // Memoize filtered columns helper (Phase 1.3)
    const getFilteredColumns = useCallback((searchTerm: string) => {
      const lowerSearch = searchTerm.toLowerCase();
      return columns.filter(c => c.name.toLowerCase().includes(lowerSearch));
    }, [columns]);

    // Update suggestions based on input
    useEffect(() => {
      if (mode !== "where" && mode !== "ai") {
        setShowSuggestions(false);
        return;
      }

      // Get word at cursor
      const beforeCursor = debouncedValue.slice(0, debouncedCursor);
      const match = beforeCursor.match(WORD_AT_CURSOR_REGEX);

      if (match) {
        // IconCheck if we're in a value context (after an operator)
        const textBeforeWord = beforeCursor
          .slice(0, beforeCursor.length - match[0].length)
          .trim();
        const isAfterOperator = OPERATOR_REGEX.test(textBeforeWord);
        const isAfterQuote = QUOTE_REGEX.test(textBeforeWord);

        if (isAfterOperator || isAfterQuote) {
          // We're typing a value - check if the column has enum values
          // Extract the column name before the operator (allow optional quote after operator)
          const columnMatch = textBeforeWord.match(COLUMN_EXTRACTION_REGEX);
          const columnName = columnMatch?.[1] || columnMatch?.[2];

          if (columnName) {
            const column = columnMap.get(columnName.toLowerCase());
            if (column?.enumValues && column.enumValues.length > 0) {
              const searchTerm = match[0].toLowerCase();
              const filtered = column.enumValues.filter((v) =>
                v.toLowerCase().includes(searchTerm),
              );
              if (filtered.length > 0) {
                setEnumSuggestions(filtered);
                setSuggestionType("enum");
                if (!justAcceptedSuggestion.current) {
                  setShowSuggestions(true);
                }
                setSelectedIndex(0);
                return;
              }
            }
          }
          setShowSuggestions(false);
          return;
        }

        // We're typing a column name
        const searchTerm = match[0];
        const filtered = getFilteredColumns(searchTerm);
        setSuggestions(filtered);
        setSuggestionType("column");
        if (filtered.length > 0 && !justAcceptedSuggestion.current) {
          setShowSuggestions(true);
        } else {
          setShowSuggestions(false);
        }
        setSelectedIndex(0);
      } else {
        // IconCheck if cursor is right after operator with no text yet
        const trimmedBefore = beforeCursor.trim();
        const operatorMatch = trimmedBefore.match(COLUMN_EXTRACTION_REGEX);

        if (operatorMatch) {
          const columnName = operatorMatch[1] || operatorMatch[2];
          const column = columnMap.get(columnName.toLowerCase());
          if (column?.enumValues && column.enumValues.length > 0) {
            setEnumSuggestions(column.enumValues);
            setSuggestionType("enum");
            if (!justAcceptedSuggestion.current) {
              setShowSuggestions(true);
            }
            setSelectedIndex(0);
            return;
          }
        }
        setShowSuggestions(false);
      }
    }, [debouncedValue, debouncedCursor, columns, mode]);

    const insertSuggestion = useCallback(
      (text: string, isEnum: boolean = false) => {
        const beforeCursor = value.slice(0, cursorPosition);
        const afterCursor = value.slice(cursorPosition);

        // Find start of current word
        const match = beforeCursor.match(WORD_AT_CURSOR_REGEX);
        const wordStart = match
          ? cursorPosition - match[0].length
          : cursorPosition;

        // For enum values, wrap in quotes
        const insertText = isEnum ? `'${text}'` : text;
        const newValue = value.slice(0, wordStart) + insertText + afterCursor;

        // Set flag to prevent suggestions from re-appearing
        justAcceptedSuggestion.current = true;

        // Hide suggestions immediately
        setShowSuggestions(false);

        // Calculate cursor position in editor coordinates (without prefix)
        const prefixLen =
          (newValue.startsWith("?") && mode === "where") ||
          (newValue.startsWith("#") && mode === "ai") ||
          (newValue.startsWith("!") && mode === "search")
            ? 1
            : 0;
        const editorPos = wordStart + insertText.length - prefixLen;

        // Update value and cursor position synchronously via editor
        const view = editorViewRef.current;
        if (view) {
          const changes = {
            from: 0,
            to: view.state.doc.length,
            insert: newValue.startsWith("?") || newValue.startsWith("#") || newValue.startsWith("!")
              ? newValue.slice(1)
              : newValue
          };

          const validPos = Math.max(0, Math.min(editorPos, changes.insert.length));

          view.dispatch({
            changes,
            selection: { anchor: validPos, head: validPos },
          });
          view.focus();
        }

        // Update parent value
        onValueChange(newValue);

        // Reset flag using requestAnimationFrame instead of setTimeout
        requestAnimationFrame(() => {
          justAcceptedSuggestion.current = false;
        });
      },
      [value, cursorPosition, onValueChange, mode],
    );

    // Clear button handler (Phase 1.4)
    const handleClearClick = useCallback(() => {
      onValueChange("");
    }, [onValueChange]);

    // CodeMirror change handler (Phase 1.4)
    const handleEditorChange = useCallback(
      (newValue: string) => {
        // Detect mode shortcuts and strip the prefix from editor
        if (newValue.startsWith("?") && mode !== "where") {
          onModeChange("where");
          const contentWithoutPrefix = newValue.slice(1);
          onValueChange("?" + contentWithoutPrefix);
          // Update editor to show content without prefix
          setTimeout(() => {
            const view = editorViewRef.current;
            if (view) {
              view.dispatch({
                changes: {
                  from: 0,
                  to: view.state.doc.length,
                  insert: contentWithoutPrefix,
                },
              });
            }
          }, 0);
          return;
        }
        if (newValue.startsWith("#") && mode !== "ai") {
          onModeChange("ai");
          const contentWithoutPrefix = newValue.slice(1);
          onValueChange("#" + contentWithoutPrefix);
          // Update editor to show content without prefix
          setTimeout(() => {
            const view = editorViewRef.current;
            if (view) {
              view.dispatch({
                changes: {
                  from: 0,
                  to: view.state.doc.length,
                  insert: contentWithoutPrefix,
                },
              });
            }
          }, 0);
          return;
        }
        if (newValue.startsWith("!") && mode !== "search") {
          onModeChange("search");
          const contentWithoutPrefix = newValue.slice(1);
          onValueChange("!" + contentWithoutPrefix);
          // Update editor to show content without prefix
          setTimeout(() => {
            const view = editorViewRef.current;
            if (view) {
              view.dispatch({
                changes: {
                  from: 0,
                  to: view.state.doc.length,
                  insert: contentWithoutPrefix,
                },
              });
            }
          }, 0);
          return;
        }

        // Add prefix for AI/WHERE modes if not present
        if (mode === "ai" && !newValue.startsWith("#")) {
          onValueChange("#" + newValue);
        } else if (mode === "where" && !newValue.startsWith("?")) {
          onValueChange("?" + newValue);
        } else if (mode === "search" && !newValue.startsWith("!")) {
          onValueChange("!" + newValue);
        } else {
          onValueChange(newValue);
        }
      },
      [mode, onModeChange, onValueChange]
    );

    // Limit rendered suggestions for performance (Phase 2.1)
    const MAX_VISIBLE_SUGGESTIONS = 50;
    const visibleSuggestions = useMemo(() => {
      return suggestions.slice(0, MAX_VISIBLE_SUGGESTIONS);
    }, [suggestions]);

    const visibleEnumSuggestions = useMemo(() => {
      return enumSuggestions.slice(0, MAX_VISIBLE_SUGGESTIONS);
    }, [enumSuggestions]);

    // Stable select handlers for memoized components (Phase 2.3)
    const handleEnumSelect = useCallback((enumValue: string) => {
      insertSuggestion(enumValue, true);
    }, [insertSuggestion]);

    const handleColumnSelect = useCallback((columnName: string) => {
      insertSuggestion(columnName, false);
    }, [insertSuggestion]);

    // Get icon for current mode/prefix
    const getModeIcon = () => {
      if (value.startsWith("?")) return IconCode;
      if (value.startsWith("#")) return IconSparkles;
      if (value.startsWith("!")) return IconSearch;
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
                              <IconLoader2 className="h-3 w-3 animate-spin mr-2" />
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
                              return configured.map((provider) => {
                                const enabledModels = getProviderEnabledModels(provider.name);
                                const filteredModels = provider.models.filter((m) =>
                                  enabledModels.includes(m.id),
                                );

                                // Skip provider if no enabled models
                                if (filteredModels.length === 0) return null;

                                return (
                                  <div key={provider.name}>
                                    <DropdownMenuLabel className="text-[10px] text-muted-foreground pl-4">
                                      {provider.name}
                                    </DropdownMenuLabel>
                                    {filteredModels.map((model) => (
                                      <DropdownMenuItem
                                        key={`${provider.name}-${model.id}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setProvider(provider.name);
                                          setModel(model.id);
                                        }}
                                        className={cn(
                                          "text-xs pl-6",
                                          selectedProvider === provider.name &&
                                            selectedModel === model.id &&
                                            "bg-accent",
                                        )}
                                      >
                                        {model.name}
                                      </DropdownMenuItem>
                                    ))}
                                  </div>
                                );
                              });
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
                      onChange={handleEditorChange}
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
                                justAcceptedSuggestion.current = false; // Allow manual trigger
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
                  {/* Clear/Loading indicator - inside the wrapper */}
                  <div className="absolute right-1 top-1/2 -translate-y-1/2">
                    {isLoading ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : value ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 mt-0.5"
                        onClick={handleClearClick}
                      >
                        <IconX className="h-3.5 w-3.5" />
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
                    ? visibleEnumSuggestions.map((enumValue, idx) => (
                        <EnumSuggestionItem
                          key={enumValue}
                          value={enumValue}
                          isSelected={idx === selectedIndex}
                          onSelect={handleEnumSelect}
                        />
                      ))
                    : visibleSuggestions.map((col, idx) => (
                        <ColumnSuggestionItem
                          key={col.name}
                          column={col}
                          isSelected={idx === selectedIndex}
                          onSelect={handleColumnSelect}
                        />
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
            <IconCopy className="h-3 w-3 text-muted-foreground" />
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
