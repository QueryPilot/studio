/**
 * PgParser Worker Manager
 *
 * Manages communication with the pg-parser Web Worker.
 * Provides a simple async API for parsing SQL content off the main thread.
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

  async initialize(): Promise<void> {
    if (this.isReady) return;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      try {
        // Create worker using Vite's worker import syntax
        this.worker = new Worker(
          new URL("./pg-parser-worker.ts", import.meta.url),
          { type: "module" }
        );

        const onReady = (event: MessageEvent) => {
          if (event.data?.type === "ready") {
            this.isReady = true;
            this.worker?.removeEventListener("message", onReady);
            resolve();
          }
        };

        this.worker.addEventListener("message", onReady);

        this.worker.onmessage = (event: MessageEvent) => {
          // Skip ready message (different type than PgParserResponse)
          if (event.data?.type === "ready") return;
          this.handleResponse(event.data as PgParserResponse);
        };

        this.worker.onerror = (error) => {
          // Reject all pending requests
          for (const [id, handlers] of this.pendingRequests) {
            clearTimeout(handlers.timeout);
            handlers.reject(new Error("Worker error"));
            this.pendingRequests.delete(id);
          }
          reject(error);
        };

        // Timeout for initialization
        setTimeout(() => {
          if (!this.isReady) {
            reject(new Error("Worker initialization timeout"));
          }
        }, 10000);
      } catch (error) {
        reject(error);
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
      const diagnostics: Diagnostic[] = (response.payload.diagnostics || []).map(
        (d) => ({
          from: d.from,
          to: d.to,
          severity: d.severity,
          message: d.message,
        })
      );
      pending.resolve(diagnostics);
    }
  }

  async parse(content: string): Promise<Diagnostic[]> {
    await this.initialize();

    if (!this.worker) {
      throw new Error("Worker not initialized");
    }

    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      // Timeout after 5 seconds
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          resolve([]); // Return empty diagnostics on timeout instead of rejecting
        }
      }, 5000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const request: PgParserRequest = {
        id,
        type: "parse",
        payload: { content },
      };

      this.worker!.postMessage(request);
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
    }
  }
}

// Singleton instance with reference counting
let workerManager: PgParserWorkerManager | null = null;
let refCount = 0;

function getWorkerManager(): PgParserWorkerManager {
  if (!workerManager) {
    workerManager = new PgParserWorkerManager();
  }
  return workerManager;
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
 */
export async function parseWithWorker(content: string): Promise<Diagnostic[]> {
  const manager = getWorkerManager();
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
