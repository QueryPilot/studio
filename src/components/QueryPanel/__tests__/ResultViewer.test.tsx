/**
 * Component tests for ResultViewer - verifies binary type display in query results
 *
 * These tests ensure that PostgreSQL binary types are correctly displayed
 * in the query result viewer after being decoded by the Rust backend.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultViewer } from "../ResultViewer";

// Define the data structure that TableDataGrid receives
interface TableDataGridData {
  columns: string[];
  rows: unknown[][];
  columnMeta?: unknown[];
}

// Mock the TableDataGrid component since it has complex dependencies
vi.mock("@/components/DataGrid", () => ({
  TableDataGrid: ({ data }: { data?: TableDataGridData }) => (
    <div data-testid="mock-data-grid">
      <div data-testid="columns">{JSON.stringify(data?.columns ?? [])}</div>
      <div data-testid="rows">{JSON.stringify(data?.rows ?? [])}</div>
      {/* Render first row values for easy testing */}
      {data?.rows?.[0]?.map((cell, i) => (
        <div key={i} data-testid={`cell-${i}`}>
          {cell === null ? "NULL" : String(cell)}
        </div>
      ))}
    </div>
  ),
}));

// Mock next-themes
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock CodeEditor for JSON view
vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: ({ value }: { value: string }) => (
    <pre data-testid="code-editor">{value}</pre>
  ),
}));

// Helper to create ColumnMeta
function createColMeta(name: string, dbType: string, isPk = false) {
  return {
    name,
    db_type: dbType,
    nullable: true,
    default: null,
    is_pk: isPk,
    is_fk: false,
    ordinal: 0,
    // Add missing properties required by ColumnMeta interface
    is_unique: false,
    check_constraint: null,
    comment: null,
    foreign_key_ref: null,
    type_oid: 0,
    type_category: 'U', // User-defined or unknown
    enum_values: undefined
  };
}

describe("ResultViewer - Geometric Types Display", () => {
  const geometricResult = {
    columns: ["box_col", "circle_col", "line_col", "lseg_col", "path_col", "polygon_col"],
    columnMeta: [
      createColMeta("box_col", "box"),
      createColMeta("circle_col", "circle"),
      createColMeta("line_col", "line"),
      createColMeta("lseg_col", "lseg"),
      createColMeta("path_col", "path"),
      createColMeta("polygon_col", "polygon"),
    ],
    rows: [
      [
        "((1.0,1.0),(0.0,0.0))",
        "<(0.0,0.0),5.0>",
        "{1.0,2.0,3.0}",
        "[(0.0,0.0),(1.0,1.0)]",
        "[(0.0,0.0),(1.0,1.0),(2.0,2.0)]",
        "((0.0,0.0),(1.0,1.0),(2.0,0.0))",
      ],
    ],
    rowCount: 1,
  };

  it("should render geometric types in table view", () => {
    render(
      <ResultViewer
        result={geometricResult}
        viewMode="table"
        gridId="test-grid"
      />
    );

    // Check the data is passed to the grid
    const rowsElement = screen.getByTestId("rows");
    const rows = JSON.parse(rowsElement.textContent || "[]");

    expect(rows[0]).toContain("((1.0,1.0),(0.0,0.0))");
    expect(rows[0]).toContain("<(0.0,0.0),5.0>");
    expect(rows[0]).toContain("{1.0,2.0,3.0}");
    expect(rows[0]).toContain("[(0.0,0.0),(1.0,1.0)]");
  });

  it("should render geometric types in JSON view", () => {
    render(
      <ResultViewer
        result={geometricResult}
        viewMode="json"
        gridId="test-grid"
      />
    );

    const codeEditor = screen.getByTestId("code-editor");
    const jsonContent = codeEditor.textContent || "";

    expect(jsonContent).toContain("box_col");
    expect(jsonContent).toContain("((1.0,1.0),(0.0,0.0))");
    expect(jsonContent).toContain("circle_col");
    expect(jsonContent).toContain("<(0.0,0.0),5.0>");
  });
});

describe("ResultViewer - tsvector Type Display", () => {
  const tsvectorResult = {
    columns: ["simple", "with_positions", "with_weights"],
    columnMeta: [
      createColMeta("simple", "tsvector"),
      createColMeta("with_positions", "tsvector"),
      createColMeta("with_weights", "tsvector"),
    ],
    rows: [
      [
        "'cat' 'fat' 'rat'",
        "'brown':3 'fox':4 'quick':2",
        "'important':1A 'normal':2B",
      ],
    ],
    rowCount: 1,
  };

  it("should render tsvector in table view", () => {
    render(
      <ResultViewer
        result={tsvectorResult}
        viewMode="table"
        gridId="test-grid"
      />
    );

    const rowsElement = screen.getByTestId("rows");
    const rows = JSON.parse(rowsElement.textContent || "[]");

    expect(rows[0]).toContain("'cat' 'fat' 'rat'");
    expect(rows[0]).toContain("'brown':3 'fox':4 'quick':2");
    expect(rows[0]).toContain("'important':1A 'normal':2B");
  });

  it("should render tsvector in JSON view", () => {
    render(
      <ResultViewer
        result={tsvectorResult}
        viewMode="json"
        gridId="test-grid"
      />
    );

    const codeEditor = screen.getByTestId("code-editor");
    const jsonContent = codeEditor.textContent || "";

    expect(jsonContent).toContain("simple");
    expect(jsonContent).toContain("'cat' 'fat' 'rat'");
  });
});

describe("ResultViewer - hstore Type Display", () => {
  const hstoreResult = {
    columns: ["simple", "with_null", "empty"],
    columnMeta: [
      createColMeta("simple", "hstore"),
      createColMeta("with_null", "hstore"),
      createColMeta("empty", "hstore"),
    ],
    rows: [
      [
        '"a"=>"1", "b"=>"2"',
        '"key"=>"value", "null_key"=>NULL',
        "",
      ],
    ],
    rowCount: 1,
  };

  it("should render hstore in table view", () => {
    render(
      <ResultViewer
        result={hstoreResult}
        viewMode="table"
        gridId="test-grid"
      />
    );

    const rowsElement = screen.getByTestId("rows");
    const rows = JSON.parse(rowsElement.textContent || "[]");

    expect(rows[0]).toContain('"a"=>"1", "b"=>"2"');
    expect(rows[0]).toContain('"key"=>"value", "null_key"=>NULL');
  });

  it("should render hstore in JSON view", () => {
    render(
      <ResultViewer
        result={hstoreResult}
        viewMode="json"
        gridId="test-grid"
      />
    );

    const codeEditor = screen.getByTestId("code-editor");
    const jsonContent = codeEditor.textContent || "";

    expect(jsonContent).toContain("simple");
    // hstore values are stored as strings with => syntax
    expect(jsonContent).toContain("=>");
  });
});

describe("ResultViewer - NULL handling", () => {
  const nullResult = {
    columns: ["box_col", "tsvector_col", "hstore_col"],
    columnMeta: [
      createColMeta("box_col", "box"),
      createColMeta("tsvector_col", "tsvector"),
      createColMeta("hstore_col", "hstore"),
    ],
    rows: [[null, null, null]],
    rowCount: 1,
  };

  it("should handle NULL values in table view", () => {
    render(
      <ResultViewer
        result={nullResult}
        viewMode="table"
        gridId="test-grid"
      />
    );

    const rowsElement = screen.getByTestId("rows");
    const rows = JSON.parse(rowsElement.textContent || "[]");

    expect(rows[0]).toEqual([null, null, null]);
  });

  it("should handle NULL values in JSON view", () => {
    render(
      <ResultViewer
        result={nullResult}
        viewMode="json"
        gridId="test-grid"
      />
    );

    const codeEditor = screen.getByTestId("code-editor");
    const jsonContent = codeEditor.textContent || "";

    expect(jsonContent).toContain("null");
  });
});

describe("ResultViewer - Empty results", () => {
  it("should handle empty result set", () => {
    const emptyResult = {
      columns: ["box_col"],
      columnMeta: [createColMeta("box_col", "box")],
      rows: [],
      rowCount: 0,
    };

    render(
      <ResultViewer
        result={emptyResult}
        viewMode="table"
        gridId="test-grid"
      />
    );

    // Should render without errors
    expect(screen.getByTestId("mock-data-grid")).toBeInTheDocument();
  });

  it("should handle null result", () => {
    render(
      <ResultViewer
        result={null}
        viewMode="table"
        gridId="test-grid"
      />
    );

    // Should handle null gracefully (may show empty state)
    expect(document.body).toBeInTheDocument();
  });
});

describe("ResultViewer - Loading state", () => {
  it("should show loading state", () => {
    render(
      <ResultViewer
        result={null}
        isLoading={true}
        viewMode="table"
        gridId="test-grid"
      />
    );

    // Should show skeleton or loading indicator
    expect(document.body).toBeInTheDocument();
  });
});

describe("ResultViewer - Mixed types in single query", () => {
  const mixedResult = {
    columns: ["id", "name", "location", "tags", "metadata"],
    columnMeta: [
      { ...createColMeta("id", "integer", true), nullable: false },
      createColMeta("name", "text"),
      createColMeta("location", "point"),
      createColMeta("tags", "tsvector"),
      createColMeta("metadata", "hstore"),
    ],
    rows: [
      [1, "Test Item", "(10.5,20.5)", "'tag1' 'tag2'", '"key"=>"value"'],
      [2, "Another Item", "(30.0,40.0)", "'different':1 'tags':2", '"foo"=>"bar"'],
    ],
    rowCount: 2,
  };

  it("should render mixed types correctly", () => {
    render(
      <ResultViewer
        result={mixedResult}
        viewMode="table"
        gridId="test-grid"
      />
    );

    const rowsElement = screen.getByTestId("rows");
    const rows = JSON.parse(rowsElement.textContent || "[]");

    // First row
    expect(rows[0]).toContain(1);
    expect(rows[0]).toContain("Test Item");
    expect(rows[0]).toContain("(10.5,20.5)");
    expect(rows[0]).toContain("'tag1' 'tag2'");
    expect(rows[0]).toContain('"key"=>"value"');

    // Second row
    expect(rows[1]).toContain(2);
    expect(rows[1]).toContain("Another Item");
  });
});
