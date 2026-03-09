import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MongoQueryPanel } from "../MongoQueryPanel";

const mocks = vi.hoisted(() => ({
  findDocuments: vi.fn(),
  countDocuments: vi.fn(),
  aggregate: vi.fn(),
  runCommand: vi.fn(),
  insertDocument: vi.fn(),
  insertDocuments: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.successToast(...args),
    error: (...args: unknown[]) => mocks.errorToast(...args),
  },
}));

vi.mock("@/adapters/mongodb", () => ({
  MongoDBAdapter: class MongoDBAdapter {
    findDocuments(...args: unknown[]) {
      return mocks.findDocuments(...args);
    }
    countDocuments(...args: unknown[]) {
      return mocks.countDocuments(...args);
    }
    aggregate(...args: unknown[]) {
      return mocks.aggregate(...args);
    }
    runCommand(...args: unknown[]) {
      return mocks.runCommand(...args);
    }
    insertDocument(...args: unknown[]) {
      return mocks.insertDocument(...args);
    }
    insertDocuments(...args: unknown[]) {
      return mocks.insertDocuments(...args);
    }
    updateDocument(...args: unknown[]) {
      return mocks.updateDocument(...args);
    }
    deleteDocument(...args: unknown[]) {
      return mocks.deleteDocument(...args);
    }
  },
}));

vi.mock("@/components/DataGrid", () => ({
  DocumentDataGrid: (props: unknown) => (
    <pre data-testid="document-data-grid">{JSON.stringify(props)}</pre>
  ),
}));

vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
  }) =>
    readOnly ? (
      <pre data-testid="code-editor-readonly">{value}</pre>
    ) : (
      <textarea
        data-testid="code-editor-input"
        value={value}
        onChange={(event) => {
          onChange?.(event.target.value);
        }}
      />
    ),
}));

describe("MongoQueryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults document results to data mode", async () => {
    mocks.findDocuments.mockResolvedValue([{ _id: "1", name: "Ada" }]);

    render(
      <MongoQueryPanel
        panelId="panel-1"
        tabId="tab-1"
        connectionId="conn-1"
        database="app"
        initialQuery={`{"find":"users","filter":{}}`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(screen.getByTestId("document-data-grid")).toBeInTheDocument();
    });

    const props = JSON.parse(
      screen.getByTestId("document-data-grid").textContent,
    );
    expect(props.mode).toBe("result");
    expect(props.documents).toEqual([{ _id: "1", name: "Ada" }]);
    expect(props.collection).toBe("users");
  });

  it("defaults scalar results to json mode", async () => {
    mocks.countDocuments.mockResolvedValue(42);

    render(
      <MongoQueryPanel
        panelId="panel-1"
        tabId="tab-1"
        connectionId="conn-1"
        database="app"
        initialQuery={`{"count":"users","filter":{}}`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(screen.getByTestId("code-editor-readonly")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("document-data-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("code-editor-readonly")).toHaveTextContent("42");
  });

  it("clears results from the result header action", async () => {
    mocks.findDocuments.mockResolvedValue([{ _id: "1", name: "Ada" }]);

    render(
      <MongoQueryPanel
        panelId="panel-1"
        tabId="tab-1"
        connectionId="conn-1"
        database="app"
        initialQuery={`{"find":"users","filter":{}}`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear results" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear results" }));

    await waitFor(() => {
      expect(screen.queryByTestId("document-data-grid")).not.toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Show results" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Clear Results"),
    ).not.toBeInTheDocument();
  });

  it("shows a disabled running state instead of a fake stop action while executing", async () => {
    let resolveFind:
      | ((value: Array<{ _id: string; name: string }>) => void)
      | undefined;

    mocks.findDocuments.mockImplementation(
      () =>
        new Promise<Array<{ _id: string; name: string }>>((resolve) => {
          resolveFind = resolve;
        }),
    );

    render(
      <MongoQueryPanel
        panelId="panel-1"
        tabId="tab-1"
        connectionId="conn-1"
        database="app"
        initialQuery={`{"find":"users","filter":{}}`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Running" })).toBeDisabled();
    });
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();

    resolveFind?.([{ _id: "1", name: "Ada" }]);

    await waitFor(() => {
      expect(screen.getByTestId("document-data-grid")).toBeInTheDocument();
    });
  });
});
