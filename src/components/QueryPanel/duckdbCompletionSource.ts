import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { BackendAPI } from "@/services/backend";
import type { DuckDbAutocompleteSuggestion } from "@/services/backend";

const DEBOUNCE_MS = 150;

function mapSuggestionType(
  suggestionType: string | null,
): "keyword" | "type" | "function" | "property" | "class" {
  if (!suggestionType) return "keyword";
  switch (suggestionType.toLowerCase()) {
    case "column":
      return "property";
    case "table":
    case "view":
      return "class";
    case "function":
    case "scalar function":
    case "aggregate function":
    case "macro":
      return "function";
    case "keyword":
      return "keyword";
    case "type":
      return "type";
    default:
      return "keyword";
  }
}

/**
 * Creates a CodeMirror CompletionSource backed by DuckDB's sql_auto_complete().
 *
 * The source debounces calls (150ms) and silently returns null on errors
 * (partial SQL may be invalid, which is expected during typing).
 */
export function createDuckDbCompletionSource(
  connId: string,
): CompletionSource {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastResult: CompletionResult | null = null;
  let lastText = "";

  return (context: CompletionContext): Promise<CompletionResult | null> => {
    const { state, pos } = context;
    const fullDoc = state.doc.toString();
    const textUpToCursor = fullDoc.slice(0, pos);

    if (!textUpToCursor.trim()) {
      return Promise.resolve(null);
    }

    if (textUpToCursor === lastText && lastResult) {
      return Promise.resolve(lastResult);
    }

    return new Promise<CompletionResult | null>((resolve) => {
      if (debounceTimer) clearTimeout(debounceTimer);

      debounceTimer = setTimeout(async () => {
        try {
          const suggestions: DuckDbAutocompleteSuggestion[] =
            await BackendAPI.duckdbAutocomplete(connId, textUpToCursor);

          if (suggestions.length === 0) {
            lastText = textUpToCursor;
            lastResult = null;
            resolve(null);
            return;
          }

          const from = Math.min(
            ...suggestions.map((s) => s.suggestionStart),
          );

          const result: CompletionResult = {
            from,
            options: suggestions.map((s) => ({
              label: s.suggestion,
              type: mapSuggestionType(s.suggestionType),
            })),
            validFor: /^[\w_]*$/,
          };

          lastText = textUpToCursor;
          lastResult = result;
          resolve(result);
        } catch {
          resolve(null);
        }
      }, DEBOUNCE_MS);
    });
  };
}
