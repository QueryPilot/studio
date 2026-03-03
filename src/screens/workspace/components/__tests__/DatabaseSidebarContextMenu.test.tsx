import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DatabaseSidebarContextMenu } from "../DatabaseSidebarContextMenu";

const baseProps = {
  x: 10,
  y: 10,
  selectedCount: 1,
  selectedTypes: {
    tables: 1,
    views: 0,
    materializedViews: 0,
    functions: 0,
    collections: 0,
  },
  onClose: vi.fn(),
  canExportData: true,
  canExportDefinition: true,
  onExportDataCSV: vi.fn(),
  onExportDataJSON: vi.fn(),
  onExportDataInsert: vi.fn(),
  onExportDataMarkdown: vi.fn(),
  onExportDefinition: vi.fn(),
  onExportDefinitionDBML: vi.fn(),
  onExportDefinitionMermaid: vi.fn(),
  onCopyName: vi.fn(),
  onPin: vi.fn(),
  onViewData: vi.fn(),
  onViewStructure: vi.fn(),
};

describe("DatabaseSidebarContextMenu export submenus", () => {
  it("renders export options inside submenus", () => {
    render(
      <DatabaseSidebarContextMenu
        {...baseProps}
        onCopyDefinition={vi.fn()}
        onTruncate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("Export Data")).toBeInTheDocument();
    expect(screen.getByText("Export Definition")).toBeInTheDocument();

    expect(screen.queryByText("CSV")).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByText("Export Data"));
    expect(screen.getByText("CSV")).toBeInTheDocument();
    expect(screen.getByText("JSON")).toBeInTheDocument();
    expect(screen.getByText("SQL INSERT")).toBeInTheDocument();
    expect(screen.getByText("Markdown")).toBeInTheDocument();

    expect(screen.queryByText("SQL")).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByText("Export Definition"));
    expect(screen.getByText("SQL")).toBeInTheDocument();
    expect(screen.getByText("DBML")).toBeInTheDocument();
    expect(screen.getByText("Mermaid ERD")).toBeInTheDocument();
  });

  it("shows View Data for collection selections", () => {
    render(
      <DatabaseSidebarContextMenu
        {...baseProps}
        selectedTypes={{
          tables: 0,
          views: 0,
          materializedViews: 0,
          functions: 0,
          collections: 1,
        }}
        canExportData={false}
        canExportDefinition={false}
        onCopyDefinition={vi.fn()}
        onTruncate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("View Data")).toBeInTheDocument();
  });

  it("shows truncate for collection selections when wired", () => {
    const onTruncate = vi.fn();
    render(
      <DatabaseSidebarContextMenu
        {...baseProps}
        selectedTypes={{
          tables: 0,
          views: 0,
          materializedViews: 0,
          functions: 0,
          collections: 1,
        }}
        canExportData={false}
        canExportDefinition={false}
        onCopyDefinition={vi.fn()}
        onTruncate={onTruncate}
        onDelete={vi.fn()}
      />,
    );

    const truncateButton = screen.getByRole("button", { name: "Truncate..." });
    expect(truncateButton).toBeEnabled();

    fireEvent.click(truncateButton);
    expect(onTruncate).toHaveBeenCalledOnce();
  });

  it("positions menu above cursor when bottom space is insufficient", async () => {
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    });

    render(
      <DatabaseSidebarContextMenu
        {...baseProps}
        x={200}
        y={280}
        onCopyDefinition={vi.fn()}
        onTruncate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const menu = screen.getByText("Export Data").closest<HTMLDivElement>("div.fixed");
    expect(menu).not.toBeNull();
    if (!menu) return;

    const rectSpy = vi.spyOn(menu, "getBoundingClientRect").mockReturnValue({
      width: 220,
      height: 250,
      top: 280,
      left: 200,
      right: 420,
      bottom: 530,
      x: 200,
      y: 280,
      toJSON: () => ({}),
    } as DOMRect);

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(menu.style.top).toBe("30px");
    });

    rectSpy.mockRestore();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it("shows unimplemented actions as disabled coming soon items", () => {
    render(<DatabaseSidebarContextMenu {...baseProps} />);

    const copyDefinition = screen.getByRole("button", {
      name: "Copy Definition (coming soon)",
    });
    const truncate = screen.getByRole("button", {
      name: "Truncate... (coming soon)",
    });
    const deleteAction = screen.getByRole("button", {
      name: "Delete... (coming soon)",
    });

    expect(copyDefinition).toBeDisabled();
    expect(truncate).toBeDisabled();
    expect(deleteAction).toBeDisabled();
  });

  it("shows refresh materialized view as disabled coming soon when not wired", () => {
    render(
      <DatabaseSidebarContextMenu
        {...baseProps}
        selectedTypes={{
          tables: 0,
          views: 0,
          materializedViews: 1,
          functions: 0,
          collections: 0,
        }}
      />,
    );

    const refresh = screen.getByRole("button", {
      name: "Refresh Materialized View (coming soon)",
    });
    expect(refresh).toBeDisabled();
  });
});
