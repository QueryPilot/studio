import { beforeEach, describe, expect, it, vi } from "vitest";
import { schemaCache } from "@/services/schemaCache";
import { createSqlMetadataProvider } from "./metadataProvider";

describe("SqlMetadataProvider join suggestions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("formats composite foreign key join conditions with dialect-aware quoting", async () => {
    vi.spyOn(schemaCache, "getRelationshipGraph").mockResolvedValue({
      relationships: new Map(),
      reverseRelationships: new Map([
        [
          "orders",
          [
            {
              sourceTable: "order_items",
              sourceSchema: "sales",
              sourceColumn: "order_id",
              sourceColumns: ["order_id", "order_created_at"],
              targetTable: "orders",
              targetSchema: "sales",
              targetColumn: "id",
              targetColumns: ["id", "created_at"],
              constraintName: "order_items_orders_fkey",
            },
          ],
        ],
      ]),
    });

    const provider = createSqlMetadataProvider("conn-1", "sales", "mssql");
    const getJoinConditions = provider.getJoinConditions?.bind(provider);

    expect(getJoinConditions).toBeTypeOf("function");
    if (!getJoinConditions) {
      throw new Error("Expected getJoinConditions to be defined");
    }

    const suggestions = await getJoinConditions(
      [{ name: "orders", alias: "o", schema: "sales" }],
      { name: "order_items", alias: "oi", schema: "sales" },
      "sales",
    );

    expect(suggestions[0]?.condition).toBe(
      "oi.[order_id] = o.[id] AND oi.[order_created_at] = o.[created_at]",
    );
    expect(suggestions[0]?.source).toBe("fk");
  });

  it("does not suggest same-column self joins for the same table", async () => {
    vi.spyOn(schemaCache, "getRelationshipGraph").mockResolvedValue({
      relationships: new Map(),
      reverseRelationships: new Map(),
    });
    vi.spyOn(schemaCache, "getTableColumns").mockResolvedValue([
      {
        name: "uuid",
        db_type: "uuid",
        default: null,
        is_fk: false,
        nullable: false,
        is_pk: false,
        ordinal: 1,
      },
    ]);

    const provider = createSqlMetadataProvider("conn-1", "public", "postgresql");
    const getJoinConditions = provider.getJoinConditions?.bind(provider);

    expect(getJoinConditions).toBeTypeOf("function");
    if (!getJoinConditions) {
      throw new Error("Expected getJoinConditions to be defined");
    }

    const suggestions = await getJoinConditions(
      [{ name: "orders", alias: "o", schema: "public" }],
      { name: "orders", alias: "o2", schema: "public" },
      "public",
    );

    expect(suggestions).toEqual([]);
  });

  it("does not suggest reverse pattern joins when scope table has no id/primary key column", async () => {
    vi.spyOn(schemaCache, "getRelationshipGraph").mockResolvedValue({
      relationships: new Map(),
      reverseRelationships: new Map(),
    });

    vi.spyOn(schemaCache, "getTableColumns").mockImplementation(
      (_connectionId: string, _schema: string, tableName: string) => {
        if (tableName === "users") {
          return Promise.resolve([
            {
              name: "uuid",
              db_type: "uuid",
              default: null,
              is_fk: false,
              nullable: false,
              is_pk: false,
              ordinal: 1,
            },
          ]);
        }

        if (tableName === "orders") {
          return Promise.resolve([
            {
              name: "users_id",
              db_type: "integer",
              default: null,
              is_fk: false,
              nullable: false,
              is_pk: false,
              ordinal: 1,
            },
          ]);
        }

        return Promise.resolve([]);
      },
    );

    const provider = createSqlMetadataProvider("conn-1", "public", "postgresql");
    const getJoinConditions = provider.getJoinConditions?.bind(provider);

    expect(getJoinConditions).toBeTypeOf("function");
    if (!getJoinConditions) {
      throw new Error("Expected getJoinConditions to be defined");
    }

    const suggestions = await getJoinConditions(
      [{ name: "users", alias: "u", schema: "public" }],
      { name: "orders", alias: "o", schema: "public" },
      "public",
    );

    expect(suggestions).toEqual([]);
  });

  it("does not suggest fallback fk-pattern joins when data types are incompatible", async () => {
    vi.spyOn(schemaCache, "getRelationshipGraph").mockResolvedValue({
      relationships: new Map(),
      reverseRelationships: new Map(),
    });

    vi.spyOn(schemaCache, "getTableColumns").mockImplementation(
      (_connectionId: string, _schema: string, tableName: string) => {
        if (tableName === "line_items") {
          return Promise.resolve([
            {
              name: "orders_id",
              db_type: "varchar",
              default: null,
              is_fk: false,
              nullable: false,
              is_pk: false,
              ordinal: 1,
            },
          ]);
        }

        if (tableName === "orders") {
          return Promise.resolve([
            {
              name: "id",
              db_type: "integer",
              default: null,
              is_fk: false,
              nullable: false,
              is_pk: true,
              ordinal: 1,
            },
          ]);
        }

        return Promise.resolve([]);
      },
    );

    const provider = createSqlMetadataProvider("conn-1", "public", "postgresql");
    const getJoinConditions = provider.getJoinConditions?.bind(provider);

    expect(getJoinConditions).toBeTypeOf("function");
    if (!getJoinConditions) {
      throw new Error("Expected getJoinConditions to be defined");
    }

    const suggestions = await getJoinConditions(
      [{ name: "line_items", alias: "li", schema: "public" }],
      { name: "orders", alias: "o", schema: "public" },
      "public",
    );

    expect(suggestions).toEqual([]);
  });
});
