import { describe, it, expect } from "vitest";
import { buildStructureModifiedFieldsMap } from "./utils";
import type { CrudCommand } from "@/types/crud";
import type { ForeignKeyInfo } from "@/types/tableStructure";

const baseCommand = {
  id: "cmd-1",
  target: {
    connectionId: "conn",
    database: "db",
    schema: "public",
    table: "users",
  },
  metadata: {
    timestamp: "2024-01-01T00:00:00.000Z",
    description: "test",
  },
  state: "staged",
} as const;

describe("buildStructureModifiedFieldsMap", () => {
  it("maps column modify fields to their grid columns", () => {
    const modifyCmd: CrudCommand = {
      ...baseCommand,
      id: "cmd-modify",
      type: "column.modify",
      payload: {
        columnName: "username",
        newDefinition: {
          dataType: "text",
          nullable: false,
          defaultValue: "guest",
        },
      },
    };

    const map = buildStructureModifiedFieldsMap([modifyCmd], []);
    const fields = map.get("username");
    expect(fields?.has("db_type")).toBe(true);
    expect(fields?.has("nullable")).toBe(true);
    expect(fields?.has("default")).toBe(true);
  });

  it("marks foreign key changes from add/drop commands", () => {
    const fkAdd: CrudCommand = {
      ...baseCommand,
      id: "cmd-fk-add",
      type: "fk.add",
      payload: {
        definition: {
          columns: ["role_id"],
          referenceTable: "roles",
          referenceColumns: ["id"],
        },
      },
    };

    const fkDrop: CrudCommand = {
      ...baseCommand,
      id: "cmd-fk-drop",
      type: "fk.drop",
      payload: {
        constraintName: "fk_users_role_id",
      },
    };

    const foreignKeys: ForeignKeyInfo[] = [
      {
        name: "fk_users_role_id",
        columns: ["role_id"],
        foreignTable: "roles",
        foreignColumns: ["id"],
      },
    ];

    const map = buildStructureModifiedFieldsMap([fkAdd, fkDrop], foreignKeys);
    const fields = map.get("role_id");
    expect(fields?.has("foreign_key")).toBe(true);
  });
});
