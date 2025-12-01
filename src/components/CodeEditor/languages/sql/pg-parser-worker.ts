/**
 * PgParser Web Worker
 *
 * Runs pg-parser WASM in a dedicated Web Worker to avoid blocking the main thread.
 * This enables smooth typing while parsing happens in the background.
 */

import { PgParser } from "@supabase/pg-parser";

// Worker message types
export interface PgParserRequest {
  id: number;
  type: "parse";
  payload: {
    content: string;
  };
}

export interface PgParserResponse {
  id: number;
  type: "success" | "error";
  payload: {
    diagnostics?: Array<{
      from: number;
      to: number;
      severity: "error" | "warning" | "info";
      message: string;
    }>;
    error?: string;
  };
}

// Parser singleton within worker
let parser: PgParser | null = null;
let initPromise: Promise<PgParser> | null = null;

async function getParser(): Promise<PgParser> {
  if (parser) return parser;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const p = new PgParser();
    await p.ready;
    parser = p;
    return p;
  })();

  return initPromise;
}

async function handleParse(
  content: string
): Promise<PgParserResponse["payload"]> {
  if (!content.trim() || content.length < 10) {
    return { diagnostics: [] };
  }

  try {
    const pgParser = await getParser();
    const result = await pgParser.parse(content);

    const diagnostics: PgParserResponse["payload"]["diagnostics"] = [];

    if (result.error) {
      let from = 0;
      let to = content.length;

      const errorWithPosition = result.error as unknown as { position?: number };
      if (errorWithPosition.position !== undefined && errorWithPosition.position > 0) {
        // Clamp positions to valid document range to prevent stale position issues
        from = Math.min(Math.max(0, errorWithPosition.position - 1), content.length);
        to = Math.min(from + 20, content.length);
      }

      // Only add diagnostic if positions are valid
      if (from <= to && to <= content.length) {
        diagnostics.push({
          from,
          to,
          severity: "error",
          message: result.error.message || "Syntax error",
        });
      }
    }

    return { diagnostics };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Parse error",
      diagnostics: [],
    };
  }
}

// Worker message handler
self.onmessage = async (event: MessageEvent<PgParserRequest>) => {
  const { id, type, payload } = event.data;

  if (type === "parse") {
    const result = await handleParse(payload.content);
    const response: PgParserResponse = {
      id,
      type: result.error ? "error" : "success",
      payload: result,
    };
    self.postMessage(response);
  }
};

// Signal that worker is ready
self.postMessage({ type: "ready" });
