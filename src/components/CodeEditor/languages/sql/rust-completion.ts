/**
 * Rust Backend Completion Source
 *
 * Bridges CodeMirror autocomplete to Rust sql_complete command.
 * Uses Tauri IPC for high-performance completion.
 *
 * IMPORTANT: Schema data must be synced via useRustSchemaSync before
 * this completion source will return schema-aware results.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  CompletionContext,
  CompletionResult,
  Completion,
} from "@codemirror/autocomplete";
import type { SqlDialect } from "../../types";

interface RustCompletionConfig {
  connectionId: string;
  database: string;
  schema?: string;
  dialect: SqlDialect;
}

interface RustCompleteRequest {
  sql: string;
  position: number;
  dialect: string;
  connectionId?: string;
  database?: string;
  schema?: string;
  explicit: boolean;
}

interface RustCompleteResponse {
  items: RustCompletionItem[];
  from: number;
  to: number;
}

interface RustCompletionItem {
  label: string;
  kind: string;
  detail: string | null;
  insertText: string | null;
  sortOrder: number;
}

// Map Rust completion kinds to CodeMirror types
const KIND_MAP: Record<string, string> = {
  keyword: "keyword",
  table: "class",
  column: "property",
  function: "function",
  schema: "namespace",
  alias: "variable",
  cte: "variable",
  snippet: "text",
  database: "namespace",
  enum: "enum",
};

/**
 * Check if Rust completion is available (Tauri environment).
 */
export function isRustCompletionAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/**
 * Create a completion source that uses the Rust backend.
 */
export function createRustCompletionSource(
  config: RustCompletionConfig
): (context: CompletionContext) => Promise<CompletionResult | null> {
  return async (
    context: CompletionContext
  ): Promise<CompletionResult | null> => {
    const sql = context.state.doc.toString();

    // Skip empty documents
    if (!sql.trim()) {
      return null;
    }

    // Skip if not explicit and no trigger character
    if (!context.explicit) {
      const before = context.state.doc.sliceString(
        Math.max(0, context.pos - 1),
        context.pos
      );
      const triggerChars = [".", " ", "(", ",", "'", '"'];
      if (!triggerChars.includes(before)) {
        // Check for word being typed (at least 2 chars)
        const word = context.matchBefore(/\w+/);
        if (!word || word.text.length < 2) {
          return null;
        }
      }
    }

    try {
      const request: RustCompleteRequest = {
        sql,
        position: context.pos,
        dialect: config.dialect,
        connectionId: config.connectionId,
        database: config.database,
        schema: config.schema,
        explicit: context.explicit,
      };

      const response = await invoke<RustCompleteResponse>("sql_complete", {
        request,
      });

      if (!response.items.length) {
        return null;
      }

      const completions: Completion[] = response.items.map((item) => ({
        label: item.label,
        type: KIND_MAP[item.kind] || "text",
        detail: item.detail || undefined,
        apply: item.insertText || item.label,
        boost: -item.sortOrder, // Lower sortOrder = higher priority
      }));

      return {
        from: response.from,
        to: response.to,
        options: completions,
        validFor: /^\w*$/,
      };
    } catch (error) {
      console.error("[rust-completion] Error:", error);
      return null;
    }
  };
}
