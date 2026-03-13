/**
 * AI Command Executor Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  executeCommand,
  formatResultForConversation,
  executeCommandWithTimeout,
  executeCommandsInParallel,
  formatBatchedResultsForAgent,
  type CommandResult,
  type BatchExecutionResult,
} from "../aiCommandExecutor";
import type {
  ParsedCommand,
  CrudStageParams,
  TabUpdateContentParams,
  TabCreateParams,
  EditorInsertParams,
  GridSetFilterParams,
  GridSetSortParams,
  GridSetViewParams,
} from "@/types/aiCommands";

const { mockBackendQuery, mockConnectById } = vi.hoisted(() => ({
  mockBackendQuery: vi.fn(),
  mockConnectById: vi.fn(() =>
    Promise.resolve({
      connection_id: "test-conn-id",
      server_version: null,
    }),
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/services/backend", () => ({
  BackendAPI: {
    query: mockBackendQuery,
  },
}));

vi.mock("@/services/databaseService", () => ({
  databaseService: {
    connectById: mockConnectById,
  },
}));

const mockPanelContents = new Map<string, {
  tabIds: string[];
  activeTabId: string;
  metadata: Record<string, Record<string, unknown>>;
}>([
  [
    "panel-1",
    {
      tabIds: ["tab-1"],
      activeTabId: "tab-1",
      metadata: {
        "tab-1": {
          type: "table",
          title: "Users",
          connectionId: "test-conn-id",
          database: "testdb",
          schema: "public",
          table: "users",
          sql: "SELECT 1",
        },
      },
    },
  ],
]);

const mockQueryStates = new Map<string, Record<string, unknown>>([
  ["tab-1", { query: "SELECT 1" }],
]);

const mockCrudState = {
  getTableKey: vi.fn(() => "conn:db:schema:table"),
  stageCommand: vi.fn(),
  stageAiQueryIntent: vi.fn((intent: Record<string, unknown>) => ({
    staged: true,
    intent: {
      id: "ai-intent-1",
      kind: "query.run",
      committable: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...intent,
    },
  })),
  commandIndex: new Map<string, string>(),
  stagedCommands: new Map<string, Array<Record<string, unknown>>>([
    ["test-conn-id:testdb:public:users", [{ id: "cmd-1" }]],
  ]),
  unstageCommand: vi.fn(),
  discardChanges: vi.fn(),
  discardAll: vi.fn(),
};

const mockWorkbenchState = {
  panelContents: mockPanelContents,
  initializeLayout: vi.fn(),
  addTab: vi.fn((panelId: string, tabId: string, metadata?: Record<string, unknown>) => {
    const panel = mockPanelContents.get(panelId);
    if (!panel) return;
    panel.tabIds.push(tabId);
    panel.activeTabId = tabId;
    panel.metadata[tabId] = metadata ?? {};
  }),
  setActiveTab: vi.fn((panelId: string, tabId: string) => {
    const panel = mockPanelContents.get(panelId);
    if (!panel) return;
    panel.activeTabId = tabId;
  }),
  focusPanel: vi.fn(),
  updateTabMetadata: vi.fn((panelId: string, tabId: string, updates: Record<string, unknown>) => {
    const panel = mockPanelContents.get(panelId);
    if (!panel) return;
    panel.metadata[tabId] = {
      ...(panel.metadata[tabId] ?? {}),
      ...updates,
    };
  }),
};

const mockPanelFocusState = {
  focusedPanelId: "panel-1",
};

const mockTabStateStore = {
  getQueryState: vi.fn((tabId: string) => mockQueryStates.get(tabId)),
  setQueryState: vi.fn((tabId: string, updates: Record<string, unknown>) => {
    const current = mockQueryStates.get(tabId) ?? {};
    mockQueryStates.set(tabId, { ...current, ...updates });
  }),
};

const mockGridPreferencesStore = {
  preferences: {} as Record<string, {
    quickFilter?: { value: string; mode: string };
    sortColumns?: Array<{ columnId: string; direction: "asc" | "desc" }>;
  }>,
  setQuickFilter: vi.fn((gridId: string, filter: { value: string; mode: string }) => {
    mockGridPreferencesStore.preferences[gridId] = {
      ...mockGridPreferencesStore.preferences[gridId],
      quickFilter: filter,
    };
  }),
  upsert: vi.fn((gridId: string, updater: (draft: { sortColumns?: Array<{ columnId: string; direction: "asc" | "desc" }> }) => void) => {
    const current = mockGridPreferencesStore.preferences[gridId] ?? {};
    const draft = { ...current };
    updater(draft);
    mockGridPreferencesStore.preferences[gridId] = {
      ...current,
      ...draft,
    };
  }),
};

const mockEditorRef = {
  setValue: vi.fn(),
  replaceSelection: vi.fn(),
  getValue: vi.fn(() => "SELECT 1\n-- inserted"),
};

const mockFocusedEditor = {
  id: "panel-1:tab-1",
  connectionId: "test-conn-id",
  database: "testdb",
  schema: "public",
  getRef: vi.fn(() => mockEditorRef),
};

vi.mock("@/stores/crudStore", () => ({
  useCrudStore: {
    getState: () => mockCrudState,
  },
}));

vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: {
    getState: () => ({
      connections: [
        { profile: { id: "test-conn-id", name: "Test Connection", db_type: "PostgreSQL" } },
        { profile: { id: "mongo-conn", name: "Mongo", db_type: "MongoDB" } },
        { profile: { id: "redis-conn", name: "Redis", db_type: "Redis" } },
      ],
      getConnection: (id: string) => {
        if (id === "test-conn-id") {
          return { profile: { id: "test-conn-id", db_type: "PostgreSQL" } };
        }
        if (id === "mongo-conn") {
          return { profile: { id: "mongo-conn", db_type: "MongoDB" } };
        }
        if (id === "redis-conn") {
          return { profile: { id: "redis-conn", db_type: "Redis" } };
        }
        return undefined;
      },
    }),
  },
}));

vi.mock("@/stores/workbenchStore", () => ({
  default: {
    getState: () => mockWorkbenchState,
  },
}));

vi.mock("@/stores/panelFocusStore", () => ({
  usePanelFocusStore: {
    getState: () => mockPanelFocusState,
  },
}));

vi.mock("@/stores/tabStateStore", () => ({
  useTabStateStore: {
    getState: () => mockTabStateStore,
  },
}));

vi.mock("@/components/DataGrid/stores/gridPreferencesStore", () => ({
  useGridPreferencesStore: {
    getState: () => mockGridPreferencesStore,
  },
}));

vi.mock("@/services/editorRegistry", () => ({
  editorRegistry: {
    getFocusedEditor: vi.fn(() => mockFocusedEditor),
  },
}));

// Mock nanoid for predictable IDs
vi.mock("nanoid", () => ({
  nanoid: () => "test-generated-id",
}));

function createCommand<T>(
  name: ParsedCommand["name"],
  params: T,
): ParsedCommand<T> {
  return {
    id: `cmd-${Date.now()}`,
    name,
    params,
    raw: `\`\`\`qp-action\n${JSON.stringify({ id: "cmd", name, params, approval: "auto" }, null, 2)}\n\`\`\``,
    startIndex: 0,
    endIndex: 100,
  };
}

describe("executeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBackendQuery.mockResolvedValue({
      columns: [{ name: "id" }, { name: "name" }],
      rows: [
        [1, "Alice"],
        [2, "Bob"],
      ],
    });
    mockPanelFocusState.focusedPanelId = "panel-1";
    mockPanelContents.clear();
    mockPanelContents.set("panel-1", {
      tabIds: ["tab-1"],
      activeTabId: "tab-1",
      metadata: {
        "tab-1": {
          type: "table",
          title: "Users",
          connectionId: "test-conn-id",
          database: "testdb",
          schema: "public",
          table: "users",
          sql: "SELECT 1",
        },
      },
    });
    mockQueryStates.clear();
    mockQueryStates.set("tab-1", { query: "SELECT 1" });
    mockGridPreferencesStore.preferences = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stages CRUD insert via crudStore", async () => {
    const command = createCommand<CrudStageParams>("crud.stage", {
      connectionId: "conn-123",
      database: "testdb",
      schema: "public",
      table: "users",
      operation: "insert",
      document: { name: "Alice" },
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(mockCrudState.stageCommand).toHaveBeenCalled();
  });

  it("updates tab content through tab.updateContent", async () => {
    const command = createCommand<TabUpdateContentParams>("tab.updateContent", {
      tabId: "tab-1",
      content: "SELECT * FROM users",
      title: "Updated",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(mockWorkbenchState.updateTabMetadata).toHaveBeenCalledWith(
      "panel-1",
      "tab-1",
      expect.objectContaining({
        title: "Updated",
        sql: "SELECT * FROM users",
      }),
    );
    expect(mockTabStateStore.setQueryState).toHaveBeenCalled();
  });

  it("creates new query tab with tab.create", async () => {
    const command = createCommand<TabCreateParams>("tab.create", {
      connectionId: "test-conn-id",
      title: "New Tab",
      content: "SELECT 42",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(mockWorkbenchState.addTab).toHaveBeenCalled();
    expect(mockWorkbenchState.setActiveTab).toHaveBeenCalled();
  });

  it("rejects tab.create when connection is unknown", async () => {
    const command = createCommand<TabCreateParams>("tab.create", {
      connectionId: "missing-conn",
      title: "Bad",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Connection not found");
    }
  });

  it("inserts text through focused editor for editor.insert", async () => {
    const command = createCommand<EditorInsertParams>("editor.insert", {
      text: "-- inserted",
      position: "cursor",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(mockEditorRef.replaceSelection).toHaveBeenCalledWith("-- inserted");
  });

  it("executes read-only SQL in query.run and returns result rows", async () => {
    const command = createCommand("query.run", {
      connectionId: "test-conn-id",
      query: "SELECT id, name FROM users",
      title: "Run Query",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(mockConnectById).toHaveBeenCalledWith("test-conn-id", undefined);
    expect(mockBackendQuery).toHaveBeenCalledWith(
      "test-conn-id",
      "SELECT id, name FROM users",
      undefined,
    );
    if (result.success) {
      expect(result.data).toEqual(
        expect.objectContaining({
          mode: "sql",
          rowCount: 2,
          columns: ["id", "name"],
        }),
      );
    }
  });

  it("rejects mutating SQL in query.run", async () => {
    const command = createCommand("query.run", {
      connectionId: "test-conn-id",
      query: "INSERT INTO users(id) VALUES (1)",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("read-only SQL");
    }
    expect(mockBackendQuery).not.toHaveBeenCalled();
  });

  it("rejects EXPLAIN ANALYZE over mutating SQL in query.run", async () => {
    const command = createCommand("query.run", {
      connectionId: "test-conn-id",
      query: "EXPLAIN ANALYZE DELETE FROM users WHERE id = 1",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("read-only SQL");
    }
    expect(mockBackendQuery).not.toHaveBeenCalled();
  });

  it("executes MongoDB read operation payloads in query.run", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      type: "documents",
      data: [{ _id: "1", name: "Alice" }],
    });

    const command = createCommand("query.run", {
      connectionId: "mongo-conn",
      query: JSON.stringify({
        type: "find",
        collection: "users",
        filter: {},
        limit: 10,
      }),
      language: "mongo",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "document_execute",
      expect.objectContaining({
        connId: "mongo-conn",
        database: null,
        operation: expect.objectContaining({
          type: "find",
          collection: "users",
        }),
      }),
    );
    if (result.success) {
      expect(result.data).toEqual(
        expect.objectContaining({
          mode: "document",
          rowCount: 1,
        }),
      );
    }
  });

  it("accepts case-insensitive MongoDB operation names in query.run", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      type: "count",
      data: 42,
    });

    const command = createCommand("query.run", {
      connectionId: "mongo-conn",
      query: JSON.stringify({
        operation: "Count",
        collection: "users",
        filter: {},
      }),
      language: "mongo",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "document_execute",
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "count",
          collection: "users",
        }),
      }),
    );
  });

  it("executes Redis read command payloads in query.run", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      type: "value",
      data: { type: "string", value: "ok" },
    });

    const command = createCommand("query.run", {
      connectionId: "redis-conn",
      query: "GET app:status",
      language: "redis",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "keyvalue_execute",
      expect.objectContaining({
        connId: "redis-conn",
        operation: {
          type: "executeRaw",
          command: "GET",
          args: ["app:status"],
        },
      }),
    );
    if (result.success) {
      expect(result.data).toEqual(
        expect.objectContaining({
          mode: "keyvalue",
          rowCount: 1,
          rows: [["ok"]],
        }),
      );
    }
  });

  it("rejects blocking Redis pub/sub commands in query.run", async () => {
    const command = createCommand("query.run", {
      connectionId: "redis-conn",
      query: "SUBSCRIBE updates",
      language: "redis",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("read-only Redis command");
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it("times out long-running Redis query.run operations", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise(() => undefined) as unknown as Promise<unknown>,
    );

    const command = createCommand("query.run", {
      connectionId: "redis-conn",
      query: "GET app:status",
      language: "redis",
      timeoutSecs: 1,
    });

    const pending = executeCommand(command);
    await vi.advanceTimersByTimeAsync(1_050);
    const result = await pending;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("timed out");
    }
    vi.useRealTimers();
  });

  it("applies grid.setFilter via grid preferences store", async () => {
    const command = createCommand<GridSetFilterParams>("grid.setFilter", {
      tabId: "tab-1",
      filter: "name = 'alice'",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(mockGridPreferencesStore.setQuickFilter).toHaveBeenCalled();
  });

  it("applies grid.setSort via grid preferences store", async () => {
    const command = createCommand<GridSetSortParams>("grid.setSort", {
      tabId: "tab-1",
      column: "created_at",
      direction: "desc",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(mockGridPreferencesStore.upsert).toHaveBeenCalled();
  });

  it("applies grid.setView by updating tab metadata", async () => {
    const command = createCommand<GridSetViewParams>("grid.setView", {
      tabId: "tab-1",
      view: "structure",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(mockWorkbenchState.updateTabMetadata).toHaveBeenCalledWith(
      "panel-1",
      "tab-1",
      { viewType: "structure" },
    );
    expect(mockTabStateStore.setQueryState).toHaveBeenCalledWith(
      "tab-1",
      { tableViewType: "structure" },
    );
  });

  it("applies Mongo workbench views through grid.setView", async () => {
    const command = createCommand<GridSetViewParams>("grid.setView", {
      tabId: "tab-1",
      view: "aggregation",
    });

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    expect(mockWorkbenchState.updateTabMetadata).toHaveBeenCalledWith(
      "panel-1",
      "tab-1",
      { viewType: "aggregation" },
    );
    expect(mockTabStateStore.setQueryState).toHaveBeenCalledWith(
      "tab-1",
      { tableViewType: "aggregation" },
    );
  });

  it("returns focused tab context", async () => {
    const command = createCommand("workspace.getFocusedTab", {});

    const result = await executeCommand(command);

    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { tab: { tabId: string } | null };
      expect(data.tab?.tabId).toBe("tab-1");
    }
  });
});

describe("formatResultForConversation", () => {
  it("formats crud.stage success", () => {
    const command = createCommand<CrudStageParams>("crud.stage", {
      connectionId: "conn-123",
      table: "users",
      operation: "insert",
      document: { name: "Alice" },
    });

    const result: CommandResult = {
      success: true,
      data: {
        staged: true,
        commandId: "cmd-123",
        tableKey: "conn:db:schema:table",
      },
    };

    const formatted = formatResultForConversation(command, result);

    expect(formatted).toContain("Change staged");
    expect(formatted).toContain("cmd-123");
  });

  it("formats tab/update commands as done", () => {
    const command = createCommand<TabUpdateContentParams>("tab.updateContent", {
      content: "SELECT 1",
    });

    const result: CommandResult = {
      success: true,
      data: { success: true, tabId: "tab-1" },
    };

    const formatted = formatResultForConversation(command, result);
    expect(formatted).toContain("Done");
  });

  it("formats error result", () => {
    const command = createCommand<CrudStageParams>("crud.stage", {
      connectionId: "conn-123",
      table: "users",
      operation: "insert",
      document: {},
    });

    const result: CommandResult = {
      success: false,
      error: "Insert operation requires a non-empty document",
    };

    const formatted = formatResultForConversation(command, result);

    expect(formatted).toContain("Error");
    expect(formatted).toContain("non-empty document");
  });
});

describe("timeout and batch execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result within timeout", async () => {
    const command = createCommand<TabUpdateContentParams>("tab.updateContent", {
      content: "SELECT 1",
    });

    const resultPromise = executeCommandWithTimeout(command, 5000);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
  });

  it("executes multiple commands in parallel", async () => {
    const commands = [
      createCommand<TabUpdateContentParams>("tab.updateContent", {
        content: "SELECT 1",
      }),
      createCommand<EditorInsertParams>("editor.insert", { text: "SELECT 2" }),
    ];

    const result = await executeCommandsInParallel(commands, 30000);

    expect(result.results).toHaveLength(2);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
  });

  it("formats batch result summary", () => {
    const batchResult: BatchExecutionResult = {
      results: [
        {
          commandId: "cmd-1",
          commandName: "tab.updateContent",
          result: { success: true, data: { success: true, tabId: "tab-1" } },
          executionTimeMs: 100,
        },
        {
          commandId: "cmd-2",
          commandName: "editor.insert",
          result: { success: true, data: { success: true } },
          executionTimeMs: 80,
        },
      ],
      totalTimeMs: 150,
      successCount: 2,
      failureCount: 0,
    };

    const formatted = formatBatchedResultsForAgent(batchResult);

    expect(formatted).toContain("Batch Execution Complete");
    expect(formatted).toContain("150ms total");
    expect(formatted).toContain("**2** succeeded");
  });
});
