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

  it("maps updates when identity column exists on rows but is not a visible column", () => {
    const tableKey = "mongo-conn:test-db::orders";
    mockCrudState.stagedCommands.set(tableKey, [
      {
        id: "update-nested-1",
        type: "data.update",
        target: {
          connectionId: "mongo-conn",
          database: "test-db",
          table: "orders",
        },
        payload: {
          column: "items.2.productSku",
          oldValue: "AUDIO-001",
          newValue: "AUDIO-0012323",
          primaryKeys: {
            _id: "order-1",
            __index: 2,
          },
        },
        metadata: {
          timestamp: new Date().toISOString(),
          description: "Update nested array item",
          gridColumn: "productSku",
        },
        state: "staged",
      },
    ] satisfies CrudCommand[]);

    const nestedColumns: GridColumnV2[] = [
      {
        id: "productSku",
        field: "productSku",
        name: "productSku",
        title: "productSku",
        type: "text",
        width: 140,
        meta: {
          name: "productSku",
          db_type: "text",
          nullable: true,
          default: null,
          is_pk: false,
          is_fk: false,
          ordinal: 0,
        },
      },
    ];

    const nestedRows: GridRowModel[] = [
      {
        __index: {
          value: 0,
          db_type: "number",
          value_type: "Integer",
          is_truncated: false,
        },
        productSku: {
          value: "PHONE-001",
          db_type: "text",
          value_type: "Text",
          is_truncated: false,
        },
      },
      {
        __index: {
          value: 1,
          db_type: "number",
          value_type: "Integer",
          is_truncated: false,
        },
        productSku: {
          value: "LAPTOP-001",
          db_type: "text",
          value_type: "Text",
          is_truncated: false,
        },
      },
      {
        __index: {
          value: 2,
          db_type: "number",
          value_type: "Integer",
          is_truncated: false,
        },
        productSku: {
          value: "AUDIO-001",
          db_type: "text",
          value_type: "Text",
          is_truncated: false,
        },
      },
    ];

    const { result } = renderHook(() =>
      useStagedChangesIndicator({
        connectionId: "mongo-conn",
        database: "test-db",
        table: "orders",
        rowIdentityColumns: ["__index"],
        rows: nestedRows,
        columns: nestedColumns,
      }),
    );

    expect(result.current.rowChanges.get(2)?.has("productSku")).toBe(true);
  });
});
