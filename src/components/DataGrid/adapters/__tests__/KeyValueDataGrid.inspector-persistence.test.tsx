import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeyValueDataGrid } from "../KeyValueDataGrid";
import { useGridPreferencesStore } from "../../stores/gridPreferencesStore";

const {
  useKeyValueDataMock,
  stageCommandMock,
} = vi.hoisted(() => ({
  useKeyValueDataMock: vi.fn(),
  stageCommandMock: vi.fn(),
}));

const capturedBaseGridProps: Array<Record<string, unknown>> = [];

vi.mock("../../base/BaseDataGrid", () => ({
  BaseDataGrid: (props: Record<string, unknown>) => {
    capturedBaseGridProps.push(props);
    return <div data-testid="base-datagrid" />;
  },
}));

vi.mock("../../hooks/useKeyValueData", () => ({
  useKeyValueData: useKeyValueDataMock,
}));

vi.mock("@/stores/crudStore", () => ({
  useCrudStore: vi.fn((selector: (store: Record<string, unknown>) => unknown) =>
    selector({ stageCommand: stageCommandMock }),
  ),
}));

const makeKeyValueData = () => ({
  rows: [],
  columns: [],
  getCellContent: vi.fn(),
  isLoading: false,
  hasMore: false,
  fetchNextPage: vi.fn(),
  executionTime: undefined,
  error: null,
  isBrowserMode: true,
  commandFactory: undefined,
  createEditCommand: vi.fn(() => null),
  refetch: vi.fn(),
  pattern: "*",
  setPattern: vi.fn(),
  valueFilter: "",
  setValueFilter: vi.fn(),
  totalKeyCount: 0,
  loadedKeyCount: 0,
  allKeysLoaded: true,
  showLoadAll: false,
  loadAllKeys: vi.fn(),
  currentKey: undefined,
});

describe("KeyValueDataGrid inspector persistence", () => {
  beforeEach(() => {
    capturedBaseGridProps.length = 0;
    stageCommandMock.mockReset();
    useKeyValueDataMock.mockReturnValue(makeKeyValueData());
    useGridPreferencesStore.setState({ preferences: {} });
  });

  it("restores persisted inspector open state and tab", () => {
    useGridPreferencesStore.getState().setInspector("kv-grid", {
      open: true,
      tab: "raw",
    });

    render(
      <KeyValueDataGrid
        gridId="kv-grid"
        connectionId="conn"
        database={0}
      />,
    );

    const latestProps = capturedBaseGridProps.at(-1);
    expect(latestProps?.inspectorOpen).toBe(true);
    expect(latestProps?.inspectorDefaultTab).toBe("raw");
  });

  it("persists inspector changes back to preferences store", async () => {
    render(
      <KeyValueDataGrid
        gridId="kv-grid"
        connectionId="conn"
        database={0}
      />,
    );

    const latestProps = capturedBaseGridProps.at(-1) as
      | {
          onInspectorOpenChange?: (open: boolean) => void;
          onInspectorTabChange?: (tab: "tree" | "diff" | "raw") => void;
        }
      | undefined;

    expect(latestProps).toBeDefined();
    if (!latestProps) {
      throw new Error("Missing BaseDataGrid props");
    }

    act(() => {
      latestProps.onInspectorOpenChange?.(true);
      latestProps.onInspectorTabChange?.("diff");
    });

    await waitFor(() => {
      expect(
        useGridPreferencesStore.getState().preferences["kv-grid"]?.inspector,
      ).toEqual({
        open: true,
        tab: "diff",
      });
    });
  });
});
