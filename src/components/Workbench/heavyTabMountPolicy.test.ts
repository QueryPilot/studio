import { describe, expect, it } from "vitest";
import { getMountedTabs, recordVisit } from "./heavyTabMountPolicy";

describe("heavyTabMountPolicy", () => {
  it("always keeps the active tab mounted", () => {
    const mountedTabs = getMountedTabs({
      activeTabId: "query-active",
      tabIds: ["query-active", "grid-1", "grid-2", "query-old"],
      recentOrder: ["grid-1", "grid-2", "query-old"],
      metadataByTab: {
        "query-active": { type: "query" },
        "grid-1": { type: "table", viewType: "data" },
        "grid-2": { type: "mongo-collection", viewType: "data" },
        "query-old": { type: "query" },
      },
    });

    expect(mountedTabs.has("query-active")).toBe(true);
  });

  it("prioritizes lighter data-grid tabs over heavier hidden query tabs within the panel budget", () => {
    const mountedTabs = getMountedTabs({
      activeTabId: "query-active",
      tabIds: ["query-active", "grid-a", "grid-b", "grid-c", "query-hidden"],
      recentOrder: ["grid-a", "grid-b", "grid-c", "query-hidden"],
      metadataByTab: {
        "query-active": { type: "query" },
        "grid-a": { type: "table", viewType: "data" },
        "grid-b": { type: "redis-key" },
        "grid-c": { type: "mongo-collection", viewType: "data" },
        "query-hidden": { type: "query" },
      },
    });

    expect(mountedTabs.has("grid-a")).toBe(true);
    expect(mountedTabs.has("grid-b")).toBe(true);
    expect(mountedTabs.has("grid-c")).toBe(true);
    expect(mountedTabs.has("query-hidden")).toBe(false);
  });

  it("does not retain non-heavy inactive subviews", () => {
    const mountedTabs = getMountedTabs({
      activeTabId: "query-active",
      tabIds: ["query-active", "table-data", "table-structure"],
      recentOrder: ["table-structure", "table-data"],
      metadataByTab: {
        "query-active": { type: "query" },
        "table-data": { type: "table", viewType: "data" },
        "table-structure": { type: "table", viewType: "structure" },
      },
    });

    expect(mountedTabs.has("table-data")).toBe(true);
    expect(mountedTabs.has("table-structure")).toBe(false);
  });

  it("records visits in most-recent-first order without duplicates", () => {
    expect(recordVisit(["tab-2", "tab-1"], "tab-1")).toEqual(["tab-1", "tab-2"]);
  });
});
