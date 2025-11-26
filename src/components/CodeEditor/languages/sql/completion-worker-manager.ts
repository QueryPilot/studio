/**
 * Manager for SQL Completion Worker
 *
 * Handles communication with the web worker for context analysis.
 */

import { logger } from "@/lib/logger";
import type {
  CompletionWorkerRequest,
  CompletionWorkerResponse,
  ContextAnalysis
} from "./completion-worker";

class CompletionWorkerManager {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (analysis: ContextAnalysis) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private isInitialized = false;

  initialize(): void {
    if (this.isInitialized) return;

    try {
      this.worker = new Worker(
        new URL('./completion-worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event: MessageEvent<CompletionWorkerResponse>) => {
        this.handleResponse(event.data);
      };

      this.worker.onerror = (error) => {
        logger.error('[CompletionWorker] Worker error:', error);
        this.rejectAllPending(new Error('Worker error'));
      };

      this.isInitialized = true;
    } catch (error) {
      logger.error('[CompletionWorker] Failed to initialize:', error);
      throw error;
    }
  }

  private handleResponse(response: CompletionWorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    if (response.type === 'error') {
      pending.reject(new Error(response.payload.error || 'Unknown error'));
    } else if (response.payload.analysis) {
      pending.resolve(response.payload.analysis);
    } else {
      pending.reject(new Error('No analysis result'));
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, handlers] of this.pendingRequests) {
      clearTimeout(handlers.timeout);
      handlers.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  async analyze(
    content: string,
    pos: number,
    dialect?: string,
    defaultSchema: string = 'public'
  ): Promise<ContextAnalysis> {
    if (!this.isInitialized) {
      this.initialize();
    }

    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Analysis request timed out'));
        }
      }, 2000); // 2 second timeout

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const request: CompletionWorkerRequest = {
        id,
        type: 'analyze',
        payload: {
          content,
          pos,
          dialect,
          defaultSchema
        }
      };

      this.worker!.postMessage(request);
    });
  }

  terminate(): void {
    if (this.worker) {
      this.rejectAllPending(new Error('Worker terminated'));
      this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
    }
  }
}

// Singleton instance
let workerManager: CompletionWorkerManager | null = null;

export const getCompletionWorker = (): CompletionWorkerManager => {
  if (!workerManager) {
    workerManager = new CompletionWorkerManager();
  }
  return workerManager;
};

export const terminateCompletionWorker = (): void => {
  if (workerManager) {
    workerManager.terminate();
    workerManager = null;
  }
};
