import { describe, expect, it } from "vitest";
import { GridCellKind } from "@glideapps/glide-data-grid";
import type { GridColumnV2, GridEditCommitEvent, GridRowModel } from "../../types";
import { createCrudTarget, createDeleteCommand, createUpdateCommand } from "../crudHelpers";
import type { CellValue } from "@/types";

function makeCell(value: unknown): CellValue {
  return {
    value,
    value_type: "Text",
    db_type: "text",
    is_truncated: false,
  };
}

function makeColumns(): GridColumnV2[] {
  return [
    {
      id: "email",
      field: "col_0",
      name: "email",
      title: "email",
      type: "text",
      meta: {
        name: "email",
        db_type: "text",
        nullable: false,
        default: null,
        is_pk: false,
        is_fk: false,
        ordinal: 0,
      },
    },
  ];
}

describe("crudHelpers row identity options", () => {
  it("creates update command with provided identity columns when no PK metadata exists", () => {
    const columns = makeColumns();
    const row: GridRowModel = {
      col_0: makeCell("alice@example.com"),
    };

    const event: GridEditCommitEvent = {
      cell: [0, 0],
      columnIndex: 0,
      rowIndex: 0,
      column: columns[0]!,
      row,
      newValue: {
        kind: GridCellKind.Text,
        data: "alice+1@example.com",
        displayData: "alice+1@example.com",
        allowOverlay: true,
      },
      previousValue: makeCell("alice@example.com"),
    };

    const target = createCrudTarget("conn", "db", "public", "users");

    const command = createUpdateCommand(event, target, columns, {
      identityColumns: ["email"],
      matcherMode: "deterministic",
    });

    expect(command.payload.primaryKeys).toEqual({ email: "alice@example.com" });
    expect(command.metadata.tags).toContain("matcher:deterministic");
  });

  it("creates delete command with provided identity columns", () => {
    const columns = makeColumns();
    const row: GridRowModel = {
      col_0: makeCell("alice@example.com"),
    };
    const target = createCrudTarget("conn", "db", "public", "users");

    const command = createDeleteCommand(row, target, columns, {
      identityColumns: ["email"],
      matcherMode: "deterministic",
    });

    expect(command.payload.primaryKeys).toEqual({ email: "alice@example.com" });
    expect(command.metadata.tags).toContain("matcher:deterministic");
  });
});
