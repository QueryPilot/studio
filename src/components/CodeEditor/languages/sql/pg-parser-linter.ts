/**
 * PostgreSQL Parser Linter
 *
 * Uses @supabase/pg-parser for accurate PostgreSQL parsing.
 * Supports full PostgreSQL syntax including PL/pgSQL.
 */

import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { PgParser } from "@supabase/pg-parser";

// Parser singleton
let parser: PgParser | null = null;
let initPromise: Promise<PgParser> | null = null;

/**
 * Initialize the PostgreSQL parser
 */
async function initPgParser(): Promise<PgParser> {
  if (parser) return parser;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      parser = new PgParser(); // Defaults to latest PostgreSQL version
      // Wait for WASM to be ready
      await parser.ready;
      console.log("[PgParser] Initialized successfully");
      return parser;
    } catch (error) {
      console.error("[PgParser] Failed to initialize:", error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Pre-initialize the parser to avoid delay on first lint
 */
export function preInitPgParser(): void {
  initPgParser().catch(() => {
    // Silently ignore - will retry on first use
  });
}

/**
 * Create a PostgreSQL parser linter extension
 * Only active for PostgreSQL dialect
 */
export const createPgParserLinter = (): Extension => {
  return linter(
    async (view: EditorView): Promise<Diagnostic[]> => {
      const content = view.state.doc.toString();
      if (!content.trim()) return [];

      try {
        const pgParser = await initPgParser();
        const result = await pgParser.parse(content);

        const diagnostics: Diagnostic[] = [];

        // Check for parse errors
        if (result.error) {
          // pg-parser returns error with location info
          const error = result.error;

          // Try to extract position from error
          let from = 0;
          let to = content.length;

          // Access position property (may be set during construction)
          const errorWithPosition = error as unknown as { position?: number };
          if (errorWithPosition.position !== undefined && errorWithPosition.position > 0) {
            from = errorWithPosition.position - 1; // 1-indexed to 0-indexed
            to = Math.min(from + 20, content.length);
          }

          diagnostics.push({
            from,
            to,
            severity: "error",
            message: error.message || "Syntax error",
          });
        }

        return diagnostics;
      } catch (error) {
        console.error("[PgParserLinter] Error:", error);
        return [];
      }
    },
    {
      delay: 300,
      needsRefresh: (update) => update.docChanged,
    }
  );
};

/**
 * Parse SQL and return the AST
 */
export async function parsePgSQL(content: string): Promise<{
  tree: unknown;
  error?: { message: string; cursorPosition?: number };
}> {
  try {
    const pgParser = await initPgParser();
    return await pgParser.parse(content);
  } catch (error) {
    return {
      tree: null,
      error: {
        message: error instanceof Error ? error.message : "Parse error",
      },
    };
  }
}

/**
 * Check if parser is initialized
 */
export function isInitialized(): boolean {
  return parser !== null;
}
