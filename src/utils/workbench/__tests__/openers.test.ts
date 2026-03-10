import { beforeEach, describe, expect, it, vi } from "vitest";

const addTabMock = vi.hoisted(() => vi.fn());
const focusPanelMock = vi.hoisted(() => vi.fn());
const setActiveTabMock = vi.hoisted(() => vi.fn());

const panelContent = vi.hoisted(() => ({
  id: "panel-1",
  type: "editor",
  tabIds: [] as string[],
  activeTabId: "",
  metadata: {},
}));

const workbenchState = vi.hoisted(() => ({
  addTab: addTabMock,
  panelContents: new Map<string, typeof panelContent>([["panel-1", panelContent]]),
  focusPanel: focusPanelMock,
  setActiveTab: setActiveTabMock,
}));

const panelFocusState = vi.hoisted(() => ({
  focusedPanelId: "panel-1" as string | null,
}));

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

vi.mock("@/screens/workspace/components/sidebarContextMenuHelpers", () => ({
  buildMongoCollectionMetadataQuery: vi.fn(() => "{}"),
}));

import { openRedisCliTab } from "../openers";

describe("openers", () => {
  beforeEach(() => {
    addTabMock.mockClear();
    focusPanelMock.mockClear();
    setActiveTabMock.mockClear();
    panelFocusState.focusedPanelId = "panel-1";
    workbenchState.panelContents = new Map([["panel-1", panelContent]]);
  });

  it("opens redis cli tab with stable object key metadata for dedupe", () => {
    openRedisCliTab({
      connectionId: "conn-1",
      dbIndex: 2,
    });

    expect(addTabMock).toHaveBeenCalledTimes(1);
    const call = addTabMock.mock.calls[0];
    if (!call) {
      throw new Error("Expected addTab to be called");
    }
    const [panelId, tabId, metadata] = call;

    expect(panelId).toBe("panel-1");
    expect(tabId).toMatch(/^redis-cli-conn-1-db2:::/);
    expect(metadata).toMatchObject({
      type: "redis-cli",
      title: "Redis CLI - db2",
      connectionId: "conn-1",
      database: "2",
      objectKey: "redis-cli-conn-1-db2",
    });
    expect(setActiveTabMock).not.toHaveBeenCalled();
    expect(focusPanelMock).toHaveBeenCalledWith("panel-1");
  });
});
