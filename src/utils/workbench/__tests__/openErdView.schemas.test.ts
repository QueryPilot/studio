import { describe, it, expect, beforeEach, vi } from "vitest";

const addTabMock = vi.hoisted(() => vi.fn());
const focusPanelMock = vi.hoisted(() => vi.fn());
const setActiveTabMock = vi.hoisted(() => vi.fn());
const updateTabMetadataMock = vi.hoisted(() => vi.fn());

const panelContent = vi.hoisted(() => ({
  id: "p1",
  type: "editor",
  tabIds: [] as string[],
  activeTabId: null,
  metadata: {} as Record<string, any>,
}));

const workbenchState = vi.hoisted(() => ({
  addTab: addTabMock,
  panelContents: new Map<string, typeof panelContent>([["p1", panelContent]]),
  focusPanel: focusPanelMock,
  setActiveTab: setActiveTabMock,
  updateTabMetadata: updateTabMetadataMock,
}));

const panelFocusState = vi.hoisted(() => ({
  focusedPanelId: "p1" as string | null,
}));

const getVisibleSchemasMock = vi.hoisted(() => vi.fn());

vi.mock("@/stores/workbenchStore", () => ({
  default: {
    getState: () => workbenchState,
  },
}));

vi.mock("@/stores/panelFocusStore", () => ({
  usePanelFocusStore: {
    getState: () => panelFocusState,
  },
}));

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: {
    getState: () => ({
      getVisibleSchemas: getVisibleSchemasMock,
    }),
  },
}));

vi.mock("@/screens/workspace/components/sidebarContextMenuHelpers", () => ({
  buildMongoCollectionMetadataQuery: vi.fn(() => "{}"),
}));

import { openErdView } from "@/utils/workbench/openers";

describe("openErdView seeds schemas from connection visibleSchemas", () => {
  beforeEach(() => {
    addTabMock.mockClear();
    focusPanelMock.mockClear();
    setActiveTabMock.mockClear();
    updateTabMetadataMock.mockClear();
    panelContent.tabIds = [];
    panelContent.metadata = {};
    workbenchState.panelContents = new Map([["p1", panelContent]]);
    panelFocusState.focusedPanelId = "p1";
    getVisibleSchemasMock.mockReturnValue(["public", "reporting"]);
  });

  it("writes schemas[] into ERD tab metadata", () => {
    openErdView({
      connectionId: "c1",
      connectionName: "Test",
      database: "db",
    });
    expect(addTabMock).toHaveBeenCalledTimes(1);
    const call0 = addTabMock.mock.calls[0];
    if (!call0) throw new Error("Expected addTab to be called");
    const [, , meta] = call0;
    expect(meta.schemas).toEqual(["public", "reporting"]);
  });

  it("seeds schemas = [] when getVisibleSchemas is empty (Trino case)", () => {
    getVisibleSchemasMock.mockReturnValue([]);
    openErdView({
      connectionId: "c2",
      connectionName: "Trino",
      database: "catalog",
    });
    expect(addTabMock).toHaveBeenCalledTimes(1);
    const call0 = addTabMock.mock.calls[0];
    if (!call0) throw new Error("Expected addTab to be called");
    const [, , meta] = call0;
    expect(meta.schemas).toEqual([]);
  });
});
