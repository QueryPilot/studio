import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const dndContextRenderSpy = vi.fn();

vi.mock("@dnd-kit/core", () => ({
  DndContext: (props: Record<string, unknown>) => {
    dndContextRenderSpy(props);
    return <div data-testid="dnd-context">{props.children as React.ReactNode}</div>;
  },
  PointerSensor: Symbol("PointerSensor"),
  useSensor: (_sensor: unknown, options?: unknown) => ({ options }),
  useSensors: (...sensors: unknown[]) => sensors,
}));

import { WorkbenchDndProvider } from "../WorkbenchDndProvider";

describe("WorkbenchDndProvider", () => {
  it("disables auto-scroll to prevent workbench container scrolling during drag", () => {
    render(
      <WorkbenchDndProvider>
        <div>Workbench content</div>
      </WorkbenchDndProvider>,
    );

    expect(screen.getByText("Workbench content")).toBeInTheDocument();
    expect(dndContextRenderSpy).toHaveBeenCalled();
    const firstCall = dndContextRenderSpy.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    const dndContextProps = firstCall?.[0] as { autoScroll?: boolean };
    expect(dndContextProps.autoScroll).toBe(false);
  });
});
