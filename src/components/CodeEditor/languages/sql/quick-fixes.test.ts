import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { buildSqlQuickFixes } from "./quick-fixes";

function createMockView(initialText: string): EditorView {
  let text = initialText;

  const view = {
    state: {
      doc: {
        toString: () => text,
        sliceString: (from: number, to: number) => text.slice(from, to),
      },
    },
    dispatch: ({
      changes,
    }: {
      changes: { from: number; to: number; insert: string };
    }) => {
      const { from, to, insert } = changes;
      text = `${text.slice(0, from)}${insert}${text.slice(to)}`;
    },
  } as unknown as EditorView;

  return view;
}

function makeDiagnostic(
  message: string,
  from: number,
  to: number,
): Diagnostic {
  return {
    message,
    from,
    to,
    severity: "warning",
    source: "sql-test",
  };
}

describe("SQL quick fixes", () => {
  it("replaces keyword typo at diagnostic range", () => {
    const sql = "selct * from users";
    const view = createMockView(sql);
    const diag = makeDiagnostic("Possible typo: did you mean 'SELECT'?", 0, 6);

    const fixes = buildSqlQuickFixes(diag);
    expect(fixes.length).toBeGreaterThan(0);
    fixes[0]?.apply(view, diag.from, diag.to);

    expect(view.state.doc.toString()).toBe("SELECT * from users");
  });

  it("replaces fuzzy table suggestion inside statement scope", () => {
    const sql = "select * from usres where id = 1";
    const view = createMockView(sql);
    const diag = makeDiagnostic(
      "Table 'usres' not found. Did you mean 'users'?",
      0,
      sql.length,
    );

    const fixes = buildSqlQuickFixes(diag);
    expect(fixes.length).toBeGreaterThan(0);
    fixes[0]?.apply(view, diag.from, diag.to);

    expect(view.state.doc.toString()).toContain("from users where");
  });

  it("inserts missing comparison operator", () => {
    const sql = "select * from users where id 19";
    const view = createMockView(sql);
    const diag = makeDiagnostic(
      "Missing comparison operator between 'id' and '19'. Did you mean 'id = 19'?",
      0,
      sql.length,
    );

    const fixes = buildSqlQuickFixes(diag);
    expect(fixes.length).toBeGreaterThan(0);
    const action = fixes.find((f) => f.name.includes("id = 19"));
    expect(action).toBeDefined();
    action?.apply(view, diag.from, diag.to);

    expect(view.state.doc.toString()).toContain("where id = 19");
  });
});
