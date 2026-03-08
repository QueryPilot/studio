import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MongoResultViewer } from "../MongoResultViewer";
import { normalizeMongoResult } from "../mongo-result-state";

vi.mock("@/components/DataGrid", () => ({
  DocumentDataGrid: (props: unknown) => (
    <pre data-testid="document-data-grid">{JSON.stringify(props)}</pre>
  ),
}));

vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: ({ value }: { value: string }) => (
    <pre data-testid="code-editor">{value}</pre>
  ),
}));

describe("MongoResultViewer", () => {
  it("renders DocumentDataGrid in result mode for document results", () => {
    const result = normalizeMongoResult({
      operation: "find",
      collection: "users",
      result: [{ _id: "1", name: "Ada" }],
    });

    render(
      <MongoResultViewer
        result={result}
        viewMode="data"
        connectionId="conn-1"
        database="app"
        gridId="mongo-results-grid"
        executionTime={12.34}
        onClearResults={vi.fn()}
      />,
    );

    const grid = screen.getByTestId("document-data-grid");
    const props = JSON.parse(grid.textContent);

    expect(props.mode).toBe("result");
    expect(props.gridId).toBe("mongo-results-grid");
    expect(props.connectionId).toBe("conn-1");
    expect(props.database).toBe("app");
    expect(props.collection).toBe("users");
    expect(props.documents).toEqual([{ _id: "1", name: "Ada" }]);
    expect(screen.getByText("12.34ms")).toBeInTheDocument();
  });

  it("renders JSON view when JSON mode is selected", () => {
    const result = normalizeMongoResult({
      operation: "count",
      collection: "users",
      result: 42,
    });

    render(
      <MongoResultViewer
        result={result}
        viewMode="json"
        connectionId="conn-1"
        database="app"
        gridId="mongo-results-grid"
        executionTime={null}
        onClearResults={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("document-data-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("code-editor")).toHaveTextContent("42");
  });

  it("falls back to JSON output when data view is unavailable", () => {
    const result = normalizeMongoResult({
      operation: "count",
      collection: "users",
      result: 42,
    });

    render(
      <MongoResultViewer
        result={result}
        viewMode="data"
        connectionId="conn-1"
        database="app"
        gridId="mongo-results-grid"
        executionTime={null}
        onClearResults={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Data view is unavailable for this result."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("code-editor")).toHaveTextContent("42");
  });
});
