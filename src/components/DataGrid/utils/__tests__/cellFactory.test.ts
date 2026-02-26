/**
 * Unit tests for cellFactory - verifies binary type display values
 *
 * These tests ensure that PostgreSQL binary types (geometric, tsvector, hstore)
 * are correctly rendered in the data grid after being decoded by the Rust backend.
 */

import { describe, it, expect } from "vitest";
import { buildGridCellV2 } from "../cellFactory";
import type { GridColumnV2 } from "../../types";
import { GridCellKind } from "@glideapps/glide-data-grid";

// Helper to create a column with specific db_type
function createColumn(id: string, dbType: string): GridColumnV2 {
  return {
    id,
    field: id,
    title: id,
    name: id,
    width: 100,
    meta: {
      name: id,
      db_type: dbType,
      nullable: true,
      default: null,
      is_pk: false,
      is_fk: false,
      ordinal: 0,
    },
  };
}

// Helper to create a cell value (CellValue/GridCellValue)
function createValue(value: unknown) {
  return {
    value,
    db_type: "text",
    value_type: "Text" as const,
    is_truncated: false,
  };
}

describe("cellFactory - PostgreSQL Geometric Types", () => {
  it("should render box type as text", () => {
    const column = createColumn("box_col", "box");
    const value = createValue("((1.0,1.0),(0.0,0.0))");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("((1.0,1.0),(0.0,0.0))");
  });

  it("should render circle type as text", () => {
    const column = createColumn("circle_col", "circle");
    const value = createValue("<(0.0,0.0),5.0>");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("<(0.0,0.0),5.0>");
  });

  it("should render line type as text", () => {
    const column = createColumn("line_col", "line");
    const value = createValue("{1.0,2.0,3.0}");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("{1.0,2.0,3.0}");
  });

  it("should render lseg type as text", () => {
    const column = createColumn("lseg_col", "lseg");
    const value = createValue("[(0.0,0.0),(1.0,1.0)]");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("[(0.0,0.0),(1.0,1.0)]");
  });

  it("should render path (open) type as text", () => {
    const column = createColumn("path_col", "path");
    const value = createValue("[(0.0,0.0),(1.0,1.0),(2.0,2.0)]");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("[(0.0,0.0),(1.0,1.0),(2.0,2.0)]");
  });

  it("should render path (closed) type as text", () => {
    const column = createColumn("path_col", "path");
    const value = createValue("((0.0,0.0),(1.0,1.0),(2.0,2.0))");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("((0.0,0.0),(1.0,1.0),(2.0,2.0))");
  });

  it("should render polygon type as text", () => {
    const column = createColumn("polygon_col", "polygon");
    const value = createValue("((0.0,0.0),(1.0,1.0),(2.0,0.0))");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("((0.0,0.0),(1.0,1.0),(2.0,0.0))");
  });

  it("should render point type as text", () => {
    const column = createColumn("point_col", "point");
    const value = createValue("(1.5,2.5)");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("(1.5,2.5)");
  });
});

describe("cellFactory - PostgreSQL tsvector Type", () => {
  it("should render tsvector without positions as text", () => {
    const column = createColumn("tsvector_col", "tsvector");
    const value = createValue("'cat' 'fat' 'rat'");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("'cat' 'fat' 'rat'");
  });

  it("should render tsvector with positions as text", () => {
    const column = createColumn("tsvector_col", "tsvector");
    const value = createValue("'brown':3 'fox':4 'quick':2");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("'brown':3 'fox':4 'quick':2");
  });

  it("should render tsvector with weights as text", () => {
    const column = createColumn("tsvector_col", "tsvector");
    const value = createValue("'important':1A 'normal':2");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toBe("'important':1A 'normal':2");
  });
});

describe("cellFactory - PostgreSQL hstore Type", () => {
  it("should render hstore as specialized cell", () => {
    const column = createColumn("hstore_col", "hstore");
    const value = createValue('"a"=>"1", "b"=>"2"');

    const cell = buildGridCellV2({ value, column });

    // hstore has its own cell kind (Custom)
    expect(cell.kind).toBe(GridCellKind.Custom);
  });

  it("should handle hstore with NULL values", () => {
    const column = createColumn("hstore_col", "hstore");
    const value = createValue('"a"=>"1", "b"=>NULL');

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
  });

  it("should handle empty hstore", () => {
    const column = createColumn("hstore_col", "hstore");
    const value = createValue("");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
  });
});

describe("cellFactory - NULL handling for binary types", () => {
  it("should handle NULL box", () => {
    const column = createColumn("box_col", "box");
    const value = createValue(null);

    const cell = buildGridCellV2({ value, column });

    // NULL values are rendered as text cells with "NULL" display
    expect(cell.kind).toBe(GridCellKind.Text);
    if (cell.kind === GridCellKind.Text) {
      expect(cell.displayData).toBe("NULL");
    }
  });

  it("should handle NULL circle", () => {
    const column = createColumn("circle_col", "circle");
    const value = createValue(null);

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Text);
    if (cell.kind === GridCellKind.Text) {
      expect(cell.displayData).toBe("NULL");
    }
  });

  it("should handle NULL tsvector", () => {
    const column = createColumn("tsvector_col", "tsvector");
    const value = createValue(null);

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Text);
    if (cell.kind === GridCellKind.Text) {
      expect(cell.displayData).toBe("NULL");
    }
  });

  it("should handle NULL hstore", () => {
    const column = createColumn("hstore_col", "hstore");
    const value = createValue(null);

    const cell = buildGridCellV2({ value, column });

    // NULL hstore is still rendered as custom cell (HStore cell type)
    // The hstore cell handler runs before the null check in the factory
    expect(cell.kind).toBe(GridCellKind.Custom);
  });
});

describe("cellFactory - Edge cases", () => {
  it("should handle large coordinate values in circle", () => {
    const column = createColumn("circle_col", "circle");
    const value = createValue("<(1234567.89,-9876543.21),999.999>");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toContain("1234567");
    expect(cell.copyData).toContain("9876543");
  });

  it("should handle polygon with many points", () => {
    const column = createColumn("polygon_col", "polygon");
    const points = Array.from({ length: 10 }, (_, i) => `(${i}.0,${i * 2}.0)`).join(",");
    const value = createValue(`(${points})`);

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toContain("(0.0,0.0)");
    expect(cell.copyData).toContain("(9.0,18.0)");
  });

  it("should handle tsvector with special characters in lexemes", () => {
    const column = createColumn("tsvector_col", "tsvector");
    const value = createValue("'hello-world':1 'test_value':2");

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
    expect(cell.copyData).toContain("hello-world");
    expect(cell.copyData).toContain("test_value");
  });

  it("should handle hstore with special characters in keys/values", () => {
    const column = createColumn("hstore_col", "hstore");
    const value = createValue('"key with spaces"=>"value with \\"quotes\\""');

    const cell = buildGridCellV2({ value, column });

    expect(cell.kind).toBe(GridCellKind.Custom);
  });
});
