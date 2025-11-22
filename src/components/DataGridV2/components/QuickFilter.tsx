import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Search, Code, Sparkles, X, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
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
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [suggestions, setSuggestions] = useState<ColumnMeta[]>([]);
    const [enumSuggestions, setEnumSuggestions] = useState<string[]>([]);
    const [suggestionType, setSuggestionType] = useState<"column" | "enum">(
      "column",
    );
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [cursorPosition, setCursorPosition] = useState(0);

    // Expose focus method to parent
    useImperativeHandle(ref, () => ({
      focus: () => {
        inputRef.current?.focus();
        inputRef.current?.select();
      },
    }));

    const config = modeConfig[mode];
    const ModeIcon = config.icon;

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

        // Focus back to input
        setTimeout(() => {
          inputRef.current?.focus();
          const newPos = wordStart + insertText.length;
          inputRef.current?.setSelectionRange(newPos, newPos);
        }, 0);
      },
      [value, cursorPosition, onValueChange],
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle suggestions navigation
      const currentSuggestions =
        suggestionType === "enum" ? enumSuggestions : suggestions;
      if (showSuggestions && currentSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) =>
            Math.min(i + 1, currentSuggestions.length - 1),
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          if (suggestionType === "enum") {
            const enumValue = enumSuggestions[selectedIndex];
            if (enumValue) {
              insertSuggestion(enumValue, true);
            }
          } else {
            const suggestion = suggestions[selectedIndex];
            if (suggestion) {
              insertSuggestion(suggestion.name, false);
            }
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowSuggestions(false);
          return;
        }
      }

      // Submit on Enter (when no suggestions), Shift+Enter for newline
      if (e.key === "Enter" && !showSuggestions) {
        if (e.shiftKey) {
          // Allow newline with Shift+Enter
          return;
        }
        e.preventDefault();
        onSubmit();
        return;
      }

      // Show all columns on Cmd+.
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setSuggestions(columns);
        setShowSuggestions(columns.length > 0);
        setSelectedIndex(0);
        return;
      }

      // Clear on Escape
      if (e.key === "Escape" && value) {
        e.preventDefault();
        onValueChange("");
        return;
      }
    };

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
                          "absolute left-1 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center",
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
                  <Textarea
                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={
                      // Hide prefix when badge is shown
                      (value.startsWith("?") && mode === "where") ||
                      (value.startsWith("#") && mode === "ai") ||
                      (value.startsWith("!") && mode === "search")
                        ? value.slice(1)
                        : value
                    }
                    onChange={(e) => {
                      // Restore prefix when editing
                      const newValue = e.target.value;
                      const prefix =
                        mode === "where" && value.startsWith("?")
                          ? "?"
                          : mode === "ai" && value.startsWith("#")
                          ? "#"
                          : mode === "search" && value.startsWith("!")
                          ? "!"
                          : "";
                      onValueChange(prefix + newValue);
                      setCursorPosition(
                        (e.target.selectionStart || 0) + prefix.length,
                      );
                    }}
                    onKeyDown={(e) => {
                      // Handle backspace on empty content to remove mode prefix
                      const displayValue =
                        (value.startsWith("?") && mode === "where") ||
                        (value.startsWith("#") && mode === "ai") ||
                        (value.startsWith("!") && mode === "search")
                          ? value.slice(1)
                          : value;

                      if (e.key === "Backspace" && displayValue === "") {
                        // Remove prefix and go back to search mode
                        if (
                          value.startsWith("?") ||
                          value.startsWith("#") ||
                          value.startsWith("!")
                        ) {
                          e.preventDefault();
                          onValueChange("");
                          onModeChange("search");
                          return;
                        }
                      }

                      handleKeyDown(e);
                    }}
                    onSelect={() => {
                      const prefix =
                        mode === "where" && value.startsWith("?")
                          ? 1
                          : mode === "ai" && value.startsWith("#")
                          ? 1
                          : mode === "search" && value.startsWith("!")
                          ? 1
                          : 0;
                      setCursorPosition(
                        (inputRef.current?.selectionStart || 0) + prefix,
                      );
                    }}
                    placeholder={config.placeholder}
                    disabled={isLoading}
                    rows={1}
                    className={cn(
                      "min-h-7 h-7 max-h-20 !text-xs !py-1.5 !pl-8 !pr-7 resize-none overflow-y-auto",
                      "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                      error &&
                        "border-destructive focus-visible:ring-destructive/50",
                      value && !error && "border-primary/50",
                    )}
                    onInput={(e) => {
                      // Auto-resize textarea only when content exceeds single line
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = "28px"; // min-h-7 = 28px
                      if (target.scrollHeight > 28) {
                        target.style.height = `${Math.min(
                          target.scrollHeight,
                          80,
                        )}px`;
                      }
                    }}
                  />
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
          <p
            className="text-xs text-muted-foreground px-1 truncate"
            title={explanation}
          >
            {explanation}
          </p>
        )}
      </div>
    );
  },
);
