import { describe, expect, it } from "vitest";
import { GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";
import { buildKeyValueCell, getColumnsForRedisType } from "../keyvalueCellFactory";
import type { GridCellValue } from "@/types";

function createCellValue(value: unknown, dbType = "text"): GridCellValue {
  return {
    value,
    db_type: dbType,
    value_type: typeof value === "number" ? "Integer" : "Text",
    is_truncated: false,
  };
}

describe("keyvalueCellFactory list value rendering", () => {
  const valueColumn = getColumnsForRedisType("list").find(
    (column) => column.field === "value",
  );

  if (!valueColumn) {
    throw new Error("Missing Redis list value column definition");
  }

  it("uses json-cell for list values that are valid JSON strings", () => {
    const cell = buildKeyValueCell({
      value: createCellValue('{"product_id":7,"sku":"BOSE-QC45"}'),
      column: valueColumn,
      keyType: "list",
    });

    expect(cell.kind).toBe(GridCellKind.Custom);
    if (cell.kind !== GridCellKind.Custom) {
      throw new Error("Expected a custom cell");
    }
    const customCell = cell as CustomCell<{ kind: string }>;
    expect(customCell.data.kind).toBe("json-cell");
    expect(customCell.readonly).toBe(false);
    expect(customCell.allowOverlay).toBe(true);
  });

  it("keeps list values as text cells when content is not valid JSON", () => {
    const cell = buildKeyValueCell({
      value: createCellValue("plain-text-value"),
      column: valueColumn,
      keyType: "list",
    });

    expect(cell.kind).toBe(GridCellKind.Custom);
    if (cell.kind !== GridCellKind.Custom) {
      throw new Error("Expected a custom cell");
    }
    const customCell = cell as CustomCell<{ kind: string }>;
    expect(customCell.data.kind).toBe("text-single-cell");
  });
});
