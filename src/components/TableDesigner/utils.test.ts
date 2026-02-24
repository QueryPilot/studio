import { describe, it, expect } from "vitest";
import {
  getDesignerModifiedFields,
  generateIndexName,
  buildDesignerIndexRows,
  syncIndexCommandsWithColumns,
  type DesignerGridRow,
} from "./utils";
import type { ColumnDefinitionInput, CrudCommand } from "@/types/crud";

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

// ---------------------------------------------------------------------------
// generateIndexName
// ---------------------------------------------------------------------------
describe("generateIndexName", () => {
  it("generates name from table and columns", () => {
    expect(generateIndexName("users", ["email"])).toBe("idx_users_email");
  });

  it("joins multiple columns with underscore", () => {
    expect(generateIndexName("orders", ["user_id", "created_at"])).toBe(
      "idx_orders_user_id_created_at",
    );
  });

  it("truncates long names to 63 chars", () => {
    const longTable = "a_very_long_table_name_that_goes_on";
    const longCols = [
      "some_really_long_column_name",
      "another_really_long_column_name",
    ];
    const result = generateIndexName(longTable, longCols);
    expect(result.length).toBeLessThanOrEqual(63);
    expect(result).toBe(
      `idx_${longTable}_${longCols.join("_")}`.slice(0, 63),
    );
  });

  it("returns empty string when no columns", () => {
    expect(generateIndexName("users", [])).toBe("");
  });

  it("handles empty table name", () => {
    const result = generateIndexName("", ["col"]);
    expect(result).toBe("idx__col");
  });
});

// ---------------------------------------------------------------------------
// buildDesignerIndexRows
// ---------------------------------------------------------------------------
describe("buildDesignerIndexRows", () => {
  function makeIndexCreateCommand(
    overrides: {
      name?: string;
      columns?: string[];
      unique?: boolean;
      using?: string;
      where?: string;
      tempId?: string;
    } = {},
  ): CrudCommand {
    return {
      id: crypto.randomUUID(),
      type: "index.create",
      target: { connectionId: "conn-1", schema: "public", table: "users" },
      payload: {
        tempId: overrides.tempId ?? "temp-1",
        definition: {
          name: overrides.name ?? "idx_users_email",
          columns: overrides.columns ?? ["email"],
          unique: overrides.unique,
          using: overrides.using,
          where: overrides.where,
        },
      },
      metadata: { timestamp: new Date().toISOString() },
      state: "staged",
    };
  }

  it("returns empty array when no commands", () => {
    expect(buildDesignerIndexRows([])).toEqual([]);
  });

  it("builds rows from index.create commands correctly", () => {
    const cmd = makeIndexCreateCommand({
      name: "idx_orders_user_id",
      columns: ["user_id", "created_at"],
      unique: true,
      using: "hash",
      where: "active = true",
      tempId: "temp-42",
    });

    const rows = buildDesignerIndexRows([cmd]);
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.row_number).toBe(1);
    expect(row.name).toBe("idx_orders_user_id");
    expect(row.name_meta).toEqual({ primary: false, unique: true });
    expect(row.columns).toBe("user_id, created_at");
    expect(row.columns_array).toEqual(["user_id", "created_at"]);
    expect(row.index_type).toBe("hash");
    expect(row.unique).toBe("YES");
    expect(row.statistics).toBe("");
    expect(row.condition).toBe("active = true");
    expect(row._tempId).toBe("temp-42");
    expect(row._isPending).toBe(true);
  });

  it("ignores non-index commands", () => {
    const indexCmd = makeIndexCreateCommand();
    const columnCmd: CrudCommand = {
      id: crypto.randomUUID(),
      type: "column.add",
      target: { connectionId: "conn-1", schema: "public", table: "users" },
      payload: {
        column: {
          name: "age",
          dataType: "INT",
        },
      },
      metadata: { timestamp: new Date().toISOString() },
      state: "staged",
    };

    const rows = buildDesignerIndexRows([columnCmd, indexCmd]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("idx_users_email");
  });

  it("defaults to btree when using is not specified", () => {
    const cmd = makeIndexCreateCommand({ using: undefined });
    const rows = buildDesignerIndexRows([cmd]);
    expect(rows[0]!.index_type).toBe("btree");
  });

  it("defaults unique to NO when not specified", () => {
    const cmd = makeIndexCreateCommand({ unique: undefined });
    const rows = buildDesignerIndexRows([cmd]);
    expect(rows[0]!.unique).toBe("NO");
    expect(rows[0]!.name_meta.unique).toBe(false);
  });

  it("defaults condition to empty string when where is not specified", () => {
    const cmd = makeIndexCreateCommand({ where: undefined });
    const rows = buildDesignerIndexRows([cmd]);
    expect(rows[0]!.condition).toBe("");
  });
});

// ---------------------------------------------------------------------------
// syncIndexCommandsWithColumns
// ---------------------------------------------------------------------------
describe("syncIndexCommandsWithColumns", () => {
  const makeIndexCmd = (
    name: string,
    columns: string[],
    tempId: string,
  ): CrudCommand => ({
    id: `cmd-${tempId}`,
    type: "index.create",
    target: {
      connectionId: "c1",
      database: "db",
      schema: "public",
      table: "t",
    },
    payload: {
      definition: { name, columns, unique: false, using: "btree" },
      tempId,
    },
    metadata: { timestamp: "", description: "", tags: [] },
    state: "staged",
  });

  it("returns null when no changes needed", () => {
    const cmds = [makeIndexCmd("idx_t_a_b", ["a", "b"], "1")];
    const result = syncIndexCommandsWithColumns(
      cmds,
      ["a", "b", "c"],
      new Map(),
    );
    expect(result).toBeNull();
  });

  it("renames columns in index definitions", () => {
    const cmds = [makeIndexCmd("idx_t_a_b", ["a", "b"], "1")];
    const renames = new Map([["a", "alpha"]]);
    const result = syncIndexCommandsWithColumns(
      cmds,
      ["alpha", "b", "c"],
      renames,
    );
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    const payload = result![0]!.payload as { definition: { columns: string[] } };
    expect(payload.definition.columns).toEqual(["alpha", "b"]);
  });

  it("removes columns no longer in the list", () => {
    const cmds = [makeIndexCmd("idx_t_a_b", ["a", "b"], "1")];
    // "b" has been deleted, only "a" and "c" remain
    const result = syncIndexCommandsWithColumns(
      cmds,
      ["a", "c"],
      new Map(),
    );
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    const payload = result![0]!.payload as { definition: { columns: string[] } };
    expect(payload.definition.columns).toEqual(["a"]);
  });

  it("excludes commands that lose all columns", () => {
    const cmds = [makeIndexCmd("idx_t_x", ["x"], "1")];
    // "x" is gone, only "a" remains
    const result = syncIndexCommandsWithColumns(
      cmds,
      ["a"],
      new Map(),
    );
    expect(result).not.toBeNull();
    expect(result).toHaveLength(0);
  });

  it("handles multiple commands — some changed, some not, some removed", () => {
    const cmds = [
      makeIndexCmd("idx_unchanged", ["a", "b"], "1"),
      makeIndexCmd("idx_renamed", ["c", "d"], "2"),
      makeIndexCmd("idx_removed", ["x"], "3"),
    ];
    const renames = new Map([["c", "charlie"]]);
    // Available columns: a, b, charlie, d (no "x")
    const result = syncIndexCommandsWithColumns(
      cmds,
      ["a", "b", "charlie", "d"],
      renames,
    );
    expect(result).not.toBeNull();
    // idx_unchanged stays (no changes), idx_renamed changed, idx_removed excluded
    expect(result).toHaveLength(2);

    // First command unchanged (same object reference)
    expect(result![0]!.id).toBe("cmd-1");
    const payload1 = result![0]!.payload as {
      definition: { columns: string[] };
    };
    expect(payload1.definition.columns).toEqual(["a", "b"]);

    // Second command renamed
    expect(result![1]!.id).toBe("cmd-2");
    const payload2 = result![1]!.payload as {
      definition: { columns: string[] };
    };
    expect(payload2.definition.columns).toEqual(["charlie", "d"]);
  });
});
