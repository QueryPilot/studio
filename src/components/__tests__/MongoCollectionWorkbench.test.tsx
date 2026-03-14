import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoCollectionWorkbench } from "../MongoCollectionWorkbench";
import type { TabMetadata } from "@/types/workbench";

const mocks = vi.hoisted(() => {
  const queryStates = new Map<string, Record<string, unknown>>();

  return {
    queryStates,
    updateTabMetadata: vi.fn(),
    loadTabStateAsync: vi.fn().mockResolvedValue(undefined),
    setQueryState: vi.fn((tabId: string, updates: Record<string, unknown>) => {
      const current = queryStates.get(tabId) ?? {};
      queryStates.set(tabId, { ...current, ...updates });
    }),
    stageCommand: vi.fn(),
    unstageCommand: vi.fn(),
    getTableKey: vi.fn(
      (target: { connectionId?: string; database?: string; table?: string }) =>
        `${target.connectionId ?? ""}:${target.database ?? ""}:${target.table ?? ""}`,
    ),
    sampleCollectionSchema: vi.fn().mockResolvedValue({
      sampleSize: 500,
      scannedCount: 12,
      fields: [
        {
          path: "email",
          occurrences: 12,
          nullCount: 0,
          types: ["string"],
          sampleValues: ["ada@example.com"],
        },
      ],
    }),
    getCollectionMetadata: vi.fn().mockResolvedValue({
      name: "users",
      validator: { $jsonSchema: { bsonType: "object" } },
      validationLevel: "strict",
      validationAction: "error",
      stats: { count: 42 },
    }),
    listIndexes: vi.fn().mockResolvedValue([]),
    getIndexUsageStats: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/stores/workbenchStore", () => ({
  default: (selector: (state: { updateTabMetadata: typeof mocks.updateTabMetadata }) => unknown) =>
    selector({
      updateTabMetadata: mocks.updateTabMetadata,
    }),
}));

vi.mock("@/stores/tabStateStore", () => ({
  useTabStateStore: (
    selector: (state: {
      loadTabStateAsync: typeof mocks.loadTabStateAsync;
      setQueryState: typeof mocks.setQueryState;
      queryStates: typeof mocks.queryStates;
    }) => unknown,
  ) =>
    selector({
      loadTabStateAsync: mocks.loadTabStateAsync,
      setQueryState: mocks.setQueryState,
      queryStates: mocks.queryStates,
    }),
}));

vi.mock("@/stores/crudStore", () => ({
  useCrudStore: (
    selector: (state: {
      stageCommand: typeof mocks.stageCommand;
      unstageCommand: typeof mocks.unstageCommand;
      getTableKey: typeof mocks.getTableKey;
      stagedCommands: Map<string, unknown[]>;
    }) => unknown,
  ) =>
    selector({
      stageCommand: mocks.stageCommand,
      unstageCommand: mocks.unstageCommand,
      getTableKey: mocks.getTableKey,
      stagedCommands: new Map(),
    }),
}));

vi.mock("@/components/DataGrid/stores/gridPreferencesStore", () => ({
  useGridPreferencesStore: (
    selector: (state: {
      preferences: Record<string, { sortColumns?: Array<{ columnId: string; direction: "asc" | "desc" }> }>;
    }) => unknown,
  ) =>
    selector({
      preferences: {},
    }),
}));

vi.mock("@/adapters/mongodb/MongoDBAdapter", () => ({
  MongoDBAdapter: class MongoDBAdapter {
    sampleCollectionSchema(...args: unknown[]) {
      return mocks.sampleCollectionSchema(...args);
    }
    getCollectionMetadata(...args: unknown[]) {
      return mocks.getCollectionMetadata(...args);
    }
    listIndexes(...args: unknown[]) {
      return mocks.listIndexes(...args);
    }
    getIndexUsageStats(...args: unknown[]) {
      return mocks.getIndexUsageStats(...args);
    }
  },
}));

vi.mock("@/components/DataGrid", () => ({
  DocumentDataGrid: () => <div data-testid="document-data-grid" />,
}));

vi.mock("@/components/MongoQueryPanel/MongoResultViewer", () => ({
  MongoResultViewer: () => <div data-testid="mongo-result-viewer" />,
}));

const baseMetadata: TabMetadata = {
  type: "mongo-collection",
  title: "users",
  connectionId: "conn-1",
  database: "app-db",
  table: "users",
};

function renderWorkbench(viewType: TabMetadata["viewType"]) {
  return render(
    <MongoCollectionWorkbench
      panelId="panel-1"
      tabId={`tab-${String(viewType)}`}
      metadata={{ ...baseMetadata, viewType }}
      focused={true}
    />,
  );
}

describe("MongoCollectionWorkbench", () => {
  beforeEach(() => {
    mocks.queryStates.clear();
    vi.clearAllMocks();
    mocks.loadTabStateAsync.mockResolvedValue(undefined);
    mocks.sampleCollectionSchema.mockResolvedValue({
      sampleSize: 500,
      scannedCount: 12,
      fields: [
        {
          path: "email",
          occurrences: 12,
          nullCount: 0,
          types: ["string"],
          sampleValues: ["ada@example.com"],
        },
      ],
    });
    mocks.getCollectionMetadata.mockResolvedValue({
      name: "users",
      validator: { $jsonSchema: { bsonType: "object" } },
      validationLevel: "strict",
      validationAction: "error",
      stats: { count: 42 },
    });
    mocks.listIndexes.mockResolvedValue([]);
    mocks.getIndexUsageStats.mockResolvedValue([]);
  });

  it("uses shared ui inputs in the structure view controls", async () => {
    renderWorkbench("structure");

    await waitFor(() => {
      expect(mocks.sampleCollectionSchema).toHaveBeenCalled();
    });

    expect(screen.getByLabelText("Sample size")).toHaveAttribute("data-slot", "input");
    expect(screen.getByLabelText("Max depth")).toHaveAttribute("data-slot", "input");
  });

  it("uses shared selects and checkboxes in the indexes view", async () => {
    const { container } = renderWorkbench("indexes");

    await waitFor(() => {
      expect(mocks.listIndexes).toHaveBeenCalled();
    });

    expect(screen.getByLabelText("Index name")).toHaveAttribute("data-slot", "input");
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelectorAll('[data-slot="select-trigger"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="checkbox"]')).toHaveLength(2);
  });

  it("uses shared selects and codemirror editor in the validation view", async () => {
    const { container } = renderWorkbench("validation");

    await waitFor(() => {
      expect(mocks.getCollectionMetadata).toHaveBeenCalled();
    });

    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelectorAll('[data-slot="select-trigger"]')).toHaveLength(2);
    // Validation JSON is now edited with CodeMirror instead of a plain textarea
    expect(container.querySelector(".cm-editor")).toBeTruthy();
  });
});
