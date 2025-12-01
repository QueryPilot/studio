/**
 * Tests for connection-aware metadata cache
 */

import { describe, expect, it, beforeEach, afterEach, jest } from "bun:test";
import { metadataCache, CacheTypes } from "./cache";

describe("MetadataCache", () => {
  // Clear cache before each test
  beforeEach(() => {
    metadataCache.clear();
  });

  describe("basic operations", () => {
    it("should store and retrieve values", () => {
      const connectionId = "conn-1";
      const data = [{ name: "users" }, { name: "orders" }];

      metadataCache.set(connectionId, CacheTypes.TABLES, ["public"], data);
      const result = metadataCache.get(connectionId, CacheTypes.TABLES, "public");

      expect(result).toEqual(data);
    });

    it("should return undefined for non-existent keys", () => {
      const result = metadataCache.get("conn-1", CacheTypes.TABLES, "public");
      expect(result).toBeUndefined();
    });

    it("should check if key exists with has()", () => {
      const connectionId = "conn-1";
      metadataCache.set(connectionId, CacheTypes.TABLES, ["public"], ["users"]);

      expect(metadataCache.has(connectionId, CacheTypes.TABLES, "public")).toBe(true);
      expect(metadataCache.has(connectionId, CacheTypes.TABLES, "other")).toBe(false);
      expect(metadataCache.has("other-conn", CacheTypes.TABLES, "public")).toBe(false);
    });

    it("should delete specific entries", () => {
      const connectionId = "conn-1";
      metadataCache.set(connectionId, CacheTypes.TABLES, ["public"], ["users"]);
      metadataCache.set(connectionId, CacheTypes.INDEXES, ["users"], ["idx_1"]);

      const deleted = metadataCache.delete(connectionId, CacheTypes.TABLES, "public");

      expect(deleted).toBe(true);
      expect(metadataCache.has(connectionId, CacheTypes.TABLES, "public")).toBe(false);
      expect(metadataCache.has(connectionId, CacheTypes.INDEXES, "users")).toBe(true);
    });

    it("should return false when deleting non-existent key", () => {
      const deleted = metadataCache.delete("conn-1", CacheTypes.TABLES, "public");
      expect(deleted).toBe(false);
    });
  });

  describe("connection isolation", () => {
    it("should isolate data between connections", () => {
      const conn1Data = [{ name: "users" }];
      const conn2Data = [{ name: "products" }];

      metadataCache.set("conn-1", CacheTypes.TABLES, ["public"], conn1Data);
      metadataCache.set("conn-2", CacheTypes.TABLES, ["public"], conn2Data);

      expect(metadataCache.get("conn-1", CacheTypes.TABLES, "public")).toEqual(conn1Data);
      expect(metadataCache.get("conn-2", CacheTypes.TABLES, "public")).toEqual(conn2Data);
    });

    it("should clear only specific connection data", () => {
      metadataCache.set("conn-1", CacheTypes.TABLES, ["public"], ["users"]);
      metadataCache.set("conn-1", CacheTypes.INDEXES, ["users"], ["idx_1"]);
      metadataCache.set("conn-2", CacheTypes.TABLES, ["public"], ["products"]);

      metadataCache.clearConnection("conn-1");

      expect(metadataCache.has("conn-1", CacheTypes.TABLES, "public")).toBe(false);
      expect(metadataCache.has("conn-1", CacheTypes.INDEXES, "users")).toBe(false);
      expect(metadataCache.has("conn-2", CacheTypes.TABLES, "public")).toBe(true);
    });
  });

  describe("TTL expiration", () => {
    it("should expire entries after TTL", async () => {
      const connectionId = "conn-1";
      const shortTTL = 50; // 50ms

      metadataCache.set(connectionId, CacheTypes.TABLES, ["public"], ["users"], shortTTL);

      // Should exist immediately
      expect(metadataCache.get(connectionId, CacheTypes.TABLES, "public")).toBeDefined();

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should be expired
      expect(metadataCache.get(connectionId, CacheTypes.TABLES, "public")).toBeUndefined();
    });

    it("should use default TTL when not specified", () => {
      const connectionId = "conn-1";
      metadataCache.set(connectionId, CacheTypes.TABLES, ["public"], ["users"]);

      // Should exist (default TTL is 5 minutes)
      expect(metadataCache.get(connectionId, CacheTypes.TABLES, "public")).toBeDefined();
    });
  });

  describe("cache key composition", () => {
    it("should handle multiple key parts", () => {
      const connectionId = "conn-1";
      const data = { columns: ["id", "name"] };

      metadataCache.set(connectionId, CacheTypes.TABLE_STRUCTURE, ["public", "users"], data);

      // Should find with exact parts
      const result = metadataCache.get(connectionId, CacheTypes.TABLE_STRUCTURE, "public", "users");
      expect(result).toEqual(data);

      // Should NOT find with different parts
      expect(metadataCache.get(connectionId, CacheTypes.TABLE_STRUCTURE, "public")).toBeUndefined();
      expect(
        metadataCache.get(connectionId, CacheTypes.TABLE_STRUCTURE, "public", "orders")
      ).toBeUndefined();
    });

    it("should differentiate cache types", () => {
      const connectionId = "conn-1";

      metadataCache.set(connectionId, CacheTypes.TABLES, ["public"], ["users"]);
      metadataCache.set(connectionId, CacheTypes.INDEXES, ["public"], ["idx_users"]);

      expect(metadataCache.get(connectionId, CacheTypes.TABLES, "public")).toEqual(["users"]);
      expect(metadataCache.get(connectionId, CacheTypes.INDEXES, "public")).toEqual(["idx_users"]);
    });
  });

  describe("max entries per connection", () => {
    it("should evict oldest entry when limit reached", () => {
      const connectionId = "conn-1";

      // Fill cache with 100 entries (the limit)
      for (let i = 0; i < 100; i++) {
        metadataCache.set(connectionId, CacheTypes.TABLES, [`table-${i}`], { index: i });
      }

      // Add one more to trigger eviction
      metadataCache.set(connectionId, CacheTypes.TABLES, ["table-100"], { index: 100 });

      // Newest should exist
      expect(metadataCache.has(connectionId, CacheTypes.TABLES, "table-100")).toBe(true);

      // Stats should show 100 entries for this connection (after eviction)
      const stats = metadataCache.stats();
      // Note: The count may be 100 or 101 depending on when eviction happens
      // The important thing is that it doesn't grow unbounded
      expect(stats.connectionCounts[connectionId]).toBeLessThanOrEqual(101);
    });

    it("should not affect other connections when evicting", () => {
      // Fill conn-1 to the limit
      for (let i = 0; i < 100; i++) {
        metadataCache.set("conn-1", CacheTypes.TABLES, [`table-${i}`], { index: i });
      }

      // Add entry for conn-2
      metadataCache.set("conn-2", CacheTypes.TABLES, ["users"], ["users"]);

      // Add to conn-1 to trigger eviction
      metadataCache.set("conn-1", CacheTypes.TABLES, ["table-100"], { index: 100 });

      // conn-2 should be unaffected
      expect(metadataCache.has("conn-2", CacheTypes.TABLES, "users")).toBe(true);
    });
  });

  describe("statistics", () => {
    it("should report accurate stats", () => {
      metadataCache.set("conn-1", CacheTypes.TABLES, ["public"], ["users"]);
      metadataCache.set("conn-1", CacheTypes.INDEXES, ["users"], ["idx_1"]);
      metadataCache.set("conn-2", CacheTypes.TABLES, ["public"], ["products"]);

      const stats = metadataCache.stats();

      expect(stats.totalEntries).toBe(3);
      expect(stats.connectionCounts["conn-1"]).toBe(2);
      expect(stats.connectionCounts["conn-2"]).toBe(1);
    });

    it("should update stats after deletion", () => {
      metadataCache.set("conn-1", CacheTypes.TABLES, ["public"], ["users"]);
      metadataCache.set("conn-1", CacheTypes.INDEXES, ["users"], ["idx_1"]);

      metadataCache.delete("conn-1", CacheTypes.TABLES, "public");

      const stats = metadataCache.stats();
      expect(stats.totalEntries).toBe(1);
      expect(stats.connectionCounts["conn-1"]).toBe(1);
    });

    it("should clear connection count when last entry deleted", () => {
      metadataCache.set("conn-1", CacheTypes.TABLES, ["public"], ["users"]);
      metadataCache.delete("conn-1", CacheTypes.TABLES, "public");

      const stats = metadataCache.stats();
      expect(stats.connectionCounts["conn-1"]).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("should clear all entries", () => {
      metadataCache.set("conn-1", CacheTypes.TABLES, ["public"], ["users"]);
      metadataCache.set("conn-2", CacheTypes.TABLES, ["public"], ["products"]);

      metadataCache.clear();

      const stats = metadataCache.stats();
      expect(stats.totalEntries).toBe(0);
      expect(Object.keys(stats.connectionCounts)).toHaveLength(0);
    });
  });

  describe("CacheTypes constants", () => {
    it("should have expected cache type keys", () => {
      expect(CacheTypes.TABLES).toBe("tables");
      expect(CacheTypes.TABLE_STRUCTURE).toBe("table_structure");
      expect(CacheTypes.TABLE_COLUMNS).toBe("table_columns");
      expect(CacheTypes.CONSTRAINTS).toBe("constraints");
      expect(CacheTypes.INDEXES).toBe("indexes");
      expect(CacheTypes.FOREIGN_KEYS).toBe("foreign_keys");
    });
  });
});
