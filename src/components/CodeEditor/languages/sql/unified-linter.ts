import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { EditorDiagnosticsStatus, SqlDialect } from "../../types";
import { linterCoordinator } from "../../services/linter-coordinator";
import {
  mapPreparedOffset,
  prepareSqlForLint,
  type FastLintDiagnostic,
} from "./dialect-lint-adapter";
import { buildSqlQuickFixes } from "./quick-fixes";

interface UnifiedLinterConfig {
  dialect: SqlDialect;
  connectionId?: string;
  schema?: string;
  delay?: number;
  onDiagnosticsStatusChange?: (status: EditorDiagnosticsStatus) => void;
}

const FAST_PASS_DELAY_MS = 90;
const SEMANTIC_PASS_DELAY_MS = 550;

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

function toCodeMirrorDiagnostic(
  diagnostic: {
    from: number;
    to: number;
    severity: string;
    message: string;
    source: string;
  },
  sql: string,
): Diagnostic {
  const from = Math.max(0, Math.min(sql.length, diagnostic.from));
  const rawTo = Math.max(0, Math.min(sql.length, diagnostic.to));
  const to = rawTo > from ? rawTo : Math.min(sql.length, from + 1);

  const mappedDiagnostic: Diagnostic = {
    from,
    to,
    severity: mapSeverity(diagnostic.severity),
    message: diagnostic.message,
    source: `sql-${diagnostic.source}`,
  };

  const actions = buildSqlQuickFixes(mappedDiagnostic);
  return actions.length > 0
    ? {
        ...mappedDiagnostic,
        actions,
      }
    : mappedDiagnostic;
}

function isFastPassOwnedDiagnostic(diagnostic: {
  message: string;
  source: string;
}): boolean {
  return (
    diagnostic.message.startsWith("Possible typo: did you mean") ||
    diagnostic.message.includes("Invalid use of '*'") ||
    diagnostic.message.includes("without WHERE clause will affect all rows") ||
    diagnostic.message === "Consider specifying columns instead of SELECT *"
  );
}

function toFastPassDiagnostics(
  diagnostics: FastLintDiagnostic[],
  sql: string,
): Diagnostic[] {
  return diagnostics.map((diagnostic) => toCodeMirrorDiagnostic(diagnostic, sql));
}

export function createFastSqlLinter(config: UnifiedLinterConfig): Extension {
  let lastSql = "";
  let lastDiagnostics: Diagnostic[] = [];

  return linter(
    (view: EditorView): Diagnostic[] => {
      if (!view.hasFocus) return lastDiagnostics;

      const sql = view.state.doc.toString();
      if (!sql.trim()) {
        lastSql = "";
        lastDiagnostics = [];
        return [];
      }
      if (sql === lastSql) {
        return lastDiagnostics;
      }

      const prepared = prepareSqlForLint(sql, config.dialect);
      const diagnostics = toFastPassDiagnostics(prepared.fastDiagnostics, sql);

      lastSql = sql;
      lastDiagnostics = diagnostics;
      return diagnostics;
    },
    {
      delay: FAST_PASS_DELAY_MS,
      needsRefresh: () => false,
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

export function createSemanticSqlLinter(config: UnifiedLinterConfig): Extension {
  let lastSql = "";
  let lastDiagnostics: Diagnostic[] = [];
  let cancelPending: (() => void) | null = null;

  return linter(
    (view: EditorView): Promise<Diagnostic[]> => {
      if (!view.hasFocus) return Promise.resolve(lastDiagnostics);

      const sql = view.state.doc.toString();
      if (!sql.trim()) {
        lastSql = "";
        lastDiagnostics = [];
        return Promise.resolve([]);
      }
      if (sql === lastSql) return Promise.resolve(lastDiagnostics);

      const prepared = prepareSqlForLint(sql, config.dialect);
      if (!prepared.canRunSemantic) {
        lastSql = sql;
        lastDiagnostics = [];
        config.onDiagnosticsStatusChange?.("idle");
        return Promise.resolve([]);
      }

      config.onDiagnosticsStatusChange?.("validating");

      cancelPending?.();

      return new Promise((resolve) => {
        const coordinatorCancel = linterCoordinator.requestLint(
          {
            sql: prepared.canonicalSql,
            dialect: config.dialect,
            connectionId: config.connectionId,
            schema: config.schema,
            includeHeuristics: false,
          },
          (result) => {
            const mappedDiagnostics = result.diagnostics
              .filter((diagnostic) => !isFastPassOwnedDiagnostic(diagnostic))
              .map((diagnostic) =>
                toCodeMirrorDiagnostic(
                  {
                    ...diagnostic,
                    from: mapPreparedOffset(prepared.offsetMap, diagnostic.from),
                    to: mapPreparedOffset(prepared.offsetMap, diagnostic.to),
                  },
                  sql,
                ),
              );

            lastSql = sql;
            lastDiagnostics = mappedDiagnostics;
            config.onDiagnosticsStatusChange?.(result.status);
            resolve(mappedDiagnostics);
          },
        );

        cancelPending = () => {
          coordinatorCancel();
          config.onDiagnosticsStatusChange?.("idle");
          resolve([]);
        };
      });
    },
    {
      delay: config.delay ?? SEMANTIC_PASS_DELAY_MS,
      needsRefresh: () => false,
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

export const createUnifiedLinter = createSemanticSqlLinter;
