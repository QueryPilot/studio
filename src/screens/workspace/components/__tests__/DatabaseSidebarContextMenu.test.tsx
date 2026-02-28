import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DatabaseSidebarContextMenu } from "../DatabaseSidebarContextMenu";

describe("DatabaseSidebarContextMenu export submenus", () => {
  it("renders export options inside submenus", () => {
    render(
      <DatabaseSidebarContextMenu
        x={10}
        y={10}
        selectedCount={1}
        selectedTypes={{
          tables: 1,
          views: 0,
          materializedViews: 0,
          functions: 0,
          collections: 0,
        }}
        onClose={vi.fn()}
        canExportData={true}
        canExportDefinition={true}
        onExportDataCSV={vi.fn()}
        onExportDataJSON={vi.fn()}
        onExportDataInsert={vi.fn()}
        onExportDataMarkdown={vi.fn()}
        onExportDefinition={vi.fn()}
        onCopyName={vi.fn()}
        onCopyDefinition={vi.fn()}
        onPin={vi.fn()}
        onTruncate={vi.fn()}
        onDelete={vi.fn()}
        onViewData={vi.fn()}
        onViewStructure={vi.fn()}
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
  });

  it("shows View Data for collection selections", () => {
    render(
      <DatabaseSidebarContextMenu
        x={10}
        y={10}
        selectedCount={1}
        selectedTypes={{
          tables: 0,
          views: 0,
          materializedViews: 0,
          functions: 0,
          collections: 1,
        }}
        onClose={vi.fn()}
        canExportData={false}
        canExportDefinition={false}
        onExportDataCSV={vi.fn()}
        onExportDataJSON={vi.fn()}
        onExportDataInsert={vi.fn()}
        onExportDataMarkdown={vi.fn()}
        onExportDefinition={vi.fn()}
        onCopyName={vi.fn()}
        onCopyDefinition={vi.fn()}
        onPin={vi.fn()}
        onTruncate={vi.fn()}
        onDelete={vi.fn()}
        onViewData={vi.fn()}
        onViewStructure={vi.fn()}
      />,
    );

    expect(screen.getByText("View Data")).toBeInTheDocument();
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
        x={200}
        y={280}
        selectedCount={1}
        selectedTypes={{
          tables: 1,
          views: 0,
          materializedViews: 0,
          functions: 0,
          collections: 0,
        }}
        onClose={vi.fn()}
        canExportData={true}
        canExportDefinition={true}
        onExportDataCSV={vi.fn()}
        onExportDataJSON={vi.fn()}
        onExportDataInsert={vi.fn()}
        onExportDataMarkdown={vi.fn()}
        onExportDefinition={vi.fn()}
        onCopyName={vi.fn()}
        onCopyDefinition={vi.fn()}
        onPin={vi.fn()}
        onTruncate={vi.fn()}
        onDelete={vi.fn()}
        onViewData={vi.fn()}
        onViewStructure={vi.fn()}
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
});
