import { describe, expect, it } from "vitest";
import {
  buildMongoCollectionDefinition,
  buildMongoCollectionMetadataCommand,
  buildMongoCollectionMetadataQuery,
  buildRedisDatabaseDefinition,
  buildRedisSelectCommand,
  canCopyDefinition,
  canDelete,
  canSnapshotToDuckDb,
  canTruncate,
  getSqlTruncateOptionSupport,
  isImmediateExecution,
} from "../sidebarContextMenuHelpers";
import { DbType } from "@/types/connection";

describe("sidebarContextMenuHelpers", () => {
  it("builds mongo metadata query for a collection", () => {
    const query = buildMongoCollectionMetadataQuery("orders");
    const parsed = JSON.parse(query) as {
      command: {
        listCollections: number;
        filter: { name: string };
        nameOnly: boolean;
      };
    };

    expect(parsed.command.listCollections).toBe(1);
    expect(parsed.command.filter.name).toBe("orders");
    expect(parsed.command.nameOnly).toBe(false);
  });

  it("builds redis SELECT command", () => {
    expect(buildRedisSelectCommand(0)).toBe("SELECT 0");
    expect(buildRedisSelectCommand(12)).toBe("SELECT 12");
  });

  it("builds mongo metadata command object", () => {
    expect(buildMongoCollectionMetadataCommand("orders")).toEqual({
      listCollections: 1,
      filter: { name: "orders" },
      nameOnly: false,
    });
  });

  it("enables copy definition for SQL and collections", () => {
    expect(
      canCopyDefinition({
        tables: 1,
        views: 0,
        materializedViews: 0,
        functions: 0,
        collections: 0,
      }),
    ).toBe(true);

    expect(
      canCopyDefinition({
        tables: 0,
        views: 0,
        materializedViews: 0,
        functions: 0,
        collections: 2,
      }),
    ).toBe(true);
  });

  it("enables truncate only for homogeneous table or collection selections", () => {
    expect(
      canTruncate({
        tables: 2,
        views: 0,
        materializedViews: 0,
        functions: 0,
        collections: 0,
      }),
    ).toBe(true);

    expect(
      canTruncate({
        tables: 0,
        views: 0,
        materializedViews: 0,
        functions: 0,
        collections: 1,
      }),
    ).toBe(true);

    expect(
      canTruncate({
        tables: 1,
        views: 1,
        materializedViews: 0,
        functions: 0,
        collections: 0,
      }),
    ).toBe(false);
  });

  it("enables delete for SQL objects and collections, not mixed selections", () => {
    expect(
      canDelete({
        tables: 1,
        views: 0,
        materializedViews: 0,
        functions: 0,
        collections: 0,
      }),
    ).toBe(true);

    expect(
      canDelete({
        tables: 0,
        views: 0,
        materializedViews: 0,
        functions: 0,
        collections: 1,
      }),
    ).toBe(true);

    expect(
      canDelete({
        tables: 0,
        views: 0,
        materializedViews: 0,
        functions: 1,
        collections: 0,
      }),
    ).toBe(false);
  });

  it("enables snapshot to DuckDB only for a single supported object", () => {
    expect(
      canSnapshotToDuckDb({
        tables: 1,
        views: 0,
        materializedViews: 0,
        functions: 0,
        collections: 0,
      }),
    ).toBe(true);

    expect(
      canSnapshotToDuckDb({
        tables: 0,
        views: 0,
        materializedViews: 0,
        functions: 0,
        collections: 1,
      }),
    ).toBe(true);

    expect(
      canSnapshotToDuckDb({
        tables: 1,
        views: 1,
        materializedViews: 0,
        functions: 0,
        collections: 0,
      }),
    ).toBe(false);

    expect(
      canSnapshotToDuckDb({
        tables: 0,
        views: 0,
        materializedViews: 0,
        functions: 1,
        collections: 0,
      }),
    ).toBe(false);
  });

  it("marks collection destructive actions as immediate execution", () => {
    expect(
      isImmediateExecution({
        tables: 0,
        views: 0,
        materializedViews: 0,
        functions: 0,
        collections: 1,
      }),
    ).toBe(true);

    expect(
      isImmediateExecution({
        tables: 1,
        views: 0,
        materializedViews: 0,
        functions: 0,
        collections: 0,
      }),
    ).toBe(false);
  });

  it("formats mongo collection definition from metadata payload", () => {
    const definition = buildMongoCollectionDefinition("orders", {
      cursor: {
        firstBatch: [
          {
            name: "orders",
            type: "collection",
            options: { validator: { status: { $type: "string" } } },
          },
        ],
      },
    });

    const parsed = JSON.parse(definition) as {
      collection: string;
      metadata: {
        name: string;
        options: { validator: Record<string, unknown> };
      };
    };

    expect(parsed.collection).toBe("orders");
    expect(parsed.metadata.name).toBe("orders");
    expect(parsed.metadata.options.validator).toBeDefined();
  });

  it("formats redis database definition", () => {
    const definition = buildRedisDatabaseDefinition({
      dbIndex: 7,
      keys: 42,
      expires: 10,
    });
    const parsed = JSON.parse(definition) as {
      database: string;
      dbIndex: number;
      keys: number;
      expires: number;
      selectCommand: string;
    };

    expect(parsed.database).toBe("db7");
    expect(parsed.dbIndex).toBe(7);
    expect(parsed.keys).toBe(42);
    expect(parsed.expires).toBe(10);
    expect(parsed.selectCommand).toBe("SELECT 7");
  });

  it("returns truncate option support by SQL dialect", () => {
    expect(getSqlTruncateOptionSupport(DbType.PostgreSQL)).toEqual({
      restartIdentity: true,
      cascade: true,
    });

    expect(getSqlTruncateOptionSupport(DbType.MySQL)).toEqual({
      restartIdentity: false,
      cascade: false,
    });

    expect(getSqlTruncateOptionSupport(DbType.SQLite)).toEqual({
      restartIdentity: false,
      cascade: false,
    });
  });
});
