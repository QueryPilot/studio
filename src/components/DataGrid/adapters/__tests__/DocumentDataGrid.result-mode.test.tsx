import type { ReactElement, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentDataGrid } from "../DocumentDataGrid";

const mocks = vi.hoisted(() => ({
  useDocumentData: vi.fn(),
  baseDataGrid: vi.fn(),
}));

vi.mock("../../hooks/useDocumentData", () => ({
  useDocumentData: (...args: unknown[]) => mocks.useDocumentData(...args),
}));

vi.mock("../../base/BaseDataGrid", () => ({
  BaseDataGrid: (props: {
    topToolbar?: ReactNode;
    toolbarActions?: ReactNode;
  }) => {
    mocks.baseDataGrid(props);
    return (
      <div data-testid="base-datagrid">
        {props.topToolbar}
        {props.toolbarActions}
      </div>
    );
  },
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderWithProviders = (ui: ReactElement) => {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
};

describe("DocumentDataGrid result mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDocumentData.mockReturnValue({
      paradigm: "document",
      rows: [],
      columns: [
        {
          id: "_id",
          field: "_id",
          title: "_id",
          name: "_id",
          width: 180,
          type: "text",
        },
      ],
      getCellContent: vi.fn(),
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn().mockResolvedValue(undefined),
      executionTime: 0,
      currentPath: [],
      canStepInto: vi.fn().mockReturnValue(false),
      stepInto: vi.fn(),
      stepOut: vi.fn(),
      navigateToPath: vi.fn(),
      getCurrentDocumentId: vi.fn().mockReturnValue(null),
      totalCount: 0,
      schemaSample: undefined,
      createEditCommand: vi.fn().mockReturnValue(null),
      createInsertCommand: vi.fn(),
      createDeleteCommand: vi.fn(),
      commandFactory: undefined,
    });
  });

  it("keeps collection mode on useDocumentData and collection toolbar controls", () => {
    renderWithProviders(
      <DocumentDataGrid
        gridId="collection-grid"
        connectionId="conn-1"
        database="app"
        collection="users"
      />,
    );

    expect(mocks.useDocumentData).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /nested/i })).toBeInTheDocument();
  });

  it("renders supplied result documents without calling useDocumentData", () => {
    renderWithProviders(
      <DocumentDataGrid
        mode="result"
        gridId="result-grid"
        connectionId="conn-1"
        database="app"
        documents={[{ _id: "1", name: "Ada" }]}
      />,
    );

    expect(mocks.useDocumentData).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "New Collection" })).not.toBeInTheDocument();

    const baseProps = mocks.baseDataGrid.mock.lastCall?.[0];
    expect(baseProps.topToolbar).toBeUndefined();
    expect(baseProps.readOnly).toBe(true);
    expect(baseProps.enableStagedChanges).toBe(false);
    expect(baseProps.enableFillOperations).toBe(false);
    expect(baseProps.commandFactory).toBeUndefined();
    expect(baseProps.rows).toEqual([
      {
        _id: {
          value: "1",
          db_type: "string",
          value_type: "Text",
          is_truncated: false,
        },
        name: {
          value: "Ada",
          db_type: "string",
          value_type: "Text",
          is_truncated: false,
        },
      },
    ]);
    expect(baseProps.columns.map((column: { field: string }) => column.field)).toEqual([
      "_id",
      "name",
    ]);
  });

  it("builds read-only cells from supplied result documents", () => {
    renderWithProviders(
      <DocumentDataGrid
        mode="result"
        gridId="result-grid-cells"
        connectionId="conn-1"
        database="app"
        documents={[{ _id: "1", name: "Ada" }]}
      />,
    );

    const baseProps = mocks.baseDataGrid.mock.lastCall?.[0];
    const nameCell = baseProps.getCellContent([1, 0]);

    expect(nameCell.readonly).toBe(true);
    expect(nameCell.copyData).toBe("Ada");
  });

  it("keeps an empty result grid shape when there are no documents", () => {
    renderWithProviders(
      <DocumentDataGrid
        mode="result"
        gridId="result-grid-empty"
        connectionId="conn-1"
        database="app"
        documents={[]}
      />,
    );

    const baseProps = mocks.baseDataGrid.mock.lastCall?.[0];
    expect(baseProps.rows).toEqual([]);
    expect(baseProps.columns.map((column: { field: string }) => column.field)).toEqual([
      "_id",
    ]);
  });
});
