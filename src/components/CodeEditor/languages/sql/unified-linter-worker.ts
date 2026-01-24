export interface LintRequest {
  id: number;
  sql: string;
  dialect: string;
  connectionId?: string;
  checks: ('syntax' | 'semantic' | 'version')[];
}

export interface LintDiagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: 'syntax' | 'semantic' | 'version' | 'validation';
}

export interface LintResponse {
  id: number;
  diagnostics: LintDiagnostic[];
}

self.onmessage = async (event: MessageEvent<LintRequest>) => {
  const { id, sql, dialect: _dialect, checks } = event.data;
  const diagnostics: LintDiagnostic[] = [];

  try {
    if (checks.includes('syntax')) {
      diagnostics.push(...runSyntaxCheck(sql));
    }
  } catch (error) {
    console.error('[unified-linter-worker] Error:', error);
  }

  const response: LintResponse = { id, diagnostics };
  self.postMessage(response);
};

function runSyntaxCheck(sql: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  let inString = false;
  let stringStart = 0;

  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'" && sql[i - 1] !== '\\') {
      if (!inString) {
        inString = true;
        stringStart = i;
      } else {
        inString = false;
      }
    }
  }

  if (inString) {
    diagnostics.push({
      from: stringStart,
      to: sql.length,
      severity: 'error',
      message: 'Unclosed string literal',
      source: 'syntax',
    });
  }

  return diagnostics;
}
