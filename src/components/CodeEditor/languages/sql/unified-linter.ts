import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import type { SqlDialect } from "../../types";
import { buildSqlQuickFixes } from "./quick-fixes";

interface UnifiedLinterConfig {
  dialect: SqlDialect;
  connectionId?: string;
  schema?: string;
  delay?: number;
}

interface RustValidateRequest {
  sql: string;
  dialect: string;
  connectionId?: string;
  schema?: string;
}

interface RustValidateResponse {
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
}

interface LintDiagnostic {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
  source: "syntax" | "semantic" | "version" | "validation";
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

async function lintWithRust(
  sql: string,
  dialect: string,
  connectionId?: string,
  schema?: string,
): Promise<LintDiagnostic[]> {
  const response = await invoke<RustValidateResponse>("sql_validate", {
    request: { sql, dialect, connectionId, schema } as RustValidateRequest,
  });

  const diagnostics: LintDiagnostic[] = [];

  for (const err of response.errors) {
    diagnostics.push({
      from: err.from,
      to: err.to,
      severity: mapSeverity(err.severity),
      message: err.message,
      source: err.source as "syntax" | "semantic" | "version" | "validation",
    });
  }

  for (const warn of response.warnings) {
    diagnostics.push({
      from: warn.from,
      to: warn.to,
      severity: mapSeverity(warn.severity),
      message: warn.message,
      source: warn.source as "syntax" | "semantic" | "version" | "validation",
    });
  }

  return diagnostics;
}

export function createUnifiedLinter(config: UnifiedLinterConfig): Extension {
  let lastSql = "";
  let lastDiagnostics: Diagnostic[] = [];

  return linter(
    async (view: EditorView): Promise<Diagnostic[]> => {
      const sql = view.state.doc.toString();
      if (!sql.trim()) return [];
      if (sql === lastSql) return lastDiagnostics;
      // Skip IPC validation for unfocused editors — return stale diagnostics
      if (!view.hasFocus) return lastDiagnostics;

      try {
        const diagnostics = await lintWithRust(
          sql,
          config.dialect,
          config.connectionId,
          config.schema,
        );

        const mappedDiagnostics = diagnostics.map((d) => {
          const from = Math.max(0, Math.min(sql.length, d.from));
          const rawTo = Math.max(0, Math.min(sql.length, d.to));
          const to = rawTo > from ? rawTo : Math.min(sql.length, from + 1);

          const diagnostic: Diagnostic = {
            from,
            to,
            severity: d.severity,
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
        return mappedDiagnostics;
      } catch (error) {
        console.error("[unified-linter] Rust validation failed:", error);
        return [];
      }
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
