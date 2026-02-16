import { describe, expect, it } from "vitest";
import { buildIsolatedGridPreferenceSnapshot } from "../gridPreferenceIsolation";
import type { GridPreferences } from "../../stores";

function createPreferences(): GridPreferences {
  return {
    columns: {
      order: ["id", "name"],
      widths: { id: 120, name: 220 },
      visibility: { id: true, name: true },
      pinned: ["id"],
    },
    view: {
      selection: undefined,
      activeCell: null,
      scrollOffset: { x: 0, y: 0 },
      pinnedColumns: [],
      pinnedRows: [],
    },
    pinnedRows: ["pk-1"],
    sortColumns: [{ columnId: "name", direction: "asc" }],
    quickFilter: { value: "status = 'active'", mode: "where" },
    structureSearch: "name",
    draftRows: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("buildIsolatedGridPreferenceSnapshot", () => {
  it("returns null for missing preferences", () => {
    expect(buildIsolatedGridPreferenceSnapshot(undefined)).toBeNull();
  });

  it("clones sync-related preference fields without shared references", () => {
    const source = createPreferences();
    const snapshot = buildIsolatedGridPreferenceSnapshot(source);

    expect(snapshot).not.toBeNull();
    expect(snapshot).toEqual({
      columns: source.columns,
      pinnedRows: source.pinnedRows,
      sortColumns: source.sortColumns,
      quickFilter: source.quickFilter,
      structureSearch: source.structureSearch,
    });

    if (!snapshot) {
      throw new Error("Expected snapshot to be defined");
    }

    // Mutating snapshot must not mutate the source.
    snapshot.columns.order.push("email");
    snapshot.columns.widths.id = 300;
    snapshot.columns.visibility.name = false;
    snapshot.columns.pinned.push("name");
    snapshot.pinnedRows.push("pk-2");
    const firstSort = snapshot.sortColumns[0];
    if (firstSort) {
      firstSort.direction = "desc";
    }
    if (snapshot.quickFilter) {
      snapshot.quickFilter.value = "id > 10";
    }

    expect(source.columns.order).toEqual(["id", "name"]);
    expect(source.columns.widths.id).toBe(120);
    expect(source.columns.visibility.name).toBe(true);
    expect(source.columns.pinned).toEqual(["id"]);
    expect(source.pinnedRows).toEqual(["pk-1"]);
    expect(source.sortColumns[0]?.direction).toBe("asc");
    expect(source.quickFilter?.value).toBe("status = 'active'");
  });
});
