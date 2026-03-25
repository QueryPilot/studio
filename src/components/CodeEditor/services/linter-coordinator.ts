import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import {
  getRustSchemaSyncStatus,
  syncSchemaToRust,
} from "@/hooks/useRustSchemaSync";
import type { EditorDiagnosticsStatus, SqlDialect } from "../types";

interface LintRequest {
  sql: string;
  dialect: SqlDialect;
  connectionId?: string;
  schema?: string;
  includeHeuristics?: boolean;
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
  status: EditorDiagnosticsStatus;
}

type LintCallback = (result: LintResult) => void;

export function resolveSchemaForLint(
  dialect: SqlDialect,
  schema?: string,
): string | null {
  const trimmedSchema = schema?.trim();
  if (trimmedSchema) {
    return trimmedSchema;
  }

  switch (dialect) {
    case "sqlite":
      return "main";
    case "mssql":
      return "dbo";
    case "oracle":
      return null;
    case "postgresql":
    case "plsql":
      return "public";
    case "mysql":
    default:
      return null;
  }
}

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
    const normalizedRequest = this.normalizeRequest(request);
    const cacheKey = this.getCacheKey(normalizedRequest);

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      queueMicrotask(() => {
        callback(cached.result);
      });
      return () => {};
    }

    const existing = this.pendingRequests.get(cacheKey);
    if (existing) {
      existing.callbacks.push(callback);
    } else {
      this.pendingRequests.set(cacheKey, {
        request: normalizedRequest,
        callbacks: [callback],
      });
    }

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }

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

  private normalizeRequest(request: LintRequest): LintRequest {
    const schema =
      request.schema || request.connectionId
        ? (resolveSchemaForLint(request.dialect, request.schema) ?? undefined)
        : undefined;
    return {
      ...request,
      schema,
    };
  }

  private async flush() {
    this.rafId = null;
    const requests = new Map(this.pendingRequests);
    this.pendingRequests.clear();

    await Promise.allSettled(
      Array.from(requests.entries()).map(
        async ([cacheKey, { request, callbacks }]) => {
          if (callbacks.length === 0) return;

          try {
            let status: EditorDiagnosticsStatus = "ready";

            if (request.connectionId) {
              const schemaName = request.schema ?? null;
              if (schemaName) {
                await syncSchemaToRust(request.connectionId, schemaName);
                status = getRustSchemaSyncStatus(request.connectionId, schemaName);
              } else {
                status = "unavailable";
              }
            }

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
              status,
            };

            this.cache.set(cacheKey, { result, timestamp: Date.now() });

            if (this.cache.size > 20) {
              const oldest = this.cache.keys().next().value;
              if (oldest) this.cache.delete(oldest);
            }

            for (const cb of callbacks) {
              cb(result);
            }
          } catch (error) {
            logger.error("[LinterCoordinator] IPC failed:", error);
            const emptyResult: LintResult = {
              diagnostics: [],
              status: "unavailable",
            };
            for (const cb of callbacks) {
              cb(emptyResult);
            }
          }
        },
      ),
    );
  }

  private getCacheKey(request: LintRequest): string {
    return `${request.dialect}:${request.connectionId ?? ""}:${request.schema ?? ""}:${request.includeHeuristics === false ? "semantic" : "full"}:${request.sql}`;
  }

  clearCache() {
    this.cache.clear();
  }
}

export const linterCoordinator = new LinterCoordinator();
