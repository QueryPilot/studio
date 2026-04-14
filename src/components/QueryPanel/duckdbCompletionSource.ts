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

interface DuckDbCompletionSourceHandle {
  source: CompletionSource;
  dispose: () => void;
}

/**
 * Creates a CodeMirror CompletionSource backed by DuckDB's sql_auto_complete().
 *
 * The source debounces calls (150ms) and silently returns null on errors
 * (partial SQL may be invalid, which is expected during typing).
 *
 * Returns a `{ source, dispose }` handle — call `dispose()` when the editor
 * unmounts or the connection changes to prevent stale timer fires.
 */
export function createDuckDbCompletionSource(
  connId: string,
): DuckDbCompletionSourceHandle {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastResult: CompletionResult | null = null;
  let lastText = "";
  let disposed = false;

  const source: CompletionSource = (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const { state, pos } = context;
    const fullDoc = state.doc.toString();
    const textUpToCursor = fullDoc.slice(0, pos);

    if (!textUpToCursor.trim() || disposed) {
      return Promise.resolve(null);
    }

    if (textUpToCursor === lastText && lastResult) {
      return Promise.resolve(lastResult);
    }

    return new Promise<CompletionResult | null>((resolve) => {
      if (debounceTimer) clearTimeout(debounceTimer);

      debounceTimer = setTimeout(async () => {
        if (disposed) {
          resolve(null);
          return;
        }
        try {
          const suggestions: DuckDbAutocompleteSuggestion[] =
            await BackendAPI.duckdbAutocomplete(connId, textUpToCursor);

          if (disposed) {
            resolve(null);
            return;
          }

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

  const dispose = () => {
    disposed = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  return { source, dispose };
}
