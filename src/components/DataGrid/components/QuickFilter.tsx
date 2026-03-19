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
import { useContextKey, useScopedKeybindings } from "@/hooks/useContextKey";
import {
  IconSearch,
  IconCode,
  IconX,
  IconCopy,
  IconSparkles,
  IconCheck,
} from "@tabler/icons-react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { keymap, tooltips } from "@codemirror/view";
import { Prec, Compartment } from "@codemirror/state";
import { autocompletion, completionStatus, acceptCompletion, moveCompletionSelection, type CompletionContext, type Completion } from "@codemirror/autocomplete";
import { history, historyKeymap } from "@codemirror/commands";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { useTheme } from "@/components/theme-provider";
import { linter, type Diagnostic } from "@codemirror/lint";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useAcpStore } from "@/stores/acpStore";
// Note: Removed Popover - using lightweight positioned div for autocomplete performance
import { cn } from "@/lib/utils";
import type { FilterMode, FilterColumnInfo } from "@/utils/filterParser";

interface QuickFilterProps {
  columns: FilterColumnInfo[];
  value: string;
  mode: FilterMode;
  onValueChange: (value: string) => void;
  onModeChange: (mode: FilterMode) => void;
  onSubmit: () => void;
  /** Called when user clears the filter (X button, Escape, Cmd+Backspace). Persists the cleared state. */
  onClear?: () => void;
  isLoading?: boolean;
  error?: string | null;
  explanation?: string | null;
  /** Hide mode switcher (AI/SQL) - useful for query result filtering where only search mode applies */
  searchModeOnly?: boolean;
  /** Enable client-side filtering mode (AI generates search patterns instead of SQL, WHERE mode disabled) */
  clientSideFiltering?: boolean;
}

export interface QuickFilterRef {
  focus: () => void;
  isFocusWithin?: () => boolean;
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
    label: "AI Filter",
    description: "Natural language filter",
    placeholder: "/show orders over $100 from last week",
  },
};

// Pre-compiled regex patterns for performance (Phase 3.1)
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

// ============================================================================
// Mode Selection Menu with AI Model Submenu
// ============================================================================

interface QuickFilterModeMenuProps {
  mode: FilterMode;
  value: string;
  clientSideFiltering?: boolean;
  onModeChange: (mode: FilterMode) => void;
  onValueChange: (value: string) => void;
  onFocusEditor: () => void;
}

const QuickFilterModeMenu = memo(function QuickFilterModeMenu({
  mode,
  value,
  clientSideFiltering,
  onModeChange,
  onValueChange,
  onFocusEditor,
}: QuickFilterModeMenuProps) {
  // Get all agents and their models from ACP store
  const availableAgents = useAcpStore((s) => s.availableAgents);
  const selectedModel = useAcpStore((s) => s.selectedModel);
  const selectedAgentId = useAcpStore((s) => s.selectedAgentId);
  const selectAgent = useAcpStore((s) => s.selectAgent);
  const selectModel = useAcpStore((s) => s.selectModel);
  const dynamicModels = useAcpStore((s) => s.dynamicModels);

  // Get installed agents with their models
  const installedAgents = useMemo(() => {
    return availableAgents
      .filter((agent) => agent.installed)
      .map((agent) => ({
        ...agent,
        // Use dynamic models if available, otherwise static
        models: dynamicModels[agent.id]?.length
          ? dynamicModels[agent.id]
          : agent.models,
      }));
  }, [availableAgents, dynamicModels]);

  // Handle mode selection for non-AI modes
  const handleModeSelect = useCallback(
    (m: FilterMode) => {
      onModeChange(m);
      const currentValue = value.replace(/^[?/]\s*/, "");
      if (m === "where") {
        onValueChange(currentValue ? `?${currentValue}` : "?");
      } else {
        onValueChange(currentValue);
      }
      onFocusEditor();
    },
    [value, onModeChange, onValueChange, onFocusEditor],
  );

  // Handle AI mode with agent and model selection
  const handleAiModeWithModel = useCallback(
    (agentId: string, modelId: string) => {
      // Switch agent if different (this also updates model preferences)
      if (agentId !== selectedAgentId) {
        selectAgent(agentId);
      }
      // Select the model (this syncs with the AI sidebar)
      void selectModel(modelId);
      // Switch to AI mode
      onModeChange("ai");
      const currentValue = value.replace(/^[?/]\s*/, "");
      onValueChange(currentValue);
      onFocusEditor();
    },
    [
      value,
      onModeChange,
      onValueChange,
      onFocusEditor,
      selectAgent,
      selectModel,
      selectedAgentId,
    ],
  );

  // Non-AI modes (search, where)
  const nonAiModes: FilterMode[] = clientSideFiltering
    ? ["search"]
    : ["search", "where"];

  return (
    <DropdownMenuContent align="start" className="w-52">
      {/* Pattern Search and WHERE modes */}
      {nonAiModes.map((m) => {
        const cfg = modeConfig[m];
        const Icon = cfg.icon;
        return (
          <DropdownMenuItem
            key={m}
            onClick={() => {
              handleModeSelect(m);
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

      {/* AI Filter with model submenu grouped by agent */}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          className={cn("text-xs", mode === "ai" && "bg-accent")}
        >
          <IconSparkles className="h-3.5 w-3.5 mr-2" />
          <div className="flex flex-col flex-1">
            <span className="text-xs">
              {clientSideFiltering ? "AI Filter" : modeConfig.ai.label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {clientSideFiltering
                ? "Generate search patterns"
                : modeConfig.ai.description}
            </span>
          </div>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56 max-h-80 overflow-y-auto">
          {installedAgents.length === 0 ? (
            <DropdownMenuItem
              disabled
              className="text-xs text-muted-foreground"
            >
              No AI agents installed
            </DropdownMenuItem>
          ) : (
            installedAgents.map((agent) => (
              <div key={agent.id}>
                {/* Agent name as group header */}
                <div className="text-[10px] text-muted-foreground font-medium px-2 py-1.5 border-b border-border/50">
                  {agent.name}
                </div>
                {/* Models for this agent */}
                {agent.models?.map((model) => {
                  const isSelected =
                    selectedAgentId === agent.id && selectedModel === model.id;
                  return (
                    <DropdownMenuItem
                      key={`${agent.id}:${model.id}`}
                      onClick={() => {
                        handleAiModeWithModel(agent.id, model.id);
                      }}
                      className="text-xs"
                    >
                      <div className="flex items-center gap-2 w-full">
                        {isSelected ? (
                          <IconCheck className="h-3 w-3 text-primary shrink-0" />
                        ) : (
                          <div className="w-3 shrink-0" />
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{model.name}</span>
                          <span className="text-[10px] text-muted-foreground truncate">
                            {model.description}
                          </span>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  );
});

export const QuickFilter = memo(
  forwardRef<QuickFilterRef, QuickFilterProps>(function QuickFilter(
    {
      columns,
      value,
      mode,
      onValueChange,
      onModeChange,
      onSubmit,
      onClear,
      isLoading = false,
      error = null,
      explanation = null,
      searchModeOnly = false,
      clientSideFiltering = false,
    },
    ref,
  ) {
    const [hasLintError, setHasLintError] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const focusCleanupRef = useRef<(() => void) | null>(null);
    const justSwitchedMode = useRef(false);
    const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSubmittedValue = useRef<string>("");
    const containerRef = useRef<HTMLDivElement>(null);
    const parentSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const internalValueRef = useRef(value);

    // Refs for stable keymap access (avoid keymap recreation on every render)
    const stateRefs = useRef({
      mode: "search" as FilterMode,
      hasLintError: false,
      value: "",
      onClear: undefined as (() => void) | undefined,
    });
    stateRefs.current.mode = mode;
    stateRefs.current.hasLintError = hasLintError;
    stateRefs.current.value = value;
    stateRefs.current.onClear = onClear;

    // Theme for CodeMirror
    const { resolvedTheme } = useTheme();
    const editorViewRef = useRef<EditorView | null>(null);

    // Scoped keybinding context so multiple QuickFilters / editors don't clobber each other
    const scopeId = useScopedKeybindings();

    // Set editorTextFocus context when QuickFilter is focused
    // This prevents global keybindings (like workspace.undo) from capturing Cmd+Z
    useContextKey("editorTextFocus", isFocused, {
      scopeId,
      resetOnUnmount: true,
    });

    // Cleanup focus listeners on unmount
    useEffect(() => {
      return () => {
        focusCleanupRef.current?.();
        focusCleanupRef.current = null;
        setIsFocused(false);
      };
    }, []);

    // Keep internal ref in sync when parent value changes externally
    useEffect(() => {
      internalValueRef.current = value;
    }, [value]);

    // Note: SQL validation now uses Rust backend (no worker setup needed)

    // Expose focus method to parent
    useImperativeHandle(ref, () => ({
      focus: () => {
        editorViewRef.current?.focus();
      },
      isFocusWithin: () => {
        const activeElement = document.activeElement;
        if (!activeElement) return false;
        if (containerRef.current?.contains(activeElement)) return true;
        return Boolean(editorViewRef.current?.hasFocus);
      },
    }));

    const config = modeConfig[mode];

    // Compartment for mode-specific extensions (SQL highlighting + linter)
    // Using useState ensures the compartment persists across renders
    const [modeCompartment] = useState(() => new Compartment());

    // SQL-specific extensions (highlighting + linter) - extracted for reuse
    const sqlModeExtensions = useMemo(() => {
      return [
        sql({ dialect: PostgreSQL }),
        // SQL linter for WHERE clause validation
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

              // Use Rust backend for validation
              const response = await invoke<{
                valid: boolean;
                errors: Array<{
                  from: number;
                  to: number;
                  message: string;
                  severity: string;
                }>;
              }>("sql_validate", {
                request: {
                  sql: testSql,
                  dialect: "postgresql",
                },
              });

              if (response.errors.length > 0) {
                setHasLintError(true);
                // Adjust positions to account for "SELECT * FROM t WHERE " prefix (23 chars)
                const prefixLen = 23;
                return response.errors
                  .map((d) => ({
                    from: Math.max(0, d.from - prefixLen),
                    to: Math.min(Math.max(0, d.to - prefixLen), content.length),
                    severity: d.severity as "error" | "warning" | "info",
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
          { delay: 300 },
        ),
      ];
    }, []);

    // Base extensions shared by all modes (theme, history, styling)
    const baseExtensions = useMemo(() => {
      const actualTheme = resolvedTheme === "dark" ? "dark" : "light";
      const themeExts = getThemeExtensions(actualTheme);

      return [
        tooltips({ parent: document.body }),
        history(),
        keymap.of(historyKeymap),
        ...themeExts,
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
              color: "var(--muted-foreground)",
              fontStyle: "normal",
            },
          },
          { dark: actualTheme === "dark" },
        ),
        EditorView.lineWrapping,
      ];
    }, [resolvedTheme]);

    // Reconfigure mode compartment when mode changes (avoids full extension replacement)
    useEffect(() => {
      const view = editorViewRef.current;
      if (!view) return;

      const newModeExtensions = mode === "where" ? sqlModeExtensions : [];
      view.dispatch({
        effects: modeCompartment.reconfigure(newModeExtensions),
      });
    }, [mode, modeCompartment, sqlModeExtensions]);

    // Memoize column map for O(1) lookups
    const columnMap = useMemo(() => {
      const map = new Map<string, FilterColumnInfo>();
      columns.forEach((col) => map.set(col.name.toLowerCase(), col));
      return map;
    }, [columns]);

    // Auto-submit after idle period (no lint errors, value changed, not loading)
    useEffect(() => {
      // Clear any existing timer
      if (autoSubmitTimer.current) {
        clearTimeout(autoSubmitTimer.current);
        autoSubmitTimer.current = null;
      }

      // Skip if: loading, empty value, same as last submitted, or lint error in WHERE mode
      const trimmedValue = value.replace(/^[?/]/, "").trim();
      if (
        isLoading ||
        !trimmedValue ||
        value === lastSubmittedValue.current ||
        (mode === "where" && hasLintError)
      ) {
        return;
      }

      // Start 3s timer for auto-submit
      autoSubmitTimer.current = setTimeout(() => {
        lastSubmittedValue.current = value;
        onSubmit();
      }, 8000);

      return () => {
        if (autoSubmitTimer.current) {
          clearTimeout(autoSubmitTimer.current);
          autoSubmitTimer.current = null;
        }
      };
    }, [value, isLoading, mode, hasLintError, onSubmit]);

    // Reset lastSubmittedValue when value is cleared
    useEffect(() => {
      if (!value || value === "?" || value === "/") {
        lastSubmittedValue.current = "";
      }
    }, [value]);

    // Memoized keymap extension using refs for stable access
    const keymapExtension = useMemo(() => {
      return Prec.highest(
        keymap.of([
          {
            key: "Enter",
            run: (view) => {
              // Let CodeMirror handle if autocompletion is open
              if (completionStatus(view.state)) {
                return acceptCompletion(view);
              }
              const s = stateRefs.current;
              if (s.mode === "where" && s.hasLintError) return true;
              // Flush any pending debounced sync so parent has the latest value
              if (parentSyncTimer.current) {
                clearTimeout(parentSyncTimer.current);
                parentSyncTimer.current = null;
                onValueChange(internalValueRef.current);
              }
              lastSubmittedValue.current = internalValueRef.current;
              onSubmit();
              return true;
            },
          },
          {
            // Shift+Enter inserts a newline
            key: "Shift-Enter",
            run: (view) => {
              view.dispatch(view.state.replaceSelection("\n"));
              return true;
            },
          },
          {
            // Cmd/Ctrl+Enter also submits
            key: "Mod-Enter",
            run: () => {
              if (parentSyncTimer.current) {
                clearTimeout(parentSyncTimer.current);
                parentSyncTimer.current = null;
                onValueChange(internalValueRef.current);
              }
              lastSubmittedValue.current = internalValueRef.current;
              onSubmit();
              return true;
            },
          },
          {
            key: "Escape",
            run: (view) => {
              // Let CodeMirror close autocompletion first
              if (completionStatus(view.state)) return false;
              const s = stateRefs.current;
              if (s.value) {
                if (s.onClear) {
                  s.onClear();
                } else {
                  onValueChange("");
                }
                return true;
              }
              return false;
            },
          },
          {
            key: "ArrowDown",
            run: (view) => {
              if (completionStatus(view.state)) {
                return moveCompletionSelection(true)(view);
              }
              return false;
            },
          },
          {
            key: "ArrowUp",
            run: (view) => {
              if (completionStatus(view.state)) {
                return moveCompletionSelection(false)(view);
              }
              return false;
            },
          },
          {
            key: "Tab",
            run: (view) => {
              if (completionStatus(view.state)) {
                return acceptCompletion(view);
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
              const s = stateRefs.current;
              const editorContent = view.state.doc.toString();
              if (editorContent === "" && s.mode !== "search") {
                if (s.onClear) {
                  s.onClear();
                } else {
                  onValueChange("");
                  onModeChange("search");
                }
                return true;
              }
              if (editorContent !== "") {
                justSwitchedMode.current = true;
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: "" },
                });
                if (s.onClear) {
                  s.onClear();
                } else {
                  onValueChange("");
                  if (s.mode !== "search") {
                    onModeChange("search");
                  }
                }
                requestAnimationFrame(() => {
                  justSwitchedMode.current = false;
                });
                return true;
              }
              return false;
            },
          },
        ]),
      );
    }, [onSubmit, onValueChange, onModeChange]);

    // Ref for columns so the completion source stays stable
    const columnsRef = useRef(columns);
    columnsRef.current = columns;

    // Column map ref for enum lookups
    const columnMapRef = useRef(columnMap);
    columnMapRef.current = columnMap;

    // CodeMirror autocompletion extension for column names and enum values
    const completionExtension = useMemo(() => {
      return autocompletion({
        aboveCursor: false,
        override: [
          (context: CompletionContext) => {
            const fullText = context.state.doc.sliceString(0, context.pos);

            // Try matching a word at cursor (for partial typing)
            const word = context.matchBefore(/[a-zA-Z_][a-zA-Z0-9_]*/);
            const from = word?.from ?? context.pos;
            const typed = word?.text ?? "";
            const textBeforeWord = fullText.slice(0, from).trimEnd();

            // --- Value context: suggest enum values ---
            // Detect if cursor is positioned where a value is expected
            const isValueContext =
              // After = <> != etc: status =
              OPERATOR_REGEX.test(textBeforeWord) ||
              // Right after a quote: status = '
              QUOTE_REGEX.test(textBeforeWord) ||
              // Typing inside quotes: status = 'pen
              /[=<>!]+\s*'[^']*$/.test(fullText) ||
              // First value in IN list: IN ('  or IN (  or NOT IN ('
              /\bNOT\s+IN\s*\(\s*'?[^']*$/i.test(fullText) ||
              /\bIN\s*\(\s*'?[^']*$/i.test(fullText) ||
              // Subsequent values in IN list: IN ('val1', '  or IN ('val1', pen
              /\bIN\s*\([^)]*,\s*'?[^']*$/i.test(fullText) ||
              // After LIKE/ILIKE: status LIKE '
              /(?:LIKE|ILIKE)\s+'[^']*$/i.test(fullText);

            if (isValueContext) {
              // Extract column name — try multiple strategies
              let colName = extractColumnBeforeCursor(textBeforeWord);
              if (!colName) {
                // Look for column before IN/NOT IN keyword
                const inMatch = fullText.match(/([a-zA-Z_][a-zA-Z0-9_.]*)\s+(?:NOT\s+)?IN\s*\(/i);
                if (inMatch?.[1]) {
                  // Handle table.column — take last part
                  const parts = inMatch[1].split(".");
                  colName = parts[parts.length - 1] ?? null;
                }
              }
              if (colName) {
                const col = columnMapRef.current.get(colName.toLowerCase());
                if (col?.enumValues && col.enumValues.length > 0) {
                  // Find the start position for replacement (include the opening quote if present)
                  const quoteMatch = fullText.match(/['"]([^'"]*)?$/);
                  const replaceFrom = quoteMatch
                    ? context.pos - (quoteMatch[1]?.length ?? 0) - 1
                    : from;
                  const filterText = quoteMatch?.[1]?.toLowerCase() ?? typed.toLowerCase();

                  const options: Completion[] = col.enumValues
                    .filter((v) => !filterText || v.toLowerCase().includes(filterText))
                    .map((v) => ({
                      label: v,
                      displayLabel: `'${v}'`,
                      type: "enum",
                      apply: `'${v}'`,
                    }));
                  if (options.length > 0) {
                    return { from: replaceFrom, options, filter: false };
                  }
                }
              }
              return null;
            }

            // --- Column context: suggest column names ---
            // Trigger when: typing a word, after AND/OR, at start of input, or explicit
            const shouldSuggestColumns =
              !!word ||
              context.explicit ||
              // After logical operators: AND |  OR |
              /\b(?:AND|OR)\s+$/i.test(textBeforeWord) ||
              // At start of empty input
              fullText.trim() === "";

            if (!shouldSuggestColumns) return null;

            const lower = typed.toLowerCase();
            const options: Completion[] = columnsRef.current
              .filter((c) => {
                if (!lower) return true;
                // Don't suggest if user already typed exact column name
                if (c.name.toLowerCase() === lower) return false;
                return c.name.toLowerCase().includes(lower);
              })
              .map((c) => ({
                label: c.name,
                detail: c.dataType,
                type: "property",
              }));

            return options.length > 0 ? { from, options } : null;
          },
        ],
        icons: false,
        addToOptions: [],
        activateOnTyping: true,
      });
    }, []); // Stable — reads from refs

    // Stable combined extensions array - uses Compartment for mode-specific extensions
    // This prevents CodeMirror re-initialization when switching between modes
    // Mode changes are handled via compartment.reconfigure() in the useEffect above
    // IMPORTANT: Do not include 'mode' in deps - compartment handles mode changes
    const combinedExtensions = useMemo(() => {
      // Start with empty compartment - will be reconfigured on mount via effect
      return [...baseExtensions, modeCompartment.of([]), keymapExtension, completionExtension];
    }, [baseExtensions, modeCompartment, keymapExtension, completionExtension]);

    // Clear button handler (Phase 1.4)
    const handleClearClick = useCallback(() => {
      justSwitchedMode.current = true;
      // Cancel any pending debounced sync to prevent stale value from reappearing
      if (parentSyncTimer.current) {
        clearTimeout(parentSyncTimer.current);
        parentSyncTimer.current = null;
      }
      internalValueRef.current = "";
      // Call onClear to persist cleared state to store, or fall back to manual reset
      if (onClear) {
        onClear();
      } else {
        onValueChange("");
        if (mode !== "search") {
          onModeChange("search");
        }
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
    }, [onClear, onValueChange, onModeChange, mode]);

    // Debounced sync to parent - avoids re-rendering the entire BaseDataGrid on every keystroke
    const syncToParent = useCallback(
      (prefixedValue: string) => {
        internalValueRef.current = prefixedValue;
        if (parentSyncTimer.current) {
          clearTimeout(parentSyncTimer.current);
        }
        parentSyncTimer.current = setTimeout(() => {
          parentSyncTimer.current = null;
          onValueChange(prefixedValue);
        }, 80);
      },
      [onValueChange],
    );

    // Flush pending sync immediately (for mode switches and clears)
    const flushParentSync = useCallback(
      (prefixedValue: string) => {
        internalValueRef.current = prefixedValue;
        if (parentSyncTimer.current) {
          clearTimeout(parentSyncTimer.current);
          parentSyncTimer.current = null;
        }
        onValueChange(prefixedValue);
      },
      [onValueChange],
    );

    // Cleanup sync timer on unmount
    useEffect(() => {
      return () => {
        if (parentSyncTimer.current) {
          clearTimeout(parentSyncTimer.current);
        }
      };
    }, []);

    // CodeMirror change handler - uses debounced parent sync for performance
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
          flushParentSync("?" + contentWithoutPrefix);
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
        if (firstChar === "/" && mode !== "ai") {
          const contentWithoutPrefix = newValue.slice(1);
          justSwitchedMode.current = true;
          onModeChange("ai");
          flushParentSync("/" + contentWithoutPrefix);
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
          flushParentSync(contentWithoutPrefix); // Search mode has no prefix
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
            syncToParent("?");
          } else {
            syncToParent("");
          }
          return;
        }

        // Compute the expected prefixed value
        let expectedValue: string;
        if (mode === "where") {
          expectedValue = "?" + newValue;
        } else {
          expectedValue = newValue;
        }

        // Debounced sync to parent to avoid re-rendering on every keystroke
        if (expectedValue !== internalValueRef.current) {
          syncToParent(expectedValue);
        }
      },
      [mode, onModeChange, syncToParent, flushParentSync],
    );


    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center">
          {/* Input with mode selector inside */}
          <div className="flex-1 relative" style={{ minHeight: 30 }}>
            <DropdownMenu
              modal={false}
              onOpenChange={(open) => {
                if (!open) {
                  // Re-focus editor after dropdown fully closes
                  // Use 100ms to ensure close animation and focus-restore have completed
                  setTimeout(() => { editorViewRef.current?.focus(); }, 100);
                }
              }}
            >
              <div
                ref={containerRef}
                className={cn(
                  "w-full rounded-md border border-input pl-8 pr-7 text-xs",
                  "transition-[max-height] duration-150 ease-out overflow-hidden",
                  "absolute left-0 right-0 top-0",
                  isFocused
                    ? "max-h-[120px] z-30 bg-background shadow-md"
                    : "max-h-[30px] bg-input/20 dark:bg-input/30",
                  error
                    ? "border-destructive ring-destructive/50 ring-[3px] focus-within:ring-destructive/50"
                    : "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
                  value && !error && "border-primary/50",
                )}
              >
                {/* Mode selector - inside input at left */}
                {searchModeOnly && !clientSideFiltering ? (
                  <div className="absolute left-1 top-[5px] z-10 flex items-center justify-center rounded-sm size-5 text-muted-foreground">
                    <IconSearch className="size-3.5" />
                  </div>
                ) : (
                  <DropdownMenuTrigger
                    className={cn(
                      "absolute left-1 top-1 z-10 flex items-center justify-center rounded-sm size-5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
                      isLoading && "pointer-events-none opacity-50",
                    )}
                    disabled={isLoading}
                  >
                    {mode === "where" && <IconCode className="size-3.5" />}
                    {mode === "search" && <IconSearch className="size-3.5" />}
                    {mode === "ai" && <IconSparkles className="size-3.5" />}
                  </DropdownMenuTrigger>
                )}
                <CodeMirror
                  value={
                    value.startsWith("?") ||
                    value.startsWith("/") ||
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
                  maxHeight="120px"
                  onCreateEditor={(view) => {
                    focusCleanupRef.current?.();
                    editorViewRef.current = view;
                    // Track focus state for editorTextFocus context
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
                  }}
                />
                {/* Clear button */}
                {value && (
                  <div className="absolute right-1 top-[2px] flex items-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={handleClearClick}
                    >
                      <IconX />
                    </Button>
                  </div>
                )}
              </div>
              {(!searchModeOnly || clientSideFiltering) && (
                <QuickFilterModeMenu
                  mode={mode}
                  value={value}
                  clientSideFiltering={clientSideFiltering}
                  onModeChange={onModeChange}
                  onValueChange={onValueChange}
                  onFocusEditor={() => {
                    setTimeout(() => editorViewRef.current?.focus(), 0);
                  }}
                />
              )}
            </DropdownMenu>
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
