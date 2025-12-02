import { useCallback, useState, useRef, useEffect } from "react";
import {
  parseSimpleSearch,
  parseWhereClause,
  sanitizeInput,
  detectFilterMode,
  type FilterMode,
  type FilterColumnInfo,
} from "@/utils/filterParser";
import type { FilterConfig } from "@/types/filter";

export interface UseQuickFilterOptions {
  /** Columns available for filtering */
  columns: FilterColumnInfo[];
  /** Initial WHERE clause filter (e.g., from FK reference navigation) */
  initialFilter?: string;
  /** AI filter generator function */
  generateAIFilter?: (
    prompt: string
  ) => Promise<
    { clause: string; explanation?: string; usedSubquery?: boolean } | { error: string }
  >;
  /** Callback when filter changes */
  onFilterChange?: (filter: FilterConfig | undefined) => void;
}

export interface UseQuickFilterResult {
  // State
  value: string;
  mode: FilterMode;
  error: string | null;
  aiExplanation: string | null;
  activeFilter: FilterConfig | undefined;
  isAILoading: boolean;

  // Actions
  setValue: (value: string) => void;
  setMode: (mode: FilterMode) => void;
  submit: () => Promise<void>;
  clear: () => void;

  // Ref for QuickFilter component
  inputRef: React.RefObject<{ focus: () => void } | null>;
}

/**
 * Hook for managing quick filter state and submission.
 * Handles search, WHERE clause, and AI filter modes.
 */
export function useQuickFilter({
  columns,
  initialFilter,
  generateAIFilter,
  onFilterChange,
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
  const [isAILoading, setIsAILoading] = useState(false);

  // Ref for input focus
  const inputRef = useRef<{ focus: () => void } | null>(null);

  // Track the last applied initial filter to detect changes
  const lastAppliedFilterRef = useRef<string | undefined>(undefined);

  // Handle value change with mode detection
  const handleSetValue = useCallback((newValue: string) => {
    setValue(newValue);
    const detectedMode = detectFilterMode(newValue);
    if (detectedMode !== mode) {
      setMode(detectedMode);
    }
  }, [mode]);

  // Handle filter submission
  const submit = useCallback(async () => {
    setError(null);
    setAiExplanation(null);

    const sanitized = sanitizeInput(value, mode);
    if (!sanitized) {
      setActiveFilter(undefined);
      onFilterChange?.(undefined);
      return;
    }

    switch (mode) {
      case "search": {
        const filter = parseSimpleSearch(sanitized, columns);
        const newFilter = filter.root.conditions.length > 0 ? filter : undefined;
        setActiveFilter(newFilter);
        onFilterChange?.(newFilter);
        break;
      }
      case "where": {
        const result = parseWhereClause(sanitized, columns);
        if (result.success) {
          setActiveFilter(result.filter);
          onFilterChange?.(result.filter);
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

        setIsAILoading(true);
        try {
          const result = await generateAIFilter(sanitized);
          if ("error" in result) {
            setError(result.error);
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
            onFilterChange?.(filter);

            // Show AI explanation
            if (result.explanation) {
              setAiExplanation(result.explanation);
            }

            // Update input to show generated clause with ? prefix
            setValue(`?${result.clause}`);
            setMode("where");
          }
        } finally {
          setIsAILoading(false);
        }
        break;
      }
    }
  }, [value, mode, columns, generateAIFilter, onFilterChange]);

  // Clear filter
  const clear = useCallback(() => {
    setValue("");
    setMode("search");
    setError(null);
    setAiExplanation(null);
    setActiveFilter(undefined);
    onFilterChange?.(undefined);
  }, [onFilterChange]);

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
        onFilterChange?.(result.filter);
      }
    }
  }, [initialFilter, columns, onFilterChange]);

  return {
    value,
    mode,
    error,
    aiExplanation,
    activeFilter,
    isAILoading,
    setValue: handleSetValue,
    setMode,
    submit,
    clear,
    inputRef,
  };
}
