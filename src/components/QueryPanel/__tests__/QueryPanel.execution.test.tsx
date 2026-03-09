import React, { forwardRef, useImperativeHandle } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface TabStateStoreMock {
  setQueryState: typeof setQueryStateMock;
  loadTabStateAsync: typeof loadTabStateAsyncMock;
  queryStates: Map<string, unknown>;
}

interface WorkbenchStoreMockState {
  updateTabMetadata: typeof updateTabMetadataMock;
  focusPanel: typeof focusPanelMock;
  panelContents: Map<string, unknown>;
}

interface PanelFocusStoreMockState {
  focusedPanelId: string;
}

const streamQueryMock = vi.hoisted(() => vi.fn());
const cancelMock = vi.hoisted(() => vi.fn());
const setQueryStateMock = vi.hoisted(() => vi.fn());
const loadTabStateAsyncMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const updateTabMetadataMock = vi.hoisted(() => vi.fn());
const focusPanelMock = vi.hoisted(() => vi.fn());
const getConnectionMock = vi.hoisted(() => vi.fn(() => ({ profile: { id: "profile-1" } })));

vi.mock("@/services/tableStreamingService", () => ({
  tableStreamingService: {
    streamQuery: (...args: unknown[]) => streamQueryMock(...args),
    cancel: (...args: unknown[]) => cancelMock(...args),
  },
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => <div />,
}));

vi.mock("../QueryEditor", () => ({
  QueryEditor: forwardRef(function MockQueryEditor(
    {
      value,
    }: {
      value?: string;
    },
    ref: React.ForwardedRef<{
      getSelection: () => string;
      getQueryAtCursor: () => string | undefined;
      getValue: () => string;
      format: () => void;
      focus: () => void;
      setCursorPosition: (_position: number) => void;
    }>,
  ) {
    useImperativeHandle(ref, () => ({
      getSelection: () => "",
      getQueryAtCursor: () => undefined,
      getValue: () => value ?? "SELECT 1",
      format: () => undefined,
      focus: () => undefined,
      setCursorPosition: () => undefined,
    }));

    return <div data-testid="query-editor" />;
  }),
}));

vi.mock("../QueryToolbar", () => ({
  QueryToolbar: ({
    onExecute,
    onCancel,
  }: {
    onExecute: () => void;
    onCancel: () => void;
  }) => (
    <div>
      <button type="button" onClick={onExecute}>
        Run
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

vi.mock("../ResultViewer", () => ({
  ResultViewer: ({
    executionStatus,
    onRefreshResults,
  }: {
    executionStatus?: string;
    onRefreshResults?: () => void;
  }) => (
    <div>
      <div data-testid="result-status">{executionStatus}</div>
      {onRefreshResults ? <button type="button">Refresh results</button> : null}
    </div>
  ),
}));

vi.mock("../QueryOutline", () => ({
  QueryOutline: () => null,
}));

vi.mock("@/components/QueryHistory", () => ({
  SaveQueryDialog: () => null,
}));

vi.mock("@/components/KeyboardProvider", () => ({
  useKeyboardServicesOptional: () => null,
}));

vi.mock("@/stores/tabStateStore", () => ({
  useTabStateStore: (selector: (state: TabStateStoreMock) => unknown) =>
    selector({
      setQueryState: setQueryStateMock,
      loadTabStateAsync: loadTabStateAsyncMock,
      queryStates: new Map(),
    }),
}));

vi.mock("@/stores/workbenchStore", () => {
  type WorkbenchStoreMock = ((
    selector: (state: WorkbenchStoreMockState) => unknown,
  ) => unknown) & {
    getState: () => Pick<WorkbenchStoreMockState, "focusPanel" | "panelContents">;
  };

  const store = ((selector: (state: WorkbenchStoreMockState) => unknown) =>
    selector({
      updateTabMetadata: updateTabMetadataMock,
      focusPanel: focusPanelMock,
      panelContents: new Map([["panel-1", {}]]),
    })) as WorkbenchStoreMock;
  store.getState = () => ({
    focusPanel: focusPanelMock,
    panelContents: new Map([["panel-1", {}]]),
  });
  return { default: store };
});

vi.mock("@/stores/panelFocusStore", () => ({
  usePanelFocusStore: Object.assign(
    (selector: (state: PanelFocusStoreMockState) => unknown) =>
      selector({
        focusedPanelId: "panel-1",
      }),
    {
      getState: () => ({ focusedPanelId: "panel-1" }),
    },
  ),
}));

vi.mock("@/stores/preferencesStore", () => ({
  usePreferencesStore: {
    getState: () => ({ queryTimeoutSecs: 30 }),
  },
}));

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: {
    getState: () => ({ getConnection: getConnectionMock }),
  },
}));

vi.mock("@/stores/dataInvalidationStore", () => ({
  useDataInvalidationStore: {
    getState: () => ({
      invalidateTable: vi.fn(),
      invalidateSchema: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/acpStore", () => ({
  useAcpStore: {
    getState: () => ({ openWithPrompt: vi.fn() }),
  },
}));

vi.mock("@/services/editorRegistry", () => ({
  editorRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    setFocusedEditor: vi.fn(),
    clearFocusedEditor: vi.fn(),
  },
}));

vi.mock("@/hooks/useRustSchemaSync", () => ({
  clearRustSchema: vi.fn().mockResolvedValue(undefined),
  syncSchemaToRust: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/CodeEditor/languages/sql/optimized-completion", () => ({
  clearCompletionCache: vi.fn(),
}));

vi.mock("@/components/CodeEditor/languages/sql/metadataProvider", () => ({
  clearProviderCache: vi.fn(),
}));

vi.mock("@/services/schemaCache", () => ({
  schemaCache: {
    invalidateSchema: vi.fn(),
  },
}));

vi.mock("@/services/queryTracker", () => ({
  trackQuery: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/aiContextService", () => ({
  trackQueryExecution: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/cacheManager", () => ({
  handleMutationCache: vi.fn(),
  isMutationQuery: () => false,
  isSelectQuery: () => true,
}));

vi.mock("@/utils/sqlParser", () => ({
  parseMutationTables: () => [],
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { QueryPanel } from "../QueryPanel";

describe("QueryPanel execution state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces a durable cancelled status after cancelling an in-flight query", async () => {
    let rejectStream: ((error: Error) => void) | null = null;

    streamQueryMock.mockImplementation(
      (
        _connectionId: string,
        _tabId: string,
        _sql: string,
        _pageSize: number | undefined,
        onProgress?: (progress: { started?: boolean }) => void,
      ) => {
        onProgress?.({ started: true });
        return new Promise((_, reject) => {
          rejectStream = reject;
        });
      },
    );

    cancelMock.mockImplementation(() => {
      rejectStream?.(new DOMException("Query cancelled", "AbortError"));
    });

    render(
      <QueryPanel
        panelId="panel-1"
        tabId="tab-1"
        connectionId="conn-1"
        database="app"
        initialSql="SELECT 1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(screen.getByTestId("result-status")).toHaveTextContent("streaming");
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.getByTestId("result-status")).toHaveTextContent("cancelled");
    });

    expect(
      screen.queryByRole("button", { name: "Refresh results" }),
    ).not.toBeInTheDocument();
  });

  it("keeps batch execution in the cancelled state after a user cancellation", async () => {
    let rejectActiveStream: ((error: Error) => void) | null = null;

    streamQueryMock.mockImplementation(
      (
        _connectionId: string,
        _tabId: string,
        sql: string,
        _pageSize: number | undefined,
        onProgress?: (progress: { started?: boolean; columns?: Array<{ name: string }> }) => void,
      ) => {
        const normalizedSql = sql.trim().toUpperCase();

        if (normalizedSql === "BEGIN" || normalizedSql === "ROLLBACK") {
          return Promise.resolve({
            columns: [],
            rows: [],
            totalRows: 0,
            executionTimeMs: 0,
          });
        }

        onProgress?.({
          started: true,
          columns: [{ name: "id" }],
        });

        return new Promise((_, reject) => {
          rejectActiveStream = reject;
        });
      },
    );

    cancelMock.mockImplementation(() => {
      rejectActiveStream?.(new DOMException("Query cancelled", "AbortError"));
    });

    render(
      <QueryPanel
        panelId="panel-1"
        tabId="tab-1"
        connectionId="conn-1"
        database="app"
        initialSql="SELECT 1; SELECT 2;"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(screen.getByTestId("result-status")).toHaveTextContent("executing");
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.getByTestId("result-status")).toHaveTextContent("cancelled");
    });
  });
});
