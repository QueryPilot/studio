import { describe, it, expect, beforeEach } from "vitest";
import {
  getSessionDatabase,
  type PersistedWorkspaceLayout,
  type PersistedAppState,
  type PersistedTabState,
} from "../sessionDb";

describe("sessionDb", () => {
  beforeEach(async () => {
    const db = getSessionDatabase();
    await db.workspaceLayouts.clear();
    await db.tabStates.clear();
    await db.appState.clear();
  });

  describe("database creation", () => {
    it("should create database with three tables", () => {
      const db = getSessionDatabase();
      const tableNames = db.tables.map((t) => t.name).sort();
      expect(tableNames).toEqual(["appState", "tabStates", "workspaceLayouts"]);
    });
  });

  describe("workspaceLayouts", () => {
    it("should persist and load a workspace layout", async () => {
      const db = getSessionDatabase();
      const now = Date.now();

      const layout: PersistedWorkspaceLayout = {
        workspaceId: "ws-1",
        layoutTree: {
          id: "root",
          type: "branch",
          orientation: "horizontal",
          children: [
            {
              id: "leaf-1",
              type: "leaf",
              content: {
                id: "panel-1",
                type: "editor",
                tabIds: ["tab-1"],
                activeTabId: "tab-1",
              },
            },
          ],
        },
        panelContents: [
          [
            "panel-1",
            {
              id: "panel-1",
              type: "editor",
              tabIds: ["tab-1"],
              activeTabId: "tab-1",
            },
          ],
        ],
        savedAt: now,
        lastActiveAt: now,
      };

      await db.workspaceLayouts.put(layout);

      const loaded = await db.workspaceLayouts.get("ws-1");
      expect(loaded).toEqual(layout);
    });

    it("should overwrite existing layout on put", async () => {
      const db = getSessionDatabase();

      const layout1: PersistedWorkspaceLayout = {
        workspaceId: "ws-1",
        layoutTree: { id: "root", type: "leaf" },
        panelContents: [],
        savedAt: 1000,
        lastActiveAt: 1000,
      };

      const layout2: PersistedWorkspaceLayout = {
        workspaceId: "ws-1",
        layoutTree: { id: "root-v2", type: "branch", orientation: "vertical" },
        panelContents: [],
        savedAt: 2000,
        lastActiveAt: 2000,
      };

      await db.workspaceLayouts.put(layout1);
      await db.workspaceLayouts.put(layout2);

      const loaded = await db.workspaceLayouts.get("ws-1");
      expect(loaded?.layoutTree.id).toBe("root-v2");
      expect(loaded?.savedAt).toBe(2000);
    });
  });

  describe("tabStates", () => {
    it("should persist and load a tab state by tabId", async () => {
      const db = getSessionDatabase();

      const tabState: PersistedTabState = { tabId: "tab-1", query: "SELECT 1" };
      await db.tabStates.put(tabState);

      const loaded = await db.tabStates.get("tab-1");
      expect(loaded?.tabId).toBe("tab-1");
    });
  });

  describe("appState", () => {
    it("should persist and load singleton app state", async () => {
      const db = getSessionDatabase();

      const state: PersistedAppState = {
        key: "singleton",
        lastActiveWorkspaceIds: ["ws-1", "ws-2"],
        windowStates: [
          {
            workspaceId: "ws-1",
            windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          },
          {
            workspaceId: "ws-2",
          },
        ],
        migrationVersion: 1,
      };

      await db.appState.put(state);

      const loaded = await db.appState.get("singleton");
      expect(loaded).toEqual(state);
    });

    it("should update singleton app state in place", async () => {
      const db = getSessionDatabase();

      const state1: PersistedAppState = {
        key: "singleton",
        lastActiveWorkspaceIds: ["ws-1"],
        windowStates: [{ workspaceId: "ws-1" }],
        migrationVersion: 1,
      };

      await db.appState.put(state1);

      const state2: PersistedAppState = {
        key: "singleton",
        lastActiveWorkspaceIds: ["ws-1", "ws-2", "ws-3"],
        windowStates: [
          { workspaceId: "ws-1" },
          { workspaceId: "ws-2" },
          { workspaceId: "ws-3" },
        ],
        migrationVersion: 2,
      };

      await db.appState.put(state2);

      const all = await db.appState.toArray();
      expect(all).toHaveLength(1);

      const loaded = await db.appState.get("singleton");
      expect(loaded?.lastActiveWorkspaceIds).toEqual(["ws-1", "ws-2", "ws-3"]);
      expect(loaded?.migrationVersion).toBe(2);
    });
  });

  describe("singleton pattern", () => {
    it("should return the same database instance on multiple calls", () => {
      const db1 = getSessionDatabase();
      const db2 = getSessionDatabase();
      expect(db1).toBe(db2);
    });
  });
});
