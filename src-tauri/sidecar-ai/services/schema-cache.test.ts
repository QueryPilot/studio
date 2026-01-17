/**
 * Schema Cache Tests
 *
 * Tests for paradigm-aware schema caching with TTL and preload strategies.
 */

import { describe, it, expect } from "bun:test";
import { SchemaCache, getPreloadStrategy } from "./schema-cache";

describe("SchemaCache", () => {
  it("should cache and retrieve values", () => {
    const cache = new SchemaCache();
    cache.set("key", { data: "value" }, { ttl: 60000 });
    expect(cache.get("key")).toEqual({ data: "value" });
  });

  it("should expire values after TTL", async () => {
    const cache = new SchemaCache();
    cache.set("key", { data: "value" }, { ttl: 10 });
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get("key")).toBeUndefined();
  });

  it("should respect per-connection limits", () => {
    const cache = new SchemaCache({ maxEntriesPerConnection: 2 });
    cache.set("conn1:a", "a");
    cache.set("conn1:b", "b");
    cache.set("conn1:c", "c"); // Should evict oldest
    expect(cache.get("conn1:a")).toBeUndefined();
  });

  it("should clear all entries", () => {
    const cache = new SchemaCache();
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.clear();
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBeUndefined();
  });

  it("should clear connection-specific entries", () => {
    const cache = new SchemaCache();
    cache.set("conn1:a", "a");
    cache.set("conn1:b", "b");
    cache.set("conn2:a", "a");
    cache.clearConnection("conn1");
    expect(cache.get("conn1:a")).toBeUndefined();
    expect(cache.get("conn1:b")).toBeUndefined();
    expect(cache.get("conn2:a")).toBe("a");
  });

  it("should check if key exists", () => {
    const cache = new SchemaCache();
    cache.set("key", "value");
    expect(cache.has("key")).toBe(true);
    expect(cache.has("nonexistent")).toBe(false);
  });

  it("should delete a key", () => {
    const cache = new SchemaCache();
    cache.set("key", "value");
    cache.delete("key");
    expect(cache.get("key")).toBeUndefined();
  });

  it("should handle default TTL", () => {
    const cache = new SchemaCache({ defaultTtl: 100 });
    cache.set("key", "value"); // No TTL specified, should use default
    expect(cache.get("key")).toBe("value");
  });
});

describe("getPreloadStrategy", () => {
  it("should return sql strategy for sql kind", () => {
    const strategy = getPreloadStrategy("sql");
    expect(strategy.maxPreload).toBe(10);
  });

  it("should return document strategy for document kind", () => {
    const strategy = getPreloadStrategy("document");
    expect(strategy.maxPreload).toBe(5);
  });

  it("should return keyvalue strategy with no preload", () => {
    const strategy = getPreloadStrategy("keyvalue");
    expect(strategy.maxPreload).toBe(0);
  });

  it("should prioritize common table names for sql", () => {
    const strategy = getPreloadStrategy("sql");
    const tables = ["logs", "users", "metrics", "orders"];
    const prioritized = strategy.prioritize(tables);
    expect(prioritized[0]).toBe("users");
    expect(prioritized[1]).toBe("orders");
  });

  it("should prioritize common collection names for document", () => {
    const strategy = getPreloadStrategy("document");
    const collections = ["logs", "users", "products", "sessions"];
    const prioritized = strategy.prioritize(collections);
    expect(prioritized[0]).toBe("users");
    expect(prioritized[1]).toBe("products");
  });

  it("should not prioritize for keyvalue", () => {
    const strategy = getPreloadStrategy("keyvalue");
    const keys = ["key1", "key2", "key3"];
    const prioritized = strategy.prioritize(keys);
    expect(prioritized).toEqual(keys); // Should return unchanged
  });
});
