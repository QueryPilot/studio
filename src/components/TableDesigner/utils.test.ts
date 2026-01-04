import { describe, it, expect } from "vitest";
import { getDesignerModifiedFields, type DesignerGridRow } from "./utils";
import type { ColumnDefinitionInput } from "@/types/crud";

describe("getDesignerModifiedFields", () => {
  it("returns empty set when values match baseline", () => {
    const baseline: ColumnDefinitionInput = {
      name: "id",
      dataType: "SERIAL",
      nullable: false,
      defaultValue: undefined,
      comment: "",
      checkExpression: "",
    };

    const row: DesignerGridRow = {
      row_number: 1,
      column_name: "id",
      column_meta: {
        is_pk: true,
        is_fk: false,
      },
      db_type: "SERIAL",
      nullable: "NO",
      default: "",
      foreign_key: "",
      check_constraint: "",
      comment: "",
      _tempId: "0",
    };

    const fields = getDesignerModifiedFields(row, baseline);
    expect(fields.size).toBe(0);
  });

  it("detects changes from baseline values", () => {
    const baseline: ColumnDefinitionInput = {
      name: "id",
      dataType: "SERIAL",
      nullable: false,
      defaultValue: undefined,
      comment: "",
      checkExpression: "",
    };

    const row: DesignerGridRow = {
      row_number: 1,
      column_name: "email",
      column_meta: {
        is_pk: false,
        is_fk: false,
      },
      db_type: "TEXT",
      nullable: "YES",
      default: "",
      foreign_key: "public.roles.id",
      check_constraint: "",
      comment: "",
      _tempId: "0",
    };

    const fields = getDesignerModifiedFields(row, baseline);
    expect(fields.has("column_name")).toBe(true);
    expect(fields.has("db_type")).toBe(true);
    expect(fields.has("nullable")).toBe(true);
    expect(fields.has("foreign_key")).toBe(true);
  });
});
