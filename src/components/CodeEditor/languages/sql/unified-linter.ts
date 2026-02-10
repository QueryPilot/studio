import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SqlDialect } from "../../types";
import { linterCoordinator } from "../../services/linter-coordinator";
import { buildSqlQuickFixes } from "./quick-fixes";

interface UnifiedLinterConfig {
  dialect: SqlDialect;
  connectionId?: string;
  schema?: string;
  delay?: number;
}

function mapSeverity(severity: string): "error" | "warning" | "info" {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
    case "hint":
    default:
      return "info";
  }
}

export function createUnifiedLinter(config: UnifiedLinterConfig): Extension {
  let lastSql = "";
  let lastDiagnostics: Diagnostic[] = [];
  let cancelPending: (() => void) | null = null;

  return linter(
    (view: EditorView): Promise<Diagnostic[]> => {
      const sql = view.state.doc.toString();
      if (!sql.trim()) return Promise.resolve([]);
      if (sql === lastSql) return Promise.resolve(lastDiagnostics);
      // Skip IPC validation for unfocused editors — return stale diagnostics
      if (!view.hasFocus) return Promise.resolve(lastDiagnostics);

      // Cancel any pending request from this editor and settle its promise
      cancelPending?.();

      return new Promise((resolve) => {
        const coordinatorCancel = linterCoordinator.requestLint(
          {
            sql,
            dialect: config.dialect,
            connectionId: config.connectionId,
            schema: config.schema,
          },
          (result) => {
            const mappedDiagnostics = result.diagnostics.map((d) => {
              const from = Math.max(0, Math.min(sql.length, d.from));
              const rawTo = Math.max(0, Math.min(sql.length, d.to));
              const to = rawTo > from ? rawTo : Math.min(sql.length, from + 1);

              const diagnostic: Diagnostic = {
                from,
                to,
                severity: mapSeverity(d.severity),
                message: d.message,
                source: `sql-${d.source}`,
              };

              const actions = buildSqlQuickFixes(diagnostic);
              return actions.length > 0
                ? {
                    ...diagnostic,
                    actions,
                  }
                : diagnostic;
            });

            lastSql = sql;
            lastDiagnostics = mappedDiagnostics;
            resolve(mappedDiagnostics);
          },
        );
        // Wrap cancel to also settle the promise (prevents dangling promises)
        cancelPending = () => {
          coordinatorCancel();
          resolve(lastDiagnostics);
        };
      });
    },
    {
      delay: config.delay ?? 1200, // Longer debounce reduces typing stalls.
      needsRefresh: () => false, // Don't auto-refresh on viewport changes
      // Dismiss lint hover popup when cursor/selection moves (click, arrows, etc.).
      // This keeps popup lifecycle predictable while typing and navigating.
      hideOn: (tr) => {
        if (tr.selection) return true;
        if (tr.docChanged) return true;
        if (tr.isUserEvent("select.pointer")) return true;
        if (tr.isUserEvent("select")) return true;
        return null;
      },
    },
  );
}
