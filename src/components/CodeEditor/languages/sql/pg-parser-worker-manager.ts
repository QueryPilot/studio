/**
 * PgParser Worker Manager
 *
 * Manages communication with the pg-parser Web Worker.
 * Provides a simple async API for parsing SQL content off the main thread.
 *
 * DX optimizations:
 * - Request cancellation: Only the latest request is processed
 * - Content deduplication: Skips re-parsing identical content
 * - Result caching: Returns cached diagnostics for unchanged content
 */

import type { Diagnostic } from "@codemirror/lint";
import type { PgParserRequest, PgParserResponse } from "./pg-parser-worker";

class PgParserWorkerManager {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (diagnostics: Diagnostic[]) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private isReady = false;
  private readyPromise: Promise<void> | null = null;

  // DX: Content caching to avoid re-parsing identical content
  private lastContent: string | null = null;
  private lastResult: Diagnostic[] = [];

  async initialize(): Promise<void> {
    if (this.isReady) return;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      let initTimeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (initTimeoutId) {
          clearTimeout(initTimeoutId);
          initTimeoutId = null;
        }
      };

      const handleReject = (error: unknown) => {
        cleanup();
        this.readyPromise = null; // Allow retry on failure
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      try {
        // Create worker using Vite's worker import syntax
        this.worker = new Worker(
          new URL("./pg-parser-worker.ts", import.meta.url),
          { type: "module" }
        );

        // Single message handler for all messages
        this.worker.onmessage = (event: MessageEvent) => {
          if (event.data?.type === "ready") {
            this.isReady = true;
            cleanup();
            resolve();
            return;
          }
          this.handleResponse(event.data as PgParserResponse);
        };

        this.worker.onerror = (error) => {
          // Reject all pending requests
          for (const [id, handlers] of this.pendingRequests) {
            clearTimeout(handlers.timeout);
            handlers.reject(new Error("Worker error"));
            this.pendingRequests.delete(id);
          }
          handleReject(error);
        };

        // Timeout for initialization
        initTimeoutId = setTimeout(() => {
          if (!this.isReady) {
            handleReject(new Error("Worker initialization timeout"));
          }
        }, 10000);
      } catch (error) {
        handleReject(error);
      }
    });

    return this.readyPromise;
  }

  private handleResponse(response: PgParserResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    if (response.type === "error" && response.payload.error) {
      pending.reject(new Error(response.payload.error));
    } else {
      // Validate diagnostic positions against cached content length
      // This prevents stale diagnostics from causing issues when document has changed
      const contentLength = this.lastContent?.length ?? 0;
      const diagnostics: Diagnostic[] = (response.payload.diagnostics || [])
        .filter((d) => {
          // Discard diagnostics with invalid positions
          if (d.from < 0 || d.to < d.from) return false;
          // If we have cached content, validate against its length
          // Allow diagnostics if no cached content yet (first parse)
          if (contentLength > 0 && d.to > contentLength) return false;
          return true;
        })
        .map((d) => ({
          from: d.from,
          to: d.to,
          severity: d.severity,
          message: d.message,
        }));
      pending.resolve(diagnostics);
    }
  }

  /**
   * Cancel all pending requests except the current one.
   * Resolves stale requests with empty diagnostics.
   */
  private cancelStaleRequests(currentId: number): void {
    for (const [id, handlers] of this.pendingRequests) {
      if (id !== currentId) {
        clearTimeout(handlers.timeout);
        handlers.resolve([]); // Resolve stale requests with empty result
        this.pendingRequests.delete(id);
      }
    }
  }

  async parse(content: string): Promise<Diagnostic[]> {
    // DX: Return cached result if content unchanged
    if (content === this.lastContent) {
      return this.lastResult;
    }

    await this.initialize();

    const worker = this.worker;
    if (!worker) {
      throw new Error("Worker not initialized");
    }

    const id = ++this.requestId;

    // DX: Cancel stale requests - only process the latest
    this.cancelStaleRequests(id);

    return new Promise((resolve, reject) => {
      // Timeout after 5 seconds
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          resolve([]); // Return empty diagnostics on timeout
        }
      }, 5000);

      this.pendingRequests.set(id, {
        resolve: (diagnostics) => {
          // DX: Cache the result
          this.lastContent = content;
          this.lastResult = diagnostics;
          resolve(diagnostics);
        },
        reject,
        timeout,
      });

      const request: PgParserRequest = {
        id,
        type: "parse",
        payload: { content },
      };

      worker.postMessage(request);
    });
  }

  terminate(): void {
    if (this.worker) {
      // Clear all pending requests
      for (const [, handlers] of this.pendingRequests) {
        clearTimeout(handlers.timeout);
        handlers.resolve([]); // Resolve with empty diagnostics
      }
      this.pendingRequests.clear();

      this.worker.terminate();
      this.worker = null;
      this.isReady = false;
      this.readyPromise = null;

      // Clear cache
      this.lastContent = null;
      this.lastResult = [];
    }
  }
}

// Singleton instance with thread-safe initialization
let workerManager: PgParserWorkerManager | null = null;
let refCount = 0;
let initializationLock: Promise<PgParserWorkerManager> | null = null;

function getWorkerManager(): PgParserWorkerManager {
  if (workerManager) {
    return workerManager;
  }
  // Create synchronously to prevent race conditions
  workerManager = new PgParserWorkerManager();
  return workerManager;
}

/**
 * Get worker manager with guaranteed initialization.
 * Uses a lock to prevent multiple concurrent initializations.
 */
async function getInitializedWorkerManager(): Promise<PgParserWorkerManager> {
  const manager = getWorkerManager();

  // If already initialized, return immediately
  if (manager["isReady"]) {
    return manager;
  }

  // Use initialization lock to prevent race conditions
  if (!initializationLock) {
    initializationLock = manager.initialize().then(() => {
      initializationLock = null; // Clear lock after success
      return manager;
    }).catch((error) => {
      initializationLock = null; // Clear lock on failure to allow retry
      throw error;
    });
  }

  await initializationLock;
  return manager;
}

/**
 * Acquire a reference to the pg-parser worker.
 * Call this when mounting a PostgreSQL editor.
 */
export function acquirePgParserWorker(): void {
  refCount++;
}

/**
 * Release a reference to the pg-parser worker.
 * Call this when unmounting a PostgreSQL editor.
 */
export function releasePgParserWorker(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && workerManager) {
    workerManager.terminate();
    workerManager = null;
  }
}

/**
 * Parse SQL content using the pg-parser worker.
 * Returns diagnostics array.
 * Uses thread-safe initialization to prevent race conditions.
 */
export async function parseWithWorker(content: string): Promise<Diagnostic[]> {
  const manager = await getInitializedWorkerManager();
  return manager.parse(content);
}

/**
 * Pre-initialize the worker to avoid delay on first parse.
 */
export function preInitPgParserWorker(): void {
  getWorkerManager().initialize().catch(() => {
    // Silently ignore - will retry on first use
  });
}
