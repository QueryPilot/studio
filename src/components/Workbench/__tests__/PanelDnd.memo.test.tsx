import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockPanelContent = {
  activeTabId: string | null;
  tabIds: string[];
  metadata: Record<string, { type: string; title: string; connectionId: string }>;
};

let mockFocusedPanelId: string | null = null;
let mockPanelContent: MockPanelContent | undefined;
const renderCounts = new Map<string, number>();

const focusPanelMock = vi.fn();
const closePanelActionMock = vi.fn();
const splitPanelActionMock = vi.fn();
const executeCommandMock = vi.fn();

vi.mock("../PanelContentRenderer", () => ({
  PanelContentRenderer: ({
    tabId,
  }: {
    tabId: string;
  }) => {
    renderCounts.set(tabId, (renderCounts.get(tabId) ?? 0) + 1);
    return <div data-testid={`panel-content-${tabId}`}>{tabId}</div>;
  },
}));

vi.mock("../DraggableTab", () => ({
  DraggableTab: ({ tabId }: { tabId: string }) => <div>{tabId}</div>,
}));

vi.mock("@/hooks/usePanelContent", () => ({
  usePanelContent: () => mockPanelContent,
}));

vi.mock("@/stores/panelFocusStore", () => ({
  usePanelFocusStore: Object.assign(
    (selector: (state: { focusedPanelId: string | null }) => unknown) =>
      selector({ focusedPanelId: mockFocusedPanelId }),
    {
      getState: () => ({ focusedPanelId: mockFocusedPanelId }),
    },
  ),
}));

vi.mock("@/stores/workbenchStore", () => {
  type WorkbenchStoreState = {
    focusPanel: typeof focusPanelMock;
    closePanelAction: typeof closePanelActionMock;
    splitPanelAction: typeof splitPanelActionMock;
    panelContents: Map<string, unknown>;
  };

  const store = ((
    selector: (state: WorkbenchStoreState) => unknown,
  ) =>
    selector({
      focusPanel: focusPanelMock,
      closePanelAction: closePanelActionMock,
      splitPanelAction: splitPanelActionMock,
      panelContents: new Map([["panel-1", mockPanelContent]]),
    })) as ((selector: (state: WorkbenchStoreState) => unknown) => unknown) & {
    getState: () => WorkbenchStoreState;
  };

  store.getState = () => ({
    focusPanel: focusPanelMock,
    closePanelAction: closePanelActionMock,
    splitPanelAction: splitPanelActionMock,
    panelContents: new Map([["panel-1", mockPanelContent]]),
  });

  return { default: store };
});

vi.mock("@/stores/dragStore", () => ({
  useDragStore: (selector: (state: {
    isDragActive: boolean;
    sourcePanelId: string | null;
  }) => unknown) =>
    selector({
      isDragActive: false,
      sourcePanelId: null,
    }),
}));

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: Object.assign(
    (selector: (state: { getConnection: () => null }) => unknown) =>
      selector({ getConnection: () => null }),
    {
      getState: () => ({ getConnection: () => null }),
    },
  ),
}));

vi.mock("@/stores/workspaceBundleStore", () => ({
  useWorkspaceBundleStore: (selector: (state: {
    activeWorkspace: { config: { connectionIds: string[] } } | null;
  }) => unknown) =>
    selector({
      activeWorkspace: { config: { connectionIds: [] } },
    }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ render }: { render: React.ReactNode }) => <div>{render}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <div />,
  DropdownMenuShortcut: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/kbd", () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
  KbdGroup: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/services/commandService", () => ({
  commandService: {
    execute: (...args: unknown[]) => executeCommandMock(...args),
  },
}));

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({
    isOver: false,
    setNodeRef: () => undefined,
  }),
}));

import { Panel } from "../PanelDnd";

describe("Panel hidden tab memoization", () => {
  beforeEach(() => {
    mockFocusedPanelId = null;
    mockPanelContent = {
      activeTabId: "tab-hidden",
      tabIds: ["tab-hidden", "tab-active"],
      metadata: {
        "tab-hidden": {
          type: "query",
          title: "Hidden Query",
          connectionId: "conn-1",
        },
        "tab-active": {
          type: "query",
          title: "Active Query",
          connectionId: "conn-1",
        },
      },
    };
    renderCounts.clear();
    vi.clearAllMocks();
  });

  it("does not rerender an inactive mounted tab when only panel focus changes", async () => {
    const { rerender } = render(<Panel panelId="panel-1" className="phase-1" />);

    await waitFor(() => {
      expect(renderCounts.get("tab-hidden")).toBe(1);
    });

    if (!mockPanelContent) {
      throw new Error("Expected mock panel content");
    }

    mockPanelContent.activeTabId = "tab-active";
    rerender(<Panel panelId="panel-1" className="phase-2" />);

    let hiddenRenderCountAfterSwitch = 0;
    await waitFor(() => {
      hiddenRenderCountAfterSwitch = renderCounts.get("tab-hidden") ?? 0;
      expect(hiddenRenderCountAfterSwitch).toBeGreaterThan(0);
      expect(renderCounts.get("tab-active")).toBeGreaterThan(0);
    });

    mockFocusedPanelId = "panel-1";
    rerender(<Panel panelId="panel-1" className="phase-3" />);

    expect(renderCounts.get("tab-hidden")).toBe(hiddenRenderCountAfterSwitch);
    expect(renderCounts.get("tab-active")).toBe(2);
  });
});
