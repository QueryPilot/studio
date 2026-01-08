/**
 * PostgreSQL Parser Linter
 *
 * Uses @supabase/pg-parser for accurate PostgreSQL parsing.
 * Parsing runs in a Web Worker to avoid blocking the main thread.
 * Supports full PostgreSQL syntax including PL/pgSQL.
 */

import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { PgParser } from "@supabase/pg-parser";
import {
  parseWithWorker,
  preInitPgParserWorker,
} from "./pg-parser-worker-manager";

// ============================================================================
// MAIN THREAD PARSER - Only for AST access (non-linting use cases)
// ============================================================================
let parser: PgParser | null = null;
let initPromise: Promise<PgParser> | null = null;

async function initPgParser(): Promise<PgParser> {
  if (parser) return parser;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    parser = new PgParser();
    await parser.ready;
    return parser;
  })();

  return initPromise;
}

/**
 * Pre-initialize the worker to avoid delay on first lint.
 * This is called from extensions.ts on module load.
 */
export function preInitPgParser(): void {
  preInitPgParserWorker();
}

/**
 * Create a PostgreSQL parser linter extension.
 * Parsing runs in a Web Worker - never blocks the main thread.
 */
export const createPgParserLinter = (): Extension => {
  return linter(
    async (view: EditorView): Promise<Diagnostic[]> => {
      const content = view.state.doc.toString();
      // Skip very short or empty content
      if (!content.trim() || content.length < 10) return [];

      try {
        // Parse in Web Worker - non-blocking
        return await parseWithWorker(content);
      } catch {
        return [];
      }
    },
    {
      delay: 500, // Increased from 300ms - reduces visual flickering during rapid typing
      needsRefresh: (update) => update.docChanged,
    }
  );
};

/**
 * Parse SQL and return the AST.
 * Note: This runs on the main thread. For linting, use createPgParserLinter instead.
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
 * Check if main-thread parser is initialized.
 */
export function isInitialized(): boolean {
  return parser !== null;
}
