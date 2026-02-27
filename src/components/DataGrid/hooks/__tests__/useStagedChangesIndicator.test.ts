import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStagedChangesIndicator } from "../useStagedChangesIndicator";
import type { GridColumnV2, GridRowModel } from "@/components/DataGrid/types";
import type { CrudCommand } from "@/types";

const mockCrudState = {
  getTableKey: vi.fn(
    ({
      connectionId,
      database,
      schema,
      table,
    }: {
      connectionId: string;
      database: string;
      schema?: string;
      table: string;
    }) => `${connectionId}:${database}:${schema ?? ""}:${table}`,
  ),
  stagedCommands: new Map<string, CrudCommand[]>(),
};

vi.mock("@/stores/crudStore", () => ({
  useCrudStore: vi.fn((selector) => selector(mockCrudState)),
}));

const columns: GridColumnV2[] = [
  {
    id: "email",
    field: "col_0",
    name: "email",
    title: "email",
    type: "text",
    width: 120,
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
  {
    id: "tenant_id",
    field: "col_1",
    name: "tenant_id",
    title: "tenant_id",
    type: "text",
    width: 120,
    meta: {
      name: "tenant_id",
      db_type: "text",
      nullable: false,
      default: null,
      is_pk: false,
      is_fk: false,
      ordinal: 1,
    },
  },
  {
    id: "amount",
    field: "col_2",
    name: "amount",
    title: "amount",
    type: "number",
    width: 120,
    meta: {
      name: "amount",
      db_type: "integer",
      nullable: true,
      default: null,
      is_pk: false,
      is_fk: false,
      ordinal: 2,
    },
  },
];

const rows: GridRowModel[] = [
  {
    col_0: { value: "alice@example.com", db_type: "text", value_type: "Text", is_truncated: false },
    col_1: { value: "tenant-a", db_type: "text", value_type: "Text", is_truncated: false },
    col_2: { value: 10, db_type: "integer", value_type: "Integer", is_truncated: false },
  },
];

describe("useStagedChangesIndicator", () => {
  beforeEach(() => {
    mockCrudState.stagedCommands.clear();
    mockCrudState.getTableKey.mockClear();
  });

  it("maps delete and update staged changes using configured identity columns", () => {
    const tableKey = "test-conn:test-db:public:users";
    mockCrudState.stagedCommands.set(tableKey, [
      {
        id: "delete-1",
        type: "data.delete",
        target: {
          connectionId: "test-conn",
          database: "test-db",
          schema: "public",
          table: "users",
        },
        payload: {
          primaryKeys: {
            email: "alice@example.com",
            tenant_id: "tenant-a",
          },
        },
        metadata: {
          timestamp: new Date().toISOString(),
          description: "Delete row",
        },
        state: "staged",
      },
      {
        id: "update-1",
        type: "data.update",
        target: {
          connectionId: "test-conn",
          database: "test-db",
          schema: "public",
          table: "users",
        },
        payload: {
          column: "amount",
          oldValue: 10,
          newValue: 20,
          primaryKeys: {
            email: "alice@example.com",
            tenant_id: "tenant-a",
          },
        },
        metadata: {
          timestamp: new Date().toISOString(),
          description: "Update amount",
        },
        state: "staged",
      },
    ] satisfies CrudCommand[]);

    const { result } = renderHook(() =>
      useStagedChangesIndicator({
        connectionId: "test-conn",
        database: "test-db",
        schema: "public",
        table: "users",
        rowIdentityColumns: ["email", "tenant_id"],
        rows,
        columns,
      }),
    );

    expect(result.current.deletedRows.has(0)).toBe(true);
    expect(result.current.rowChanges.get(0)?.has("amount")).toBe(true);
  });
});
