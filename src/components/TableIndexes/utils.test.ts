import { describe, it, expect } from "vitest";
import { getIndexModifiedFields } from "./utils";
import type { IndexGridRow } from "./types";

describe("getIndexModifiedFields", () => {
  it("detects modified fields against the original index", () => {
    const row: IndexGridRow = {
      row_number: 1,
      name: "idx_users_email_new",
      name_meta: {
        primary: false,
        unique: true,
      },
      columns: "email, tenant_id",
      columns_array: ["email", "tenant_id"],
      index_type: "hash",
      unique: "YES",
      statistics: "—",
      condition: "tenant_id IS NOT NULL",
      _original: {
        name: "idx_users_email",
        unique: false,
        primary: false,
        columns: ["email"],
        index_type: "btree",
        condition: "",
      },
      _isModified: true,
    };

    const fields = getIndexModifiedFields(row);
    expect(fields.has("name")).toBe(true);
    expect(fields.has("columns")).toBe(true);
    expect(fields.has("unique")).toBe(true);
    expect(fields.has("index_type")).toBe(true);
    expect(fields.has("condition")).toBe(true);
  });

  it("returns empty set when nothing changed", () => {
    const row: IndexGridRow = {
      row_number: 1,
      name: "idx_users_email",
      name_meta: {
        primary: false,
        unique: false,
      },
      columns: "email",
      columns_array: ["email"],
      index_type: "btree",
      unique: "NO",
      statistics: "—",
      condition: "",
      _original: {
        name: "idx_users_email",
        unique: false,
        primary: false,
        columns: ["email"],
        index_type: "btree",
        condition: "",
      },
      _isModified: false,
    };

    const fields = getIndexModifiedFields(row);
    expect(fields.size).toBe(0);
  });
});
