import { forEachDiagnostic, forceLinting } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PendingLintRequest = {
  canceled: boolean;
  callback: (result: {
    diagnostics: Array<{
      from: number;
      to: number;
      message: string;
      severity: string;
      source: string;
    }>;
    status: "ready" | "stale_schema" | "unavailable";
  }) => void;
  request: {
    sql: string;
    dialect: string;
    connectionId?: string;
    schema?: string;
    includeHeuristics?: boolean;
  };
};

const pendingRequests = vi.hoisted<PendingLintRequest[]>(() => []);
const requestLintMock = vi.hoisted(() =>
  vi.fn(
    (
      request: PendingLintRequest["request"],
      callback: PendingLintRequest["callback"],
    ) => {
      const entry: PendingLintRequest = {
        request,
        callback,
        canceled: false,
      };
      pendingRequests.push(entry);
      return () => {
        entry.canceled = true;
      };
    },
  ),
);

vi.mock("../../services/linter-coordinator", () => ({
  linterCoordinator: {
    requestLint: (...args: Parameters<typeof requestLintMock>) =>
      requestLintMock(...args),
  },
}));

import {
  createFastSqlLinter,
  createSemanticSqlLinter,
} from "./unified-linter";

function readDiagnostics(view: EditorView): string[] {
  const messages: string[] = [];
  forEachDiagnostic(view.state, (diagnostic) => {
    messages.push(diagnostic.message);
  });
  return messages;
}

function createSqlView(sql: string): { mount: HTMLDivElement; view: EditorView } {
  const mount = document.createElement("div");
  document.body.appendChild(mount);

  const state = EditorState.create({
    doc: sql,
    extensions: [
      createFastSqlLinter({ dialect: "postgresql" }),
      createSemanticSqlLinter({ dialect: "postgresql", delay: 0 }),
    ],
  });
  const view = new EditorView({ state, parent: mount });
  vi.spyOn(view, "hasFocus", "get").mockReturnValue(true);

  return { mount, view };
}

function deliverLintResult(index: number, result: Parameters<PendingLintRequest["callback"]>[0]) {
  const entry = pendingRequests[index];
  if (!entry || entry.canceled) {
    return;
  }
  entry.callback(result);
}

describe("unified SQL linter", () => {
  beforeEach(() => {
    pendingRequests.length = 0;
    requestLintMock.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("runs fast diagnostics first and canonicalizes SQL for the semantic pass", async () => {
    const sql = "EXPLAIN ANALYSE SELECT *foo FROM missing_table";
    const { mount, view } = createSqlView(sql);

    forceLinting(view);

    await vi.waitFor(() => {
      expect(readDiagnostics(view)).toContain(
        "Invalid use of '*'. Did you mean to separate this from the identifier?",
      );
    });

    expect(requestLintMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "EXPLAIN ANALYZE SELECT *foo FROM missing_table",
        dialect: "postgresql",
        includeHeuristics: false,
      }),
      expect.any(Function),
    );

    const semanticSql = pendingRequests[0]?.request.sql ?? "";
    const missingTableFrom = semanticSql.indexOf("missing_table");
    deliverLintResult(0, {
      diagnostics: [
        {
          from: missingTableFrom,
          to: missingTableFrom + "missing_table".length,
          message: "Table 'missing_table' does not exist",
          severity: "error",
          source: "semantic",
        },
      ],
      status: "ready",
    });

    await vi.waitFor(() => {
      expect(readDiagnostics(view)).toEqual(
        expect.arrayContaining([
          "Invalid use of '*'. Did you mean to separate this from the identifier?",
          "Table 'missing_table' does not exist",
        ]),
      );
    });

    view.destroy();
    mount.remove();
  });

  it("cancels stale semantic results without clearing fast-pass diagnostics", async () => {
    const firstSql = "UPDATE missing_table SET somewhere = 1";
    const secondSql = "UPDATE users SET somewhere = 1";
    const { mount, view } = createSqlView(firstSql);

    forceLinting(view);

    await vi.waitFor(() => {
      expect(readDiagnostics(view)).toContain(
        "UPDATE without WHERE clause will affect all rows",
      );
    });

    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: secondSql,
      },
    });
    forceLinting(view);

    const staleSql = pendingRequests[0]?.request.sql ?? "";
    const staleFrom = staleSql.indexOf("missing_table");
    deliverLintResult(0, {
      diagnostics: [
        {
          from: staleFrom,
          to: staleFrom + "missing_table".length,
          message: "Table 'missing_table' does not exist",
          severity: "error",
          source: "semantic",
        },
      ],
      status: "ready",
    });

    await vi.waitFor(() => {
      const diagnostics = readDiagnostics(view);
      expect(diagnostics).toContain(
        "UPDATE without WHERE clause will affect all rows",
      );
      expect(diagnostics).not.toContain("Table 'missing_table' does not exist");
    });

    deliverLintResult(1, {
      diagnostics: [],
      status: "ready",
    });

    await vi.waitFor(() => {
      expect(readDiagnostics(view)).toEqual([
        "UPDATE without WHERE clause will affect all rows",
      ]);
    });

    view.destroy();
    mount.remove();
  });
});
