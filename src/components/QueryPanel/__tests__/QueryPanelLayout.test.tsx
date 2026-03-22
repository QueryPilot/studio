import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryPanelLayout } from "../QueryPanelLayout";

const observedTabGroupIds = vi.hoisted(() => [] as string[]);

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ tabGroupId, children }: { tabGroupId?: string; children: React.ReactNode }) => {
    observedTabGroupIds.push(tabGroupId ?? "");
    return <div data-testid={`tabs-${tabGroupId ?? "missing"}`}>{children}</div>;
  },
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button role="tab">{children}</button>,
}));

vi.mock("../QueryEditor", () => ({
  QueryEditor: () => <div data-testid="query-editor" />,
}));

vi.mock("../QueryToolbar", () => ({
  QueryToolbar: () => <div data-testid="query-toolbar" />,
}));

vi.mock("../QueryOutline", () => ({
  QueryOutline: () => null,
}));

vi.mock("../ResultViewer", () => ({
  ResultViewer: () => <div data-testid="result-viewer" />,
}));

describe("QueryPanelLayout", () => {
  beforeEach(() => {
    observedTabGroupIds.length = 0;
  });

  it("uses a unique result tab shortcut group for each query tab", () => {
    const baseProps = {
      panelContainerRef: React.createRef<HTMLDivElement>(),
      panelClassName: "",
      onPanelMouseDown: vi.fn(),
      inTransaction: false,
      editorRef: React.createRef(),
      effectiveConnectionId: "conn-1",
      database: "app",
      schema: "public",
      dbType: "postgres",
      query: "SELECT 1",
      onEditorChange: vi.fn(),
      onSelectionChange: vi.fn(),
      onExecute: vi.fn(),
      isExecuting: false,
      selectedDialect: "sql",
      onDialectDetected: vi.fn(),
      hasQuery: true,
      showResults: true,
      showOutline: false,
      focused: true,
      detectedDialect: "sql",
      runButtonLabel: "Run",
      onExecuteAll: vi.fn(),
      onCancel: vi.fn(),
      onBeautify: vi.fn(),
      onToggleResults: vi.fn(),
      onToggleOutline: vi.fn(),
      onDialectChange: vi.fn(),
      deferredQuery: "SELECT 1",
      onCloseOutline: vi.fn(),
      batchResults: [],
      activeBatchResultIndex: 0,
      onActiveBatchResultChange: vi.fn(),
      isBatchExecuting: false,
      displayedResult: { columns: [{ name: "id" }], rows: [[1]], rowCount: 1 },
      isStreaming: false,
      executionStatus: "success",
      queryGridId: "grid-1",
      activeResultMode: "table",
      activeSupportedModes: ["table", "json"],
      onModeChange: vi.fn(),
      onFixWithAI: vi.fn(),
      refreshNotice: undefined,
      onRefreshResults: undefined,
      showplanMode: null,
    } as const;

    render(
      <>
        <QueryPanelLayout
          {...(baseProps as unknown as React.ComponentProps<typeof QueryPanelLayout>)}
          {...({ resultTabGroupId: "query-result-view-mode:tab-1" } as object)}
        />
        <QueryPanelLayout
          {...(baseProps as unknown as React.ComponentProps<typeof QueryPanelLayout>)}
          {...({ resultTabGroupId: "query-result-view-mode:tab-2" } as object)}
        />
      </>,
    );

    expect(observedTabGroupIds).toContain("query-result-view-mode:tab-1");
    expect(observedTabGroupIds).toContain("query-result-view-mode:tab-2");
    expect(new Set(observedTabGroupIds).size).toBeGreaterThan(1);
  });
});
