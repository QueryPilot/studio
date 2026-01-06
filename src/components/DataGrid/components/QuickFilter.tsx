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
import {
  IconSearch,
  IconCode,
  IconSparkles,
  IconX,
  IconLoader2,
  IconCopy,
} from "@tabler/icons-react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { history, historyKeymap } from "@codemirror/commands";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { useTheme } from "@/components/theme-provider";
import { linter, type Diagnostic } from "@codemirror/lint";
import {
  parseWithWorker,
  acquirePgParserWorker,
  releasePgParserWorker,
} from "@/components/CodeEditor/languages/sql/pg-parser-worker-manager";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
// Note: Removed Popover - using lightweight positioned div for autocomplete performance
import { cn } from "@/lib/utils";
import type { FilterMode, FilterColumnInfo } from "@/utils/filterParser";
import { useAIChatStore } from "@/stores/aiChatStore";

interface QuickFilterProps {
  columns: FilterColumnInfo[];
  value: string;
  mode: FilterMode;
  onValueChange: (value: string) => void;
  onModeChange: (mode: FilterMode) => void;
  onSubmit: () => void;
  isLoading?: boolean;
  error?: string | null;
  explanation?: string | null;
  /** Hide mode switcher (AI/SQL) - useful for query result filtering where only search mode applies */
  searchModeOnly?: boolean;
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
    label: "Pattern Search",
    description: "Wildcards, regex, boolean",
    placeholder: "john | jane, col:val1|val2, ^starts, /regex/i",
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
// Column extraction - matches column name before operator (works in subqueries too)
// Looks backwards from cursor position to find nearest column = pattern
const COLUMN_EXTRACTION_REGEX =
  /([a-zA-Z_][a-zA-Z0-9_]*)\s*[=<>!]+\s*['"]?$|([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:LIKE|ILIKE|IN|IS|BETWEEN)\s*['"]?$/i;

/**
 * Extract column name from text before cursor, handling subqueries and nested contexts.
 * Finds the most recent column reference before an operator.
 */
function extractColumnBeforeCursor(text: string): string | null {
  // First try the simple regex for direct matches at end
  const directMatch = text.match(COLUMN_EXTRACTION_REGEX);
  if (directMatch) {
    return directMatch[1] || directMatch[2] || null;
  }

  // For subqueries: scan backwards to find the nearest "column operator" pattern
  // This handles cases like: (SELECT * FROM t WHERE col = 'val' AND other_col =
  const patterns = [
    // column = 'value pattern (possibly in subquery)
    /([a-zA-Z_][a-zA-Z0-9_]*)\s*[=<>!]+\s*['"]?$/,
    // column LIKE/IN/etc pattern
    /([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:LIKE|ILIKE|IN|IS|BETWEEN)\s*['"]?$/i,
  ];

  // Work with the tail of the string (last clause after any logical operator or paren)
  // Split on AND, OR, (, to isolate current expression context
  const clauseSplit = text.split(/(?:AND|OR|\()\s*/i);
  const currentClause = clauseSplit[clauseSplit.length - 1] || "";

  for (const pattern of patterns) {
    const match = currentClause.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

// Memoized suggestion item components (Phase 2.3)
interface EnumSuggestionItemProps {
  value: string;
  isSelected: boolean;
  onSelect: (value: string) => void;
}

const EnumSuggestionItem = memo<EnumSuggestionItemProps>(
  ({ value, isSelected, onSelect }) => {
    return (
      <button
        type="button"
        onClick={() => {
          onSelect(value);
        }}
        className={cn(
          "w-full text-left px-2 py-1 text-xs rounded",
          "hover:bg-accent",
          isSelected && "bg-accent",
        )}
      >
        <span className="font-mono">'{value}'</span>
      </button>
    );
  },
);
EnumSuggestionItem.displayName = "EnumSuggestionItem";

interface ColumnSuggestionItemProps {
  column: FilterColumnInfo;
  isSelected: boolean;
  onSelect: (name: string) => void;
}

const ColumnSuggestionItem = memo<ColumnSuggestionItemProps>(
  ({ column, isSelected, onSelect }) => {
    return (
      <button
        type="button"
        onClick={() => {
          onSelect(column.name);
        }}
        className={cn(
          "w-full text-left px-2 py-1 text-xs rounded",
          "hover:bg-accent",
          isSelected && "bg-accent",
        )}
      >
        <span className="font-mono">{column.name}</span>
        <span className="ml-2 text-muted-foreground">({column.dataType})</span>
      </button>
    );
  },
);
ColumnSuggestionItem.displayName = "ColumnSuggestionItem";

export const QuickFilter = memo(
  forwardRef<QuickFilterRef, QuickFilterProps>(function QuickFilter(
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
      searchModeOnly = false,
    },
    ref,
  ) {
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [suggestions, setSuggestions] = useState<FilterColumnInfo[]>([]);
    const [enumSuggestions, setEnumSuggestions] = useState<string[]>([]);
    const [suggestionType, setSuggestionType] = useState<"column" | "enum">(
      "column",
    );
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [hasLintError, setHasLintError] = useState(false);
    const justAcceptedSuggestion = useRef(false);
    const justSwitchedMode = useRef(false);
    const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSubmittedValue = useRef<string>("");
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Refs for stable keymap access (avoid keymap recreation on every render)
    const stateRefs = useRef({
      showSuggestions: false,
      suggestionType: "column" as "column" | "enum",
      suggestions: [] as FilterColumnInfo[],
      enumSuggestions: [] as string[],
      selectedIndex: 0,
      mode: "search" as FilterMode,
      hasLintError: false,
      value: "",
      cursorPosition: 0,
      columns: [] as FilterColumnInfo[],
    });
    // Keep refs in sync (critical for stable keymap callbacks)
    stateRefs.current.showSuggestions = showSuggestions;
    stateRefs.current.suggestionType = suggestionType;
    stateRefs.current.suggestions = suggestions;
    stateRefs.current.enumSuggestions = enumSuggestions;
    stateRefs.current.selectedIndex = selectedIndex;
    stateRefs.current.mode = mode;
    stateRefs.current.hasLintError = hasLintError;
    stateRefs.current.value = value;
    stateRefs.current.cursorPosition = cursorPosition;
    stateRefs.current.columns = columns;

    // Theme for CodeMirror
    const { resolvedTheme } = useTheme();
    const editorViewRef = useRef<EditorView | null>(null);

    // Acquire/release pg-parser worker for WHERE clause linting
    useEffect(() => {
      acquirePgParserWorker();
      return () => {
        releasePgParserWorker();
      };
    }, []);

    // Click-outside handler for suggestions dropdown (replaces Popover behavior)
    useEffect(() => {
      if (!showSuggestions) return;

      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node;
        if (
          containerRef.current &&
          !containerRef.current.contains(target) &&
          suggestionsRef.current &&
          !suggestionsRef.current.contains(target)
        ) {
          setShowSuggestions(false);
        }
      };

      // Use capture to handle click before other handlers
      document.addEventListener("mousedown", handleClickOutside, true);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside, true);
      };
    }, [showSuggestions]);

    // Expose focus method to parent
    useImperativeHandle(ref, () => ({
      focus: () => {
        editorViewRef.current?.focus();
      },
    }));

    const config = modeConfig[mode];

    // CodeMirror extensions for SQL highlighting
    const sqlExtensions = useMemo(() => {
      const actualTheme = resolvedTheme === "dark" ? "dark" : "light";

      // Get syntax highlighting styles only (we'll override backgrounds)
      const themeExts = getThemeExtensions(actualTheme);

      return [
        sql({ dialect: PostgreSQL }),
        history(),
        keymap.of(historyKeymap),
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
              caretColor: actualTheme === "dark" ? "#D4A52B" : "#B8911F",
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
        // SQL linter for WHERE clause validation (runs in Web Worker)
        linter(
          async (view: EditorView): Promise<Diagnostic[]> => {
            const content = view.state.doc.toString().trim();
            if (!content || content.length < 3) {
              setHasLintError(false);
              return [];
            }

            try {
              // Wrap WHERE clause in SELECT to make it valid SQL
              const testSql = `SELECT * FROM t WHERE ${content}`;
              const diagnostics = await parseWithWorker(testSql);

              if (diagnostics.length > 0) {
                setHasLintError(true);
                // Adjust positions to account for "SELECT * FROM t WHERE " prefix (23 chars)
                const prefixLen = 23;
                return diagnostics
                  .map((d) => ({
                    from: Math.max(0, d.from - prefixLen),
                    to: Math.min(Math.max(0, d.to - prefixLen), content.length),
                    severity: d.severity,
                    message: d.message,
                  }))
                  .filter((d) => d.from >= 0 && d.to > d.from);
              }

              setHasLintError(false);
              return [];
            } catch {
              setHasLintError(false);
              return [];
            }
          },
          { delay: 300 }, // Shorter delay since parsing is off-thread
        ),
      ];
    }, [resolvedTheme]);

    // Memoized non-SQL extensions for search/AI modes (avoids recreation on every render)
    const basicExtensions = useMemo(() => {
      const actualTheme = resolvedTheme === "dark" ? "dark" : "light";
      return [
        history(),
        keymap.of(historyKeymap),
        ...getThemeExtensions(actualTheme),
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
          { dark: actualTheme === "dark" },
        ),
        EditorView.lineWrapping,
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

    // Debounce value and cursor position TOGETHER to avoid double effect runs
    // When both change, we only want one effect execution, not two
    // Use stable reference via useMemo to prevent debounce reset on every render
    const inputState = useMemo(
      () => ({ value, cursor: cursorPosition }),
      [value, cursorPosition]
    );
    const debouncedState = useDebounce(inputState, 250);
    const debouncedValue = debouncedState.value;
    const debouncedCursor = debouncedState.cursor;

    // Memoize column map for O(1) lookups (Phase 1.3)
    const columnMap = useMemo(() => {
      const map = new Map<string, FilterColumnInfo>();
      columns.forEach((col) => map.set(col.name.toLowerCase(), col));
      return map;
    }, [columns]);

    // Memoize filtered columns helper (Phase 1.3)
    const getFilteredColumns = useCallback(
      (searchTerm: string) => {
        const lowerSearch = searchTerm.toLowerCase();
        return columns.filter((c) =>
          c.name.toLowerCase().includes(lowerSearch),
        );
      },
      [columns],
    );

    // Update suggestions based on input
    useEffect(() => {
      // Skip suggestion updates in AI mode (natural language, not SQL)
      if (mode === "ai") {
        setShowSuggestions(false);
        return;
      }

      // Get word at cursor
      const beforeCursor = debouncedValue.slice(0, debouncedCursor);
      const match = beforeCursor.match(WORD_AT_CURSOR_REGEX);

      if (match) {
        // Check if we're in a value context (after an operator)
        const textBeforeWord = beforeCursor
          .slice(0, beforeCursor.length - match[0].length)
          .trim();
        const isAfterOperator = OPERATOR_REGEX.test(textBeforeWord);
        const isAfterQuote = QUOTE_REGEX.test(textBeforeWord);

        if (isAfterOperator || isAfterQuote) {
          // We're typing a value - check if the column has enum values
          // Use improved extraction that handles subqueries
          const columnName = extractColumnBeforeCursor(textBeforeWord);

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

        // Don't show suggestion if user already typed exact column name
        const isExactMatch = filtered.length === 1 &&
          filtered[0]?.name.toLowerCase() === searchTerm.toLowerCase();

        if (filtered.length > 0 && !justAcceptedSuggestion.current && !isExactMatch) {
          setShowSuggestions(true);
        } else {
          setShowSuggestions(false);
        }
        setSelectedIndex(0);
      } else {
        // Check if cursor is right after operator with no text yet
        const trimmedBefore = beforeCursor.trim();
        // Use improved extraction that handles subqueries
        const columnName = extractColumnBeforeCursor(trimmedBefore);

        if (columnName) {
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
    }, [debouncedValue, debouncedCursor, columnMap, getFilteredColumns, mode]);

    // Auto-submit after 3s of inactivity (no lint errors, value changed, not loading)
    useEffect(() => {
      // Clear any existing timer
      if (autoSubmitTimer.current) {
        clearTimeout(autoSubmitTimer.current);
        autoSubmitTimer.current = null;
      }

      // Skip if: loading, empty value, suggestions open, same as last submitted, or lint error in WHERE mode
      const trimmedValue = value.replace(/^[?#]/, "").trim();
      if (
        isLoading ||
        !trimmedValue ||
        showSuggestions ||
        value === lastSubmittedValue.current ||
        (mode === "where" && hasLintError)
      ) {
        return;
      }

      // Start 3s timer for auto-submit
      autoSubmitTimer.current = setTimeout(() => {
        lastSubmittedValue.current = value;
        onSubmit();
      }, 3000);

      return () => {
        if (autoSubmitTimer.current) {
          clearTimeout(autoSubmitTimer.current);
          autoSubmitTimer.current = null;
        }
      };
    }, [value, isLoading, showSuggestions, mode, hasLintError, onSubmit]);

    // Reset lastSubmittedValue when value is cleared
    useEffect(() => {
      if (!value || value === "?" || value === "#") {
        lastSubmittedValue.current = "";
      }
    }, [value]);

    const insertSuggestion = useCallback(
      (text: string, isEnum: boolean) => {
        // Read from refs for stable callback (prevents keymap recreation on every keystroke)
        const s = stateRefs.current;
        const currentValue = s.value;
        const currentCursor = s.cursorPosition;
        const currentMode = s.mode;

        const beforeCursor = currentValue.slice(0, currentCursor);
        const afterCursor = currentValue.slice(currentCursor);

        // Find start of current word
        const match = beforeCursor.match(WORD_AT_CURSOR_REGEX);
        const wordStart = match
          ? currentCursor - match[0].length
          : currentCursor;

        // For enum values, wrap in quotes
        const insertText = isEnum ? `'${text}'` : text;
        const newValue =
          currentValue.slice(0, wordStart) + insertText + afterCursor;

        // Set flag to prevent suggestions from re-appearing
        justAcceptedSuggestion.current = true;

        // Hide suggestions immediately
        setShowSuggestions(false);

        // Calculate cursor position in editor coordinates (without prefix)
        const prefixLen =
          (newValue.startsWith("?") && currentMode === "where") ||
          (newValue.startsWith("#") && currentMode === "ai") ||
          (newValue.startsWith("!") && currentMode === "search")
            ? 1
            : 0;
        const editorPos = wordStart + insertText.length - prefixLen;

        // Update value and cursor position synchronously via editor
        const view = editorViewRef.current;
        if (view) {
          const changes = {
            from: 0,
            to: view.state.doc.length,
            insert:
              newValue.startsWith("?") ||
              newValue.startsWith("#") ||
              newValue.startsWith("!")
                ? newValue.slice(1)
                : newValue,
          };

          const validPos = Math.max(
            0,
            Math.min(editorPos, changes.insert.length),
          );

          view.dispatch({
            changes,
            selection: { anchor: validPos, head: validPos },
          });
          view.focus();
        }

        // Update parent value
        onValueChange(newValue);

        // Reset flag after debounce delay (250ms) + buffer to ensure effect has run
        setTimeout(() => {
          justAcceptedSuggestion.current = false;
        });
      },
      [onValueChange], // Stable deps only - value/cursor read from refs
    );

    // Memoized keymap extension using refs for stable access
    const keymapExtension = useMemo(() => {
      return Prec.highest(
        keymap.of([
          {
            key: "Enter",
            run: () => {
              const s = stateRefs.current;
              if (s.showSuggestions) {
                const currentSuggestions =
                  s.suggestionType === "enum"
                    ? s.enumSuggestions
                    : s.suggestions;
                if (currentSuggestions.length > 0) {
                  if (s.suggestionType === "enum") {
                    const enumValue = s.enumSuggestions[s.selectedIndex];
                    if (enumValue) insertSuggestion(enumValue, true);
                  } else {
                    const suggestion = s.suggestions[s.selectedIndex];
                    if (suggestion) insertSuggestion(suggestion.name, false);
                  }
                  return true;
                }
              }
              if (s.mode === "where" && s.hasLintError) return true;
              onSubmit();
              return true;
            },
          },
          {
            // Block Shift+Enter from inserting newlines (this is a single-line filter)
            key: "Shift-Enter",
            run: () => {
              onSubmit();
              return true;
            },
          },
          {
            // Cmd/Ctrl+Enter also submits
            key: "Mod-Enter",
            run: () => {
              onSubmit();
              return true;
            },
          },
          {
            key: "Escape",
            run: () => {
              const s = stateRefs.current;
              if (s.showSuggestions) {
                setShowSuggestions(false);
                return true;
              }
              if (s.value) {
                onValueChange("");
                return true;
              }
              return false;
            },
          },
          {
            key: "ArrowDown",
            run: () => {
              const s = stateRefs.current;
              if (s.showSuggestions) {
                const currentSuggestions =
                  s.suggestionType === "enum"
                    ? s.enumSuggestions
                    : s.suggestions;
                setSelectedIndex((i) =>
                  Math.min(i + 1, currentSuggestions.length - 1),
                );
                return true;
              }
              return false;
            },
          },
          {
            key: "ArrowUp",
            run: () => {
              if (stateRefs.current.showSuggestions) {
                setSelectedIndex((i) => Math.max(i - 1, 0));
                return true;
              }
              return false;
            },
          },
          {
            key: "Tab",
            run: () => {
              const s = stateRefs.current;
              if (s.showSuggestions) {
                const currentSuggestions =
                  s.suggestionType === "enum"
                    ? s.enumSuggestions
                    : s.suggestions;
                if (currentSuggestions.length > 0) {
                  if (s.suggestionType === "enum") {
                    const enumValue = s.enumSuggestions[s.selectedIndex];
                    if (enumValue) insertSuggestion(enumValue, true);
                  } else {
                    const suggestion = s.suggestions[s.selectedIndex];
                    if (suggestion) insertSuggestion(suggestion.name, false);
                  }
                  return true;
                }
              }
              return false;
            },
          },
          {
            key: "Backspace",
            run: (view) => {
              const editorContent = view.state.doc.toString();
              if (editorContent === "" && stateRefs.current.mode !== "search") {
                onValueChange("");
                onModeChange("search");
                return true;
              }
              return false;
            },
          },
          {
            key: "Mod-Backspace",
            run: (view) => {
              const editorContent = view.state.doc.toString();
              if (editorContent === "" && stateRefs.current.mode !== "search") {
                onValueChange("");
                onModeChange("search");
                return true;
              }
              if (editorContent !== "") {
                justSwitchedMode.current = true;
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: "" },
                });
                onValueChange("");
                if (stateRefs.current.mode !== "search") {
                  onModeChange("search");
                }
                requestAnimationFrame(() => {
                  justSwitchedMode.current = false;
                });
                return true;
              }
              return false;
            },
          },
          {
            key: "Mod-.",
            run: () => {
              justAcceptedSuggestion.current = false;
              setSuggestions(stateRefs.current.columns);
              setSuggestionType("column");
              setShowSuggestions(stateRefs.current.columns.length > 0);
              setSelectedIndex(0);
              return true;
            },
          },
        ]),
      );
    }, [insertSuggestion, onSubmit, onValueChange, onModeChange]);

    // Stable combined extensions array - prevents CodeMirror re-initialization
    const combinedExtensions = useMemo(() => {
      if (mode === "where") {
        return [...sqlExtensions, keymapExtension];
      }
      return [...basicExtensions, keymapExtension];
    }, [mode, sqlExtensions, basicExtensions, keymapExtension]);

    // Clear button handler (Phase 1.4)
    const handleClearClick = useCallback(() => {
      justSwitchedMode.current = true;
      onValueChange("");
      // Reset to search mode when clearing
      if (mode !== "search") {
        onModeChange("search");
      }
      // Clear the editor content
      const view = editorViewRef.current;
      if (view && view.state.doc.length > 0) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: "" },
        });
      }
      requestAnimationFrame(() => {
        justSwitchedMode.current = false;
      });
    }, [onValueChange, onModeChange, mode]);

    // CodeMirror change handler (Phase 1.4) - Optimized to reduce unnecessary state updates
    const handleEditorChange = useCallback(
      (newValue: string) => {
        // Skip if we just switched modes (prevents loop from editor dispatch)
        if (justSwitchedMode.current) {
          return;
        }

        // Fast path: check for mode-switching prefixes first
        const firstChar = newValue[0];

        // Detect mode shortcuts and switch mode
        if (firstChar === "?" && mode !== "where") {
          const contentWithoutPrefix = newValue.slice(1);
          justSwitchedMode.current = true;
          onModeChange("where");
          onValueChange("?" + contentWithoutPrefix);
          // Update editor to remove prefix from display
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
          requestAnimationFrame(() => {
            justSwitchedMode.current = false;
          });
          return;
        }
        if (firstChar === "#" && mode !== "ai") {
          const contentWithoutPrefix = newValue.slice(1);
          justSwitchedMode.current = true;
          onModeChange("ai");
          onValueChange("#" + contentWithoutPrefix);
          // Update editor to remove prefix from display
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
          requestAnimationFrame(() => {
            justSwitchedMode.current = false;
          });
          return;
        }
        if (firstChar === "!" && mode !== "search") {
          const contentWithoutPrefix = newValue.slice(1);
          justSwitchedMode.current = true;
          onModeChange("search");
          onValueChange(contentWithoutPrefix); // Search mode has no prefix
          // Update editor to remove prefix from display
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
          requestAnimationFrame(() => {
            justSwitchedMode.current = false;
          });
          return;
        }

        // Handle empty value - preserve mode prefix to prevent unwanted mode switch
        // User must press Backspace on already empty editor to reset to search mode
        if (newValue === "") {
          if (mode === "where") {
            onValueChange("?");
          } else if (mode === "ai") {
            onValueChange("#");
          } else {
            onValueChange("");
          }
          return;
        }

        // Compute the expected prefixed value
        let expectedValue: string;
        if (mode === "ai") {
          expectedValue = "#" + newValue;
        } else if (mode === "where") {
          expectedValue = "?" + newValue;
        } else {
          expectedValue = newValue;
        }

        // Only call onValueChange if value actually changed (avoid unnecessary parent re-renders)
        if (expectedValue !== value) {
          onValueChange(expectedValue);
        }
      },
      [mode, onModeChange, onValueChange, value],
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
    const handleEnumSelect = useCallback(
      (enumValue: string) => {
        insertSuggestion(enumValue, true);
      },
      [insertSuggestion],
    );

    const handleColumnSelect = useCallback(
      (columnName: string) => {
        insertSuggestion(columnName, false);
      },
      [insertSuggestion],
    );

    // Memoized onUpdate handler - uses refs to avoid stale closure issues
    const handleEditorUpdate = useCallback(
      (update: {
        selectionSet: boolean;
        state: { selection: { main: { head: number } } };
      }) => {
        if (update.selectionSet) {
          const pos = update.state.selection.main.head;
          const s = stateRefs.current;
          const prefixLen =
            (s.value.startsWith("?") && s.mode === "where") ||
            (s.value.startsWith("#") && s.mode === "ai")
              ? 1
              : 0;
          setCursorPosition(pos + prefixLen);
        }
      },
      [], // No deps - reads from stateRefs
    );

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center">
          {/* Input with mode selector inside */}
          <div className="flex-1 relative">
            <DropdownMenu>
              <div
                ref={containerRef}
                className={cn(
                  "relative w-full rounded-md border border-input bg-input/20 dark:bg-input/30 pl-8 pr-7 text-xs",
                  "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
                  error &&
                    "border-destructive focus-within:ring-destructive/50",
                  value && !error && "border-primary/50",
                )}
              >
                {/* Mode selector - inside input at left */}
                {searchModeOnly ? (
                  <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center rounded-sm size-5 text-muted-foreground">
                    <IconSearch className="size-3.5" />
                  </div>
                ) : (
                  <DropdownMenuTrigger
                    className={cn(
                      "absolute left-1 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center rounded-sm size-5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
                      isLoading && "pointer-events-none opacity-50",
                    )}
                    disabled={isLoading}
                  >
                    {mode === "ai" && <IconSparkles className="size-3.5" />}
                    {mode === "where" && <IconCode className="size-3.5" />}
                    {mode === "search" && <IconSearch className="size-3.5" />}
                  </DropdownMenuTrigger>
                )}
                <CodeMirror
                  value={
                    value.startsWith("?") ||
                    value.startsWith("#") ||
                    value.startsWith("!")
                      ? value.slice(1)
                      : value
                  }
                  onChange={handleEditorChange}
                  extensions={combinedExtensions}
                  placeholder={config.placeholder}
                  editable={!isLoading}
                  basicSetup={false}
                  height="auto"
                  minHeight="28px"
                  maxHeight="80px"
                  onCreateEditor={(view) => {
                    editorViewRef.current = view;
                  }}
                  onUpdate={handleEditorUpdate}
                />
                {/* Clear/Loading indicator */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  {isLoading ? (
                    <IconLoader2 className="size-3.5 animate-spin text-muted-foreground" />
                  ) : value ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleClearClick}
                    >
                      <IconX />
                    </Button>
                  ) : null}
                </div>
              </div>
              {!searchModeOnly && (
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
                          // Focus editor after mode change (not for AI mode - user selects model first)
                          if (m !== "ai") {
                            setTimeout(() => editorViewRef.current?.focus(), 0);
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
                      <DropdownMenuGroup>
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
                            const configured = availableProviders.filter((p) =>
                              configuredProviders.includes(p.name),
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
                              const enabledModels = getProviderEnabledModels(
                                provider.name,
                              );
                              const filteredModels = provider.models.filter(
                                (m) => enabledModels.includes(m.id),
                              );

                              // Skip provider if no enabled models
                              if (filteredModels.length === 0) return null;

                              return (
                                <DropdownMenuGroup key={provider.name}>
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
                                </DropdownMenuGroup>
                              );
                            });
                          })()
                        )}
                      </DropdownMenuGroup>
                    </>
                  )}
                </DropdownMenuContent>
              )}
            </DropdownMenu>
            {/* Suggestions dropdown - lightweight positioned div (no Portal/Popover overhead) */}
            {showSuggestions && (
              <div
                ref={suggestionsRef}
                className="absolute left-0 top-full mt-1 z-50 w-64 rounded-md border border-border bg-popover p-1 shadow-md"
                style={{ contain: "layout style" }}
                onMouseDown={(e) => {
                  // Prevent blur on input when clicking suggestions
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
              </div>
            )}
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
  }),
);

QuickFilter.displayName = "QuickFilter";
