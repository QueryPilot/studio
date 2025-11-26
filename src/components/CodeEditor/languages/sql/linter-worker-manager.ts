/**
 * Worker Manager for SQL Linting
 *
 * Manages communication with the linter Web Worker and provides
 * a CodeMirror-compatible linter interface.
 *
 * DX optimizations:
 * - Request cancellation: Only the latest request is processed
 * - Content deduplication: Skips re-linting identical content
 * - Result caching: Returns cached diagnostics for unchanged content
 * - Pre-initialization: Worker ready before first use
 */

import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type {
  LinterWorkerRequest,
  LinterWorkerResponse,
  WorkerDiagnostic
} from "./linter-worker";

class LinterWorkerManager {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (diagnostics: Diagnostic[]) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  // DX: Content caching to avoid re-linting identical content
  private lastContent: string | null = null;
  private lastDialect: string | null = null;
  private lastResult: Diagnostic[] = [];

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      try {
        // Create worker using Vite's worker import syntax
        this.worker = new Worker(
          new URL('./linter-worker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (event: MessageEvent<LinterWorkerResponse>) => {
          this.handleResponse(event.data);
        };

        this.worker.onerror = () => {
          // Reject all pending requests
          for (const [id, handlers] of this.pendingRequests) {
            clearTimeout(handlers.timeout);
            handlers.reject(new Error('Worker error'));
            this.pendingRequests.delete(id);
          }
        };

        this.isInitialized = true;
        resolve();
      } catch (error) {
        reject(error);
      }
    });

    return this.initPromise;
  }

  private handleResponse(response: LinterWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    if (response.type === 'error') {
      pending.reject(new Error(response.payload.error || 'Unknown error'));
    } else {
      const diagnostics = this.convertDiagnostics(response.payload.diagnostics || []);
      pending.resolve(diagnostics);
    }
  }

  private convertDiagnostics(workerDiagnostics: WorkerDiagnostic[]): Diagnostic[] {
    return workerDiagnostics.map(d => ({
      from: d.from,
      to: d.to,
      severity: d.severity,
      message: d.message,
      actions: d.actions?.map(a => ({
        name: a.name,
        apply(view: EditorView, from: number, to: number) {
          view.dispatch({ changes: { from, to, insert: a.replacement } });
        }
      }))
    }));
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

  async lint(
    content: string,
    dialect?: string,
    viewportStart?: number,
    viewportEnd?: number
  ): Promise<Diagnostic[]> {
    // DX: Return cached result if content and dialect unchanged
    if (content === this.lastContent && dialect === this.lastDialect) {
      return this.lastResult;
    }

    await this.initialize();

    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const id = ++this.requestId;

    // DX: Cancel stale requests - only process the latest
    this.cancelStaleRequests(id);

    return new Promise((resolve, reject) => {
      // Timeout after 5 seconds (reduced from 10s for better UX)
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          resolve([]); // Return empty instead of rejecting for better UX
        }
      }, 5000);

      this.pendingRequests.set(id, {
        resolve: (diagnostics) => {
          // DX: Cache the result
          this.lastContent = content;
          this.lastDialect = dialect ?? null;
          this.lastResult = diagnostics;
          resolve(diagnostics);
        },
        reject,
        timeout,
      });

      const request: LinterWorkerRequest = {
        id,
        type: 'lint',
        payload: {
          content,
          dialect,
          viewportStart,
          viewportEnd
        }
      };

      this.worker!.postMessage(request);
    });
  }

  terminate(): void {
    if (this.worker) {
      // Clear all pending requests
      for (const [, handlers] of this.pendingRequests) {
        clearTimeout(handlers.timeout);
        handlers.resolve([]); // Resolve with empty for clean shutdown
      }
      this.pendingRequests.clear();

      this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      this.initPromise = null;

      // Clear cache
      this.lastContent = null;
      this.lastDialect = null;
      this.lastResult = [];
    }
  }
}

// Singleton instance with reference counting
let workerManager: LinterWorkerManager | null = null;
let refCount = 0;

const getWorkerManager = (): LinterWorkerManager => {
  if (!workerManager) {
    workerManager = new LinterWorkerManager();
  }
  return workerManager;
};

/**
 * Increment reference count when a new editor uses the worker.
 */
export const acquireLinterWorker = (): void => {
  refCount++;
};

/**
 * Release a reference to the linter worker.
 * Call this when unmounting a non-PostgreSQL SQL editor.
 */
export const releaseLinterWorker = (): void => {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && workerManager) {
    workerManager.terminate();
    workerManager = null;
  }
};

/**
 * Create a high-performance SQL linter that runs in a Web Worker.
 * This prevents UI blocking for large files.
 */
export const createWorkerLinter = (dialect?: string): Extension => {
  const manager = getWorkerManager();

  return linter(
    async (view) => {
      const content = view.state.doc.toString();
      // Skip very short content
      if (content.length < 10) return [];

      // Get viewport range for potential optimization
      const viewport = view.viewport;

      try {
        return await manager.lint(
          content,
          dialect,
          viewport.from,
          viewport.to
        );
      } catch {
        return [];
      }
    },
    {
      delay: 400, // Balanced delay
      needsRefresh: (update) => update.docChanged || update.viewportChanged
    }
  );
};

/**
 * Pre-initialize the worker to avoid delay on first lint.
 */
export const preInitLinterWorker = (): void => {
  getWorkerManager().initialize().catch(() => {
    // Silently ignore - will retry on first use
  });
};

/**
 * Terminate the linter worker immediately.
 * Only call this when you know no editors are using it, or at app shutdown.
 */
export const terminateLinterWorker = (): void => {
  if (workerManager) {
    workerManager.terminate();
    workerManager = null;
    refCount = 0;
  }
};
