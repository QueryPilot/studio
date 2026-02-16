import { describe, expect, it, vi } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
const resolveTableAliasMock = vi.hoisted(() =>
  vi.fn((qualifier: string) => ({
    tableName: "orders",
    schema: qualifier === "a" ? "analytics" : "public",
  })),
);
const extractTableRefsMock = vi.hoisted(() => vi.fn(() => []));

vi.mock("./shared", async () => {
  const actual = await vi.importActual("./shared");
  return {
    ...actual,
    extractTableRefs: (...args: unknown[]) => extractTableRefsMock(...args),
    resolveTableAlias: (...args: unknown[]) => resolveTableAliasMock(...args),
  };
});

import {
  clearCompletionCache,
  createOptimizedCompletionSource,
} from "./optimized-completion";
import type { MetadataProvider } from "../../types";

function makeContext(sql: string, pos: number): CompletionContext {
  return new CompletionContext(EditorState.create({ doc: sql }), pos, true);
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("clearCompletionCache", () => {
  it("keeps unrelated inflight requests when clearing a specific connection", async () => {
    clearCompletionCache();

    const deferred = createDeferred<Array<{ name: string; type: "table" }>>();
    let listEntitiesCalls = 0;

    const provider: MetadataProvider = {
      listEntities: async () => {
        listEntitiesCalls += 1;
        const entities = await deferred.promise;
        return entities.map((entity) => ({
          ...entity,
          schema: "public",
        }));
      },
      listFields: () => Promise.resolve([]),
    };

    const source = createOptimizedCompletionSource({
      connectionId: "conn-b",
      database: "db",
      schema: "public",
      dialect: "postgresql",
      providerOverride: provider,
      disableRustSource: true,
    });

    const sql = "SELECT * FROM us";
    const pos = sql.length;
    const context = makeContext(sql, pos);

    const firstRequest = source(context);
    // Let the first request reach inflight registration before clearing.
    await Promise.resolve();
    clearCompletionCache("conn-a");
    const secondRequest = source(context);

    deferred.resolve([{ name: "users", type: "table" }]);

    await Promise.all([firstRequest, secondRequest]);

    expect(listEntitiesCalls).toBe(1);
  });

  it("separates qualified column metadata cache entries by schema", async () => {
    clearCompletionCache();

    const listFields = vi.fn((entityName: string, schema?: string) =>
      Promise.resolve([
        {
          name: schema === "analytics" ? "analytics_total" : "public_total",
          dataType: "integer",
          parentEntity: entityName,
        },
      ]),
    );

    const provider: MetadataProvider = {
      listEntities: () => Promise.resolve([]),
      listFields,
    };

    const source = createOptimizedCompletionSource({
      connectionId: "conn-a",
      database: "db",
      schema: "public",
      dialect: "postgresql",
      providerOverride: provider,
      disableRustSource: true,
    });

    const analyticsSql = "SELECT a. FROM orders a";
    const analyticsResult = await source(
      makeContext(analyticsSql, analyticsSql.indexOf("a.") + 2),
    );
    expect(analyticsResult?.options.some((option) => option.label === "analytics_total")).toBe(
      true,
    );

    const publicSql = "SELECT p. FROM orders p";
    const publicResult = await source(
      makeContext(publicSql, publicSql.indexOf("p.") + 2),
    );
    expect(publicResult?.options.some((option) => option.label === "public_total")).toBe(
      true,
    );
    expect(publicResult?.options.some((option) => option.label === "analytics_total")).toBe(
      false,
    );
    expect(listFields).toHaveBeenCalledTimes(2);
  });
});
