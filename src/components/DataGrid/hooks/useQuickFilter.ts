import { useCallback, useState, useRef, useEffect } from "react";
import {
  parseSimpleSearch,
  parseWhereClause,
  sanitizeInput,
  detectFilterMode,
  type FilterMode,
  type FilterColumnInfo,
} from "@/utils/filterParser";
import type { FilterConfig } from "@/types";
import { useGridPreferencesStore } from "../stores/gridPreferencesStore";
import { useGridPreferencesHydrated } from "../stores/gridPreferencesSelectors";

export interface UseQuickFilterOptions {
  /** Columns available for filtering (can be empty initially, will update reactively) */
  columns: FilterColumnInfo[];
  /** Initial raw input value shown in the filter box */
  initialValue?: string;
  /** Initial WHERE clause filter (e.g., from FK reference navigation) */
  initialFilter?: string;
  /** Enable client-side filtering mode (AI generates search patterns instead of SQL, WHERE mode disabled) */
  clientSideFiltering?: boolean;
  /** AI filter generator function (optional, required for AI mode) */
  generateAIFilter?: (
    prompt: string,
    options?: { outputType?: "sql" | "search_pattern" }
  ) => Promise<
    { clause: string; explanation?: string; usedSubquery?: boolean } | { error: string }
  >;
  /** Grid ID for persistence (optional - if provided, will persist to IndexedDB) */
  gridId?: string;
}

export interface UseQuickFilterResult {
  // State
  value: string;
  mode: FilterMode;
  error: string | null;
  aiExplanation: string | null;
  activeFilter: FilterConfig | undefined;
  isLoading: boolean;

  // Actions
  setValue: (value: string) => void;
  setMode: (mode: FilterMode) => void;
  submit: () => Promise<void>;
  clear: () => void;
  focus: () => void;
}

/**
 * Hook for managing quick filter state and submission.
 * Handles search, WHERE clause, and AI filter modes.
 */
export function useQuickFilter({
  columns,
  initialValue,
  initialFilter,
  generateAIFilter,
  clientSideFiltering = false,
  gridId,
}: UseQuickFilterOptions): UseQuickFilterResult {
  // Subscribe to hydration state and persisted filter reactively
  const hydrated = useGridPreferencesHydrated();
  const persistedFilter = useGridPreferencesStore(
    (state) => gridId ? state.preferences[gridId]?.quickFilter : undefined
  );
  const hasExplicitInitialValue = typeof initialValue === "string";

  // Filter input state - initialize from persisted or defaults
  const [value, setValue] = useState(() => {
    if (hasExplicitInitialValue) {
      return initialValue;
    }
    // On initial mount, try to read from store (may not be hydrated yet)
    if (gridId) {
      const persisted = useGridPreferencesStore.getState().preferences[gridId]?.quickFilter;
      if (persisted) {
        return persisted.value;
      }
    }
    // Fall back to explicit initial value, initialFilter, or empty
    return initialFilter ? `?${initialFilter}` : "";
  });
  const [mode, setMode] = useState<FilterMode>(() => {
    if (hasExplicitInitialValue) {
      return initialValue.trim().length > 0
        ? detectFilterMode(initialValue)
        : "search";
    }
    // On initial mount, try to read from store (may not be hydrated yet)
    if (gridId) {
      const persisted = useGridPreferencesStore.getState().preferences[gridId]?.quickFilter;
      if (persisted) {
        return persisted.mode;
      }
    }
    // Fall back to the explicit initial value, initialFilter detection, or search
    return initialFilter ? "where" : "search";
  });
  const [error, setError] = useState<string | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterConfig | undefined>(
    undefined
  );
  const [isLoading, setIsLoading] = useState(false);

  // Ref for input focus
  const inputRef = useRef<{ focus: () => void } | null>(null);

  // Track the last applied initial filter to detect changes
  const lastAppliedFilterRef = useRef<string | undefined>(undefined);

  // Track whether we've already restored the persisted filter
  const hasRestoredPersistedFilterRef = useRef(false);

  // Track previous value to avoid unnecessary state updates
  const prevValueRef = useRef(value);

  // Track the last filter value this hook wrote to the store, so we can
  // distinguish external writes (e.g. from AI grid.setFilter command).
  const lastPersistedByUsRef = useRef<string | undefined>(undefined);

  // Handle value change with mode detection and UX improvements
  const handleSetValue = useCallback((newValue: string) => {
    // Skip if value hasn't actually changed (prevents unnecessary re-renders)
    if (newValue === prevValueRef.current) {
      return;
    }
    prevValueRef.current = newValue;

    setValue(newValue);

    // Clear errors when user starts typing (better UX)
    setError(null);
    setAiExplanation(null);

    // Auto-detect mode from prefix, but preserve AI mode unless explicitly changed
    // This allows users to type naturally in AI mode without needing # prefix
    const detectedMode = detectFilterMode(newValue);
    if (detectedMode !== mode) {
      // Only switch away from AI mode if user explicitly typed a different prefix
      // (? for where mode, or \ for escaped search)
      const hasExplicitPrefix = newValue.trim().startsWith("?") || newValue.trim().startsWith("\\");
      if (mode !== "ai" || hasExplicitPrefix) {
        setMode(detectedMode);
      }
    }

    // Clear filter immediately when input is empty (instant feedback)
    if (!newValue.trim()) {
      setActiveFilter(undefined);
    }
  }, [mode]);

  // Handle filter submission
  const submit = useCallback(async () => {
    setError(null);
    setAiExplanation(null);

    const sanitized = sanitizeInput(value, mode);
    if (!sanitized) {
      setActiveFilter(undefined);
      return;
    }

    let finalValue = value;
    let finalMode = mode;

    switch (mode) {
      case "search": {
        const filter = parseSimpleSearch(sanitized, columns);
        const newFilter = filter.root.conditions.length > 0 ? filter : undefined;
        setActiveFilter(newFilter);
        break;
      }
      case "where": {
        const result = parseWhereClause(sanitized, columns);
        if (result.success) {
          setActiveFilter(result.filter);
        } else {
          setError(result.error || "Invalid WHERE clause");
          return; // Don't persist on error
        }
        break;
      }
      case "ai": {
        if (!generateAIFilter) {
          setError("AI filter not available");
          return;
        }

        setIsLoading(true);
        try {
          const outputType = clientSideFiltering ? "search_pattern" : "sql";
          const result = await generateAIFilter(sanitized, { outputType });
          if ("error" in result) {
            setError(result.error);
            return; // Don't persist on error
          }
          if (clientSideFiltering) {
            // In client-side mode, the clause is a search pattern
            // Parse it to set activeFilter
            const filter = parseSimpleSearch(result.clause, columns);
            const newFilter =
              filter.root.conditions.length > 0 ? filter : undefined;
            setActiveFilter(newFilter);

            // Show AI explanation
            if (result.explanation) {
              setAiExplanation(result.explanation);
            }

            // Update input (no prefix for search mode)
            finalValue = result.clause;
            finalMode = "search";
            setValue(finalValue);
            setMode(finalMode);
          } else {
            // Use raw WHERE clause directly
            const filter: FilterConfig = {
              root: {
                id: "root",
                type: "group",
                logical: "AND",
                conditions: [],
              },
              rawWhereClause: result.clause,
            };
            setActiveFilter(filter);

            // Show AI explanation
            if (result.explanation) {
              setAiExplanation(result.explanation);
            }

            // Update input to show generated clause with ? prefix
            finalValue = `?${result.clause}`;
            finalMode = "where";
            setValue(finalValue);
            setMode(finalMode);
          }
        } finally {
          setIsLoading(false);
        }
        break;
      }
    }

    // Persist to grid preferences store
    if (gridId) {
      lastPersistedByUsRef.current = finalValue;
      useGridPreferencesStore.getState().setQuickFilter(gridId, {
        value: finalValue,
        mode: finalMode,
      });
    }
  }, [value, mode, columns, generateAIFilter, clientSideFiltering, gridId]);

  // Clear filter
  const clear = useCallback(() => {
    setValue("");
    setMode("search");
    setError(null);
    setAiExplanation(null);
    setActiveFilter(undefined);

    // Clear from grid preferences store
    if (gridId) {
      lastPersistedByUsRef.current = undefined;
      useGridPreferencesStore.getState().setQuickFilter(gridId, undefined);
    }
  }, [gridId]);

  // Focus the input
  const focus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Apply initial filter on mount or when it changes
  useEffect(() => {
    if (
      initialFilter &&
      initialFilter !== lastAppliedFilterRef.current &&
      columns.length > 0
    ) {
      lastAppliedFilterRef.current = initialFilter;
      // Mark as restored to prevent persisted filter from overwriting
      hasRestoredPersistedFilterRef.current = true;
      // Update the quick filter UI state
      setValue(`?${initialFilter}`);
      setMode("where");
      setError(null);
      // Parse and apply the filter
      const result = parseWhereClause(initialFilter, columns);
      if (result.success) {
        setActiveFilter(result.filter);
      }
    }
  }, [initialFilter, columns]);

  // Restore persisted filter when hydration completes and columns become available
  // Uses reactive subscription to persistedFilter instead of getState() for proper hydration support
  useEffect(() => {
    // Skip if no gridId, no columns, not hydrated, or already restored
    if (!gridId || columns.length === 0 || !hydrated || hasRestoredPersistedFilterRef.current) {
      return;
    }

    // Skip if explicit inputs are controlling the filter state.
    if (initialFilter || hasExplicitInitialValue) {
      hasRestoredPersistedFilterRef.current = true;
      lastPersistedByUsRef.current = persistedFilter?.value;
      return;
    }

    // Use the subscribed persistedFilter (reactive to hydration)
    if (!persistedFilter || !persistedFilter.value) {
      hasRestoredPersistedFilterRef.current = true;
      return;
    }

    hasRestoredPersistedFilterRef.current = true;

    // Sync value and mode state from persisted (in case useState initializer ran before hydration)
    if (persistedFilter.value !== value) {
      setValue(persistedFilter.value);
      prevValueRef.current = persistedFilter.value;
    }
    if (persistedFilter.mode !== mode) {
      setMode(persistedFilter.mode);
    }

    // Parse and apply the persisted filter
    const sanitized = sanitizeInput(persistedFilter.value, persistedFilter.mode);
    if (!sanitized) return;

    if (persistedFilter.mode === "search") {
      const filter = parseSimpleSearch(sanitized, columns);
      const newFilter = filter.root.conditions.length > 0 ? filter : undefined;
      setActiveFilter(newFilter);
    } else if (persistedFilter.mode === "where") {
      const result = parseWhereClause(sanitized, columns);
      if (result.success) {
        setActiveFilter(result.filter);
      }
    }
    // Note: AI mode is not auto-applied since it requires user interaction
  }, [gridId, columns, initialFilter, hasExplicitInitialValue, hydrated, persistedFilter, value, mode]);

  // React to external store changes (e.g. AI agent calling grid.setFilter)
  // This runs after initial restore, only when the store was changed by something
  // other than this hook's own submit/clear.
  useEffect(() => {
    if (!gridId || !hasRestoredPersistedFilterRef.current || columns.length === 0) return;

    // No persisted filter — someone cleared it externally
    if (!persistedFilter) {
      if (lastPersistedByUsRef.current === undefined) return; // we did it
      lastPersistedByUsRef.current = undefined;
      setValue("");
      prevValueRef.current = "";
      setMode("search");
      setActiveFilter(undefined);
      setError(null);
      return;
    }

    // Same value we wrote — skip
    if (persistedFilter.value === lastPersistedByUsRef.current) return;

    // External change detected — sync local state
    lastPersistedByUsRef.current = persistedFilter.value;
    setValue(persistedFilter.value);
    prevValueRef.current = persistedFilter.value;
    setMode(persistedFilter.mode);
    setError(null);
    setAiExplanation(null);

    // Parse and apply
    const sanitized = sanitizeInput(persistedFilter.value, persistedFilter.mode);
    if (!sanitized) {
      setActiveFilter(undefined);
      return;
    }
    if (persistedFilter.mode === "search") {
      const filter = parseSimpleSearch(sanitized, columns);
      setActiveFilter(filter.root.conditions.length > 0 ? filter : undefined);
    } else if (persistedFilter.mode === "where") {
      const result = parseWhereClause(sanitized, columns);
      if (result.success) {
        setActiveFilter(result.filter);
      }
    }
  }, [gridId, columns, persistedFilter]);

  return {
    value,
    mode,
    error,
    aiExplanation,
    activeFilter,
    isLoading,
    setValue: handleSetValue,
    setMode,
    submit,
    clear,
    focus,
  };
}
