import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';
import type { SqlDialect } from '../../types';
import type { LintRequest, LintResponse, LintDiagnostic } from './unified-linter-worker';

interface UnifiedLinterConfig {
  dialect: SqlDialect;
  connectionId?: string;
  schema?: string;
  checks?: ('syntax' | 'semantic' | 'version')[];
  delay?: number;
}

// =============================================================================
// Rust Validation (Tauri environment)
// =============================================================================

interface RustValidateRequest {
  sql: string;
  dialect: string;
  connectionId?: string;
  schema?: string;
}

interface RustValidateResponse {
  valid: boolean;
  errors: Array<{ from: number; to: number; message: string; severity: string; source: string }>;
  warnings: Array<{ from: number; to: number; message: string; severity: string; source: string }>;
}

function isRustLintingAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

async function lintWithRust(
  sql: string,
  dialect: string,
  connectionId?: string,
  schema?: string
): Promise<LintDiagnostic[]> {
  const response = await invoke<RustValidateResponse>('sql_validate', {
    request: { sql, dialect, connectionId, schema } as RustValidateRequest,
  });

  const diagnostics: LintDiagnostic[] = [];

  for (const err of response.errors) {
    diagnostics.push({
      from: err.from,
      to: err.to,
      severity: 'error',
      message: err.message,
      source: err.source as 'syntax' | 'semantic' | 'version',
    });
  }

  for (const warn of response.warnings) {
    diagnostics.push({
      from: warn.from,
      to: warn.to,
      severity: 'warning',
      message: warn.message,
      source: warn.source as 'syntax' | 'semantic' | 'version',
    });
  }

  return diagnostics;
}

// =============================================================================
// Worker-based Validation (fallback for non-Tauri or when Rust fails)
// =============================================================================

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<number, (diagnostics: LintDiagnostic[]) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./unified-linter-worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<LintResponse>) => {
      const { id, diagnostics } = event.data;
      const resolve = pendingRequests.get(id);
      if (resolve) {
        pendingRequests.delete(id);
        resolve(diagnostics);
      }
    };
  }
  return worker;
}

async function lintWithWorker(sql: string, config: UnifiedLinterConfig): Promise<LintDiagnostic[]> {
  return new Promise((resolve) => {
    const id = ++requestId;
    const request: LintRequest = {
      id,
      sql,
      dialect: config.dialect,
      connectionId: config.connectionId,
      checks: config.checks || ['syntax', 'semantic', 'version'],
    };

    pendingRequests.set(id, resolve);
    getWorker().postMessage(request);

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        resolve([]);
      }
    }, 5000);
  });
}

// =============================================================================
// Main Lint Function (tries Rust first, falls back to worker)
// =============================================================================

async function lint(sql: string, config: UnifiedLinterConfig): Promise<LintDiagnostic[]> {
  // Try Rust validation first (faster, uses pre-synced schema)
  if (isRustLintingAvailable()) {
    try {
      return await lintWithRust(sql, config.dialect, config.connectionId, config.schema);
    } catch (error) {
      console.warn('[unified-linter] Rust validation failed, falling back to worker:', error);
    }
  }

  // Fall back to worker-based validation
  return lintWithWorker(sql, config);
}

export function createUnifiedLinter(config: UnifiedLinterConfig): Extension {
  return linter(
    async (view: EditorView): Promise<Diagnostic[]> => {
      const sql = view.state.doc.toString();
      if (!sql.trim()) return [];

      const diagnostics = await lint(sql, config);

      return diagnostics.map((d) => ({
        from: Math.max(0, d.from),
        to: Math.min(sql.length, d.to),
        severity: d.severity,
        message: d.message,
        source: `sql-${d.source}`,
      }));
    },
    { delay: config.delay ?? 500 }
  );
}

export function terminateUnifiedLinter(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pendingRequests.clear();
}
