import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  persistTabState,
  loadTabState,
  loadAllTabStates,
  removePersistedTabState,
  clearAllTabStates,
  migrateFromLocalStorage,
  type PersistedTabState,
} from "../tabState";

describe("tabState IndexedDB persistence", () => {
  beforeEach(async () => {
    // Clear IndexedDB before each test
    await clearAllTabStates();
    // Clear localStorage
    localStorage.clear();
  });

  describe("persistTabState", () => {
    it("should save state to IndexedDB", async () => {
      const tabId = "test-tab-1";
      await persistTabState(tabId, {
        query: "SELECT * FROM users",
        lastExecutedQuery: "SELECT 1",
        viewMode: "json",
        selectedDialect: "postgresql",
      });

      const loaded = await loadTabState(tabId);
      expect(loaded).not.toBeNull();
      expect(loaded?.tabId).toBe(tabId);
      expect(loaded?.query).toBe("SELECT * FROM users");
      expect(loaded?.lastExecutedQuery).toBe("SELECT 1");
      expect(loaded?.viewMode).toBe("json");
      expect(loaded?.selectedDialect).toBe("postgresql");
    });

    it("should overwrite entire record on partial update", async () => {
      const tabId = "test-tab-2";

      // First save with all fields
      await persistTabState(tabId, {
        query: "SELECT * FROM users",
        lastExecutedQuery: "SELECT 1",
        viewMode: "table",
        selectedDialect: "postgresql",
      });

      // Partial update — persistTabState does a full put, not a merge.
      // The caller (schedulePersistence) is responsible for passing all fields.
      await persistTabState(tabId, {
        query: "SELECT * FROM posts",
      });

      const loaded = await loadTabState(tabId);
      expect(loaded?.query).toBe("SELECT * FROM posts");
      expect(loaded?.lastExecutedQuery).toBe(""); // defaults, not preserved
      expect(loaded?.viewMode).toBe("table"); // default
      expect(loaded?.selectedDialect).toBe("auto"); // default
    });

    it("should use default values for missing fields", async () => {
      const tabId = "test-tab-3";
      await persistTabState(tabId, {
        query: "SELECT 1",
      });

      const loaded = await loadTabState(tabId);
      expect(loaded?.query).toBe("SELECT 1");
      expect(loaded?.lastExecutedQuery).toBe("");
      expect(loaded?.viewMode).toBe("table");
      expect(loaded?.selectedDialect).toBe("auto");
    });

    it("should handle very long queries", async () => {
      const tabId = "long-query-tab";
      const longQuery =
        "SELECT * FROM table WHERE " +
        "condition AND ".repeat(1000) +
        "final = true";

      await persistTabState(tabId, { query: longQuery });

      const loaded = await loadTabState(tabId);
      expect(loaded?.query).toBe(longQuery);
    });
  });

  describe("loadTabState", () => {
    it("should return null for non-existent tab", async () => {
      const loaded = await loadTabState("non-existent-tab");
      expect(loaded).toBeNull();
    });

    it("should load previously persisted state", async () => {
      const tabId = "load-tab-1";
      const state: PersistedTabState = {
        tabId,
        query: "SELECT * FROM orders",
        lastExecutedQuery: "SELECT COUNT(*) FROM orders",
        viewMode: "explain",
        selectedDialect: "mysql",
      };

      await persistTabState(tabId, state);

      const loaded = await loadTabState(tabId);
      expect(loaded).toEqual(state);
    });
  });

  describe("loadAllTabStates", () => {
    it("should return empty map when no states exist", async () => {
      const allStates = await loadAllTabStates();
      expect(allStates.size).toBe(0);
    });

    it("should return all persisted states", async () => {
      await persistTabState("tab-1", { query: "SELECT 1" });
      await persistTabState("tab-2", { query: "SELECT 2" });
      await persistTabState("tab-3", { query: "SELECT 3" });

      const allStates = await loadAllTabStates();
      expect(allStates.size).toBe(3);
      expect(allStates.get("tab-1")?.query).toBe("SELECT 1");
      expect(allStates.get("tab-2")?.query).toBe("SELECT 2");
      expect(allStates.get("tab-3")?.query).toBe("SELECT 3");
    });
  });

  describe("removePersistedTabState", () => {
    it("should remove state from IndexedDB", async () => {
      const tabId = "remove-tab-1";
      await persistTabState(tabId, { query: "SELECT 1" });

      const before = await loadTabState(tabId);
      expect(before).not.toBeNull();

      await removePersistedTabState(tabId);

      const after = await loadTabState(tabId);
      expect(after).toBeNull();
    });

    it("should not error when removing non-existent tab", async () => {
      await expect(
        removePersistedTabState("non-existent-tab")
      ).resolves.not.toThrow();
    });
  });

  describe("clearAllTabStates", () => {
    it("should remove all states from IndexedDB", async () => {
      await persistTabState("tab-1", { query: "SELECT 1" });
      await persistTabState("tab-2", { query: "SELECT 2" });

      const before = await loadAllTabStates();
      expect(before.size).toBe(2);

      await clearAllTabStates();

      const after = await loadAllTabStates();
      expect(after.size).toBe(0);
    });
  });

  describe("migrateFromLocalStorage", () => {
    it("should migrate tab states from localStorage to IndexedDB", async () => {
      // Set up localStorage data (simulating old app data)
      const state1: PersistedTabState = {
        tabId: "migrate-tab-1",
        query: "SELECT * FROM users",
        lastExecutedQuery: "SELECT 1",
        viewMode: "table",
        selectedDialect: "postgresql",
      };
      const state2: PersistedTabState = {
        tabId: "migrate-tab-2",
        query: "SELECT * FROM posts",
        lastExecutedQuery: "",
        viewMode: "json",
        selectedDialect: "mysql",
      };

      localStorage.setItem("tab-state-migrate-tab-1", JSON.stringify(state1));
      localStorage.setItem("tab-state-migrate-tab-2", JSON.stringify(state2));

      const migratedCount = await migrateFromLocalStorage();

      expect(migratedCount).toBe(2);

      // Verify data is in IndexedDB
      const loaded1 = await loadTabState("migrate-tab-1");
      const loaded2 = await loadTabState("migrate-tab-2");

      expect(loaded1?.query).toBe("SELECT * FROM users");
      expect(loaded2?.query).toBe("SELECT * FROM posts");

      // Verify localStorage is cleared
      expect(localStorage.getItem("tab-state-migrate-tab-1")).toBeNull();
      expect(localStorage.getItem("tab-state-migrate-tab-2")).toBeNull();
    });

    it("should skip corrupted localStorage entries", async () => {
      localStorage.setItem("tab-state-corrupt-tab", "not valid json{{{");
      localStorage.setItem(
        "tab-state-valid-tab",
        JSON.stringify({
          tabId: "valid-tab",
          query: "SELECT 1",
          lastExecutedQuery: "",
          viewMode: "table",
          selectedDialect: "auto",
        })
      );

      const migratedCount = await migrateFromLocalStorage();

      expect(migratedCount).toBe(1);

      // Valid one should be migrated
      const loaded = await loadTabState("valid-tab");
      expect(loaded?.query).toBe("SELECT 1");

      // Corrupted one should be removed from localStorage but not in IndexedDB
      expect(localStorage.getItem("tab-state-corrupt-tab")).toBeNull();
      const corrupt = await loadTabState("corrupt-tab");
      expect(corrupt).toBeNull();
    });

    it("should not migrate if already in IndexedDB", async () => {
      // Pre-populate IndexedDB
      await persistTabState("existing-tab", {
        query: "INDEXEDDB VERSION",
      });

      // Set up localStorage with different data
      localStorage.setItem(
        "tab-state-existing-tab",
        JSON.stringify({
          tabId: "existing-tab",
          query: "LOCALSTORAGE VERSION",
          lastExecutedQuery: "",
          viewMode: "table",
          selectedDialect: "auto",
        })
      );

      await migrateFromLocalStorage();

      // Should keep IndexedDB version
      const loaded = await loadTabState("existing-tab");
      expect(loaded?.query).toBe("INDEXEDDB VERSION");
    });

    it("should return 0 when no localStorage data exists", async () => {
      const migratedCount = await migrateFromLocalStorage();
      expect(migratedCount).toBe(0);
    });

    it("should ignore non-tab-state localStorage keys", async () => {
      localStorage.setItem("other-key", "some value");
      localStorage.setItem("query-pilot-theme", "dark");

      const migratedCount = await migrateFromLocalStorage();
      expect(migratedCount).toBe(0);

      // Other keys should still exist
      expect(localStorage.getItem("other-key")).toBe("some value");
      expect(localStorage.getItem("query-pilot-theme")).toBe("dark");
    });
  });

  describe("concurrent operations", () => {
    it("should handle multiple concurrent writes", async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(persistTabState(`concurrent-tab-${i}`, { query: `SELECT ${i}` }));
      }

      await Promise.all(promises);

      const allStates = await loadAllTabStates();
      expect(allStates.size).toBe(10);
    });

    it("should handle concurrent read and write", async () => {
      await persistTabState("rw-tab", { query: "initial" });

      const [, loaded] = await Promise.all([
        persistTabState("rw-tab", { query: "updated" }),
        loadTabState("rw-tab"),
      ]);

      // The read might return either value depending on timing
      expect(["initial", "updated"]).toContain(loaded?.query);

      // Final read should return updated value
      const final = await loadTabState("rw-tab");
      expect(final?.query).toBe("updated");
    });
  });
});
