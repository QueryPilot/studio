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

export interface UseQuickFilterOptions {
  /** Columns available for filtering (can be empty initially, will update reactively) */
  columns: FilterColumnInfo[];
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
  initialFilter,
  generateAIFilter,
  clientSideFiltering = false,
}: UseQuickFilterOptions): UseQuickFilterResult {
  // Filter input state
  const [value, setValue] = useState(() =>
    initialFilter ? `?${initialFilter}` : ""
  );
  const [mode, setMode] = useState<FilterMode>(() =>
    initialFilter ? "where" : "search"
  );
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

  // Track previous value to avoid unnecessary state updates
  const prevValueRef = useRef(value);

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
            return;
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
            setValue(result.clause);
            setMode("search");
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
            setValue(`?${result.clause}`);
            setMode("where");
          }
        } finally {
          setIsLoading(false);
        }
        break;
      }
    }
  }, [value, mode, columns, generateAIFilter, clientSideFiltering]);

  // Clear filter
  const clear = useCallback(() => {
    setValue("");
    setMode("search");
    setError(null);
    setAiExplanation(null);
    setActiveFilter(undefined);
  }, []);

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
