import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ExplainViewer } from "../ExplainViewer";
import * as parseExplainModule from "../explain/parseExplain";

vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: ({ value }: { value: string }) => (
    <pre data-testid="code-editor">{value}</pre>
  ),
}));

describe("ExplainViewer parser selection", () => {
  it("passes databaseType to parseExplain selector", () => {
    const parseSpy = vi
      .spyOn(parseExplainModule, "parseExplain")
      .mockReturnValue({ nodes: [], totalCost: 0, raw: "" });

    render(
      <ExplainViewer
        result={{
          columns: ["QUERY PLAN"],
          rows: [["Seq Scan on users  (cost=0.00..10.00 rows=100 width=4)"]],
        }}
        databaseType="SQLite"
        viewMode="explain"
      />,
    );

    expect(parseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ databaseType: "SQLite" }),
    );
  });
});
