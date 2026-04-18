import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import useWorkbenchStore from "@/stores/workbenchStore";
import { SchemaPill } from "@/components/QueryPanel/SchemaPill";

const setVisibleSchemas = vi.fn();
vi.mock("@/stores/connectionStoreNew", () => ({
  useConnectionStore: {
    getState: () => ({
      getVisibleSchemas: () => ["public"],
      setVisibleSchemas,
    }),
  },
}));

vi.mock("@/services/databaseService", () => ({
  databaseService: { listSchemas: vi.fn().mockResolvedValue(["public", "reporting"]) },
}));

const toast = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (m: string) => toast(m) } }));

function seed() {
  useWorkbenchStore.setState({
    layoutTree: null,
    panelContents: new Map(),
    layoutHistory: [],
    historyIndex: -1,
  });
  useWorkbenchStore.getState().initializeLayout();
  const panelId = Array.from(
    useWorkbenchStore.getState().panelContents.keys(),
  )[0]!;
  useWorkbenchStore
    .getState()
    .addTab(panelId, "t1", { connectionId: "c", database: "d" });
  return { panelId, tabId: "t1" };
}

describe("SchemaPill", () => {
  beforeEach(() => {
    setVisibleSchemas.mockReset();
    toast.mockReset();
  });

  it("renders muted 'from connection' state when no override", () => {
    seed();
    render(<SchemaPill tabId="t1" connectionId="c" database="d" />);
    expect(screen.getByText(/schema: public/i)).toBeInTheDocument();
    expect(screen.getByText(/from connection/i)).toBeInTheDocument();
  });

  it("renders solid override state with x button", () => {
    const { tabId } = seed();
    useWorkbenchStore.getState().setTabSchemaOverride(tabId, ["reporting"]);
    render(<SchemaPill tabId="t1" connectionId="c" database="d" />);
    expect(screen.getByText(/schema: reporting/i)).toBeInTheDocument();
    expect(screen.getByText(/tab override/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear.*override/i })).toBeVisible();
  });

  it("x clears override and fires toast", async () => {
    const { tabId } = seed();
    useWorkbenchStore.getState().setTabSchemaOverride(tabId, ["reporting"]);
    render(<SchemaPill tabId="t1" connectionId="c" database="d" />);
    await userEvent.click(
      screen.getByRole("button", { name: /clear.*override/i }),
    );
    expect(useWorkbenchStore.getState().getTabSchemaOverride(tabId)).toBeUndefined();
    expect(toast).toHaveBeenCalledWith("Tab override removed");
  });

  it("toggling schema auto-applies to workbench store when override in effect", async () => {
    const { tabId } = seed();
    useWorkbenchStore.getState().setTabSchemaOverride(tabId, ["reporting"]);
    render(<SchemaPill tabId="t1" connectionId="c" database="d" />);
    await userEvent.click(screen.getByText(/schema: reporting/i));
    const reporting = await screen.findByRole("checkbox", { name: /reporting/i });
    expect(reporting).toBeChecked();
    // Toggle public on — auto-applies immediately
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /public/i }),
    );
    await waitFor(() =>
      expect(
        useWorkbenchStore.getState().getTabSchemaOverride(tabId)?.visibleSchemas,
      ).toEqual(["reporting", "public"]),
    );
    expect(setVisibleSchemas).not.toHaveBeenCalled();
  });

  it("'Apply to connection instead' writes to connection AND clears override atomically", async () => {
    const { tabId } = seed();
    useWorkbenchStore.getState().setTabSchemaOverride(tabId, ["reporting"]);
    render(<SchemaPill tabId="t1" connectionId="c" database="d" />);
    await userEvent.click(screen.getByText(/schema: reporting/i));
    await userEvent.click(
      await screen.findByRole("button", { name: /apply to connection instead/i }),
    );
    await waitFor(() =>
      expect(setVisibleSchemas).toHaveBeenCalledWith("c", "d", ["reporting"]),
    );
    expect(useWorkbenchStore.getState().getTabSchemaOverride(tabId)).toBeUndefined();
  });

  it("no-override state auto-applies to connection store on toggle", async () => {
    seed();
    render(<SchemaPill tabId="t1" connectionId="c" database="d" />);
    await userEvent.click(screen.getByText(/schema: public/i));
    // Toggle reporting on — auto-applies immediately
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /reporting/i }),
    );
    await waitFor(() =>
      expect(setVisibleSchemas).toHaveBeenCalledWith(
        "c",
        "d",
        expect.arrayContaining(["public", "reporting"]),
      ),
    );
  });
});
