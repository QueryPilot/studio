import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import useWorkbenchStore from "@/stores/workbenchStore";
import { TabBadge } from "@/components/Workbench/TabBadge";

function seed(kind: string | undefined) {
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
  useWorkbenchStore.getState().addTab(panelId, "t1", { type: kind });
  return { panelId, tabId: "t1" };
}

describe("TabBadge", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      layoutTree: null,
      panelContents: new Map(),
      layoutHistory: [],
      historyIndex: -1,
    });
  });

  it("does not render when override is unset", () => {
    seed("query");
    const { container } = render(
      <TabBadge tabId="t1" panelId="p" tabType="query" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders primary schema when override is set and tab is a query tab", () => {
    const { tabId } = seed("query");
    useWorkbenchStore
      .getState()
      .setTabSchemaOverride(tabId, ["reporting", "public"]);
    render(<TabBadge tabId="t1" panelId="p" tabType="query" />);
    expect(screen.getByText("reporting")).toBeInTheDocument();
  });

  it("does not render for non-query tab types even if override is set", () => {
    const { tabId } = seed("table");
    useWorkbenchStore.getState().setTabSchemaOverride(tabId, ["reporting"]);
    const { container } = render(
      <TabBadge tabId="t1" panelId="p" tabType="table" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("tooltip shows csv of override schemas", async () => {
    const { tabId } = seed("query");
    useWorkbenchStore
      .getState()
      .setTabSchemaOverride(tabId, ["reporting", "public", "audit"]);
    render(<TabBadge tabId="t1" panelId="p" tabType="query" />);
    await userEvent.hover(screen.getByText("reporting"));
    expect(
      await screen.findByText(/Tab override: reporting, public, audit/),
    ).toBeInTheDocument();
  });
});
