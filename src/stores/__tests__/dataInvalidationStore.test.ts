import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDataInvalidationStore } from "../dataInvalidationStore";

describe("dataInvalidationStore", () => {
  beforeEach(() => {
    useDataInvalidationStore.setState({
      invalidations: new Map<string, number>(),
      schemaInvalidations: new Map<string, number>(),
    });
  });

  it("normalizes empty schema to public for table invalidation keys", () => {
    const store = useDataInvalidationStore.getState();

    store.invalidateTable("conn-1", "db-1", undefined, "users");

    const withUndefined = store.getLastModified("conn-1", "db-1", undefined, "users");
    const withEmpty = store.getLastModified("conn-1", "db-1", "", "users");

    expect(withUndefined).toBeGreaterThan(0);
    expect(withEmpty).toBe(withUndefined);
  });

  it("notifies subscribers when subscribing with undefined schema and invalidating with empty schema", async () => {
    const store = useDataInvalidationStore.getState();
    const callback = vi.fn();

    const unsubscribe = store.subscribe(
      "conn-1",
      "db-1",
      undefined,
      "users",
      callback,
    );

    try {
      store.invalidateTable("conn-1", "db-1", "", "users");
      await Promise.resolve();
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("normalizes empty schema to public for schema invalidation keys", () => {
    const store = useDataInvalidationStore.getState();

    store.invalidateSchema("conn-1", "db-1", undefined);

    const withUndefined = store.getSchemaLastModified("conn-1", "db-1", undefined);
    const withEmpty = store.getSchemaLastModified("conn-1", "db-1", "");

    expect(withUndefined).toBeGreaterThan(0);
    expect(withEmpty).toBe(withUndefined);
  });
});
