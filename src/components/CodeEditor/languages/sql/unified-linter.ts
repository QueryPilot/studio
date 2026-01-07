import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SqlDialect } from '../../types';
import type { LintRequest, LintResponse, LintDiagnostic } from './unified-linter-worker';

interface UnifiedLinterConfig {
  dialect: SqlDialect;
  connectionId?: string;
  checks?: ('syntax' | 'semantic' | 'version')[];
  delay?: number;
}

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

async function lint(sql: string, config: UnifiedLinterConfig): Promise<LintDiagnostic[]> {
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
    { delay: config.delay ?? 400 }
  );
}

export function terminateUnifiedLinter(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pendingRequests.clear();
}
