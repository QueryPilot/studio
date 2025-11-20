import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Search, Code, Sparkles, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
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

interface QuickFilterProps {
  columns: ColumnMeta[];
  value: string;
  mode: FilterMode;
  onValueChange: (value: string) => void;
  onModeChange: (mode: FilterMode) => void;
  onSubmit: () => void;
  isLoading?: boolean;
  error?: string | null;
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
    placeholder: "Search anything... (? for SQL, # to ask AI)",
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
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [suggestions, setSuggestions] = useState<ColumnMeta[]>([]);
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
      const searchTerm = match[0].toLowerCase();
      const filtered = columns.filter((c) =>
        c.name.toLowerCase().includes(searchTerm),
      );
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setSelectedIndex(0);
    } else {
      setShowSuggestions(false);
    }
  }, [value, cursorPosition, columns, mode]);

  const insertSuggestion = useCallback(
    (columnName: string) => {
      const beforeCursor = value.slice(0, cursorPosition);
      const afterCursor = value.slice(cursorPosition);

      // Find start of current word
      const match = beforeCursor.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
      const wordStart = match
        ? cursorPosition - match[0].length
        : cursorPosition;

      const newValue = value.slice(0, wordStart) + columnName + afterCursor;
      onValueChange(newValue);
      setShowSuggestions(false);

      // Focus back to input
      setTimeout(() => {
        inputRef.current?.focus();
        const newPos = wordStart + columnName.length;
        inputRef.current?.setSelectionRange(newPos, newPos);
      }, 0);
    },
    [value, cursorPosition, onValueChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle suggestions navigation
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const suggestion = suggestions[selectedIndex];
        if (suggestion) {
          insertSuggestion(suggestion.name);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }

    // Submit on Enter (when no suggestions)
    if (e.key === "Enter" && !showSuggestions) {
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onValueChange(e.target.value);
    setCursorPosition(e.target.selectionStart || 0);
  };

  const handleSelect = () => {
    setCursorPosition(inputRef.current?.selectionStart || 0);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        {/* Mode selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 shrink-0"
              disabled={isLoading}
            >
              <ModeIcon className="h-3.5 w-3.5" />
            </Button>
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
                    const currentValue = value.replace(/^[?#]\s*/, "");
                    if (m === "where") {
                      onValueChange(currentValue ? `?${currentValue}` : "?");
                    } else if (m === "ai") {
                      onValueChange(currentValue ? `#${currentValue}` : "#");
                    } else {
                      onValueChange(currentValue);
                    }
                    // Focus input after mode change (not for AI mode - user selects model first)
                    if (m !== "ai") {
                      setTimeout(() => inputRef.current?.focus(), 0);
                    }
                  }}
                  className={cn(mode === m && "bg-accent")}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  <div className="flex flex-col">
                    <span className="text-sm">{cfg.label}</span>
                    <span className="text-xs text-muted-foreground">
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
                    const configured = availableProviders.filter((p) =>
                      configuredProviders.includes(p.name),
                    );
                    if (configured.length === 0) {
                      return (
                        <DropdownMenuItem disabled className="text-xs pl-4">
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

        {/* Input with autocomplete */}
        <div className="relative flex-1">
          <Popover open={showSuggestions} onOpenChange={setShowSuggestions}>
            <PopoverAnchor asChild>
              <Input
                ref={inputRef}
                value={value}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onSelect={handleSelect}
                placeholder={config.placeholder}
                disabled={isLoading}
                className={cn(
                  "!h-7 !text-xs !p-2 !pr-7",
                  error && "border-destructive",
                  value && !error && "border-primary/50",
                )}
              />
            </PopoverAnchor>
            <PopoverContent
              className="w-64 p-1"
              align="start"
              onOpenAutoFocus={(e) => {
                e.preventDefault();
              }}
            >
              <div className="max-h-48 overflow-y-auto">
                {suggestions.map((col, idx) => (
                  <button
                    key={col.name}
                    type="button"
                    onClick={() => {
                      insertSuggestion(col.name);
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

          {/* Clear/Loading indicator */}
          <div className="absolute right-1 top-1/2 -translate-y-1/2 mt-0.5">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : value ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                onClick={() => {
                  onValueChange("");
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-destructive px-1 truncate" title={error}>
          {error}
        </p>
      )}
    </div>
  );
  },
);
