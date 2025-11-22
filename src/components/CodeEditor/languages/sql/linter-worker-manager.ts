/**
 * Worker Manager for SQL Linting
 *
 * Manages communication with the linter Web Worker and provides
 * a CodeMirror-compatible linter interface.
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
  }>();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

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

        this.worker.onerror = (error) => {
          console.error('[LinterWorker] Worker error:', error);
          // Reject all pending requests
          for (const [id, handlers] of this.pendingRequests) {
            handlers.reject(new Error('Worker error'));
            this.pendingRequests.delete(id);
          }
        };

        this.isInitialized = true;
        resolve();
      } catch (error) {
        console.error('[LinterWorker] Failed to initialize:', error);
        reject(error);
      }
    });

    return this.initPromise;
  }

  private handleResponse(response: LinterWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

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

  async lint(
    content: string,
    dialect?: string,
    viewportStart?: number,
    viewportEnd?: number
  ): Promise<Diagnostic[]> {
    await this.initialize();

    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

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

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Lint request timed out'));
        }
      }, 10000);
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      this.initPromise = null;

      // Reject all pending requests
      for (const [, handlers] of this.pendingRequests) {
        handlers.reject(new Error('Worker terminated'));
      }
      this.pendingRequests.clear();
    }
  }
}

// Singleton instance
let workerManager: LinterWorkerManager | null = null;

const getWorkerManager = (): LinterWorkerManager => {
  if (!workerManager) {
    workerManager = new LinterWorkerManager();
  }
  return workerManager;
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

      // Get viewport range for potential optimization
      const viewport = view.viewport;

      try {
        return await manager.lint(
          content,
          dialect,
          viewport.from,
          viewport.to
        );
      } catch (error) {
        console.error('[WorkerLinter] Error:', error);
        return [];
      }
    },
    {
      delay: 250,
      needsRefresh: (update) => update.docChanged || update.viewportChanged
    }
  );
};

/**
 * Terminate the linter worker.
 * Call this when the editor is unmounted.
 */
export const terminateLinterWorker = (): void => {
  if (workerManager) {
    workerManager.terminate();
    workerManager = null;
  }
};
