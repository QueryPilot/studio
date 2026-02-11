import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";

interface LintRequest {
  sql: string;
  dialect: string;
  connectionId?: string;
  schema?: string;
}

interface LintDiagnostic {
  from: number;
  to: number;
  severity: string;
  message: string;
  source: string;
}

interface LintResult {
  diagnostics: LintDiagnostic[];
}

type LintCallback = (result: LintResult) => void;

/**
 * Singleton coordinator that deduplicates and batches lint IPC calls.
 *
 * Key behaviors:
 * 1. Deduplicates: If two editors have identical SQL + dialect + connectionId, only one IPC call
 * 2. Caches: Results cached for 5 seconds by content hash
 * 3. Cancellable: New request for same editor cancels previous pending request
 */
class LinterCoordinator {
  private pendingRequests = new Map<
    string,
    {
      request: LintRequest;
      callbacks: LintCallback[];
    }
  >();
  private rafId: number | null = null;
  private cache = new Map<string, { result: LintResult; timestamp: number }>();
  private CACHE_TTL = 5000;

  requestLint(request: LintRequest, callback: LintCallback): () => void {
    const cacheKey = this.getCacheKey(request);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      queueMicrotask(() => callback(cached.result));
      return () => {};
    }

    // Deduplicate: if another editor already requested the same SQL, add callback
    const existing = this.pendingRequests.get(cacheKey);
    if (existing) {
      existing.callbacks.push(callback);
    } else {
      this.pendingRequests.set(cacheKey, {
        request,
        callbacks: [callback],
      });
    }

    // Schedule flush
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }

    // Return cancel function
    return () => {
      const entry = this.pendingRequests.get(cacheKey);
      if (entry) {
        entry.callbacks = entry.callbacks.filter((cb) => cb !== callback);
        if (entry.callbacks.length === 0) {
          this.pendingRequests.delete(cacheKey);
        }
      }
    };
  }

  private async flush() {
    this.rafId = null;
    const requests = new Map(this.pendingRequests);
    this.pendingRequests.clear();

    // Process all pending requests in parallel — IPC calls are independent
    await Promise.allSettled(
      Array.from(requests.entries()).map(
        async ([cacheKey, { request, callbacks }]) => {
          if (callbacks.length === 0) return;

          try {
            const response = await invoke<{
              valid: boolean;
              errors: Array<{
                from: number;
                to: number;
                message: string;
                severity: string;
                source: string;
              }>;
              warnings: Array<{
                from: number;
                to: number;
                message: string;
                severity: string;
                source: string;
              }>;
            }>("sql_validate", { request });

            const result: LintResult = {
              diagnostics: [...response.errors, ...response.warnings],
            };

            // Cache result
            this.cache.set(cacheKey, { result, timestamp: Date.now() });

            // Evict old cache entries
            if (this.cache.size > 20) {
              const oldest = this.cache.keys().next().value;
              if (oldest) this.cache.delete(oldest);
            }

            // Notify all callbacks
            for (const cb of callbacks) {
              cb(result);
            }
          } catch (error) {
            logger.error("[LinterCoordinator] IPC failed:", error);
            // Resolve all callbacks with empty diagnostics so promises don't hang
            const emptyResult: LintResult = { diagnostics: [] };
            for (const cb of callbacks) {
              cb(emptyResult);
            }
          }
        },
      ),
    );
  }

  private getCacheKey(request: LintRequest): string {
    return `${request.dialect}:${request.connectionId ?? ""}:${request.schema ?? ""}:${request.sql}`;
  }

  clearCache() {
    this.cache.clear();
  }
}

export const linterCoordinator = new LinterCoordinator();
