import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MongoQueryToolbar } from "../MongoQueryToolbar";

describe("MongoQueryToolbar", () => {
  it("shows a results toggle and hides result mode tabs until results are visible", () => {
    render(
      <MongoQueryToolbar
        isExecuting={false}
        canCancel={false}
        onExecute={vi.fn()}
        onCancel={vi.fn()}
        onFormat={vi.fn()}
        hasQuery={true}
        showResults={false}
        viewMode="json"
        onToggleResults={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Show results")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Data" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "JSON" })).not.toBeInTheDocument();
    expect(screen.queryByText("Clear Results")).not.toBeInTheDocument();
  });

  it("renders result mode tabs and forwards mode changes when results are visible", () => {
    const onViewModeChange = vi.fn();

    render(
      <MongoQueryToolbar
        isExecuting={false}
        canCancel={false}
        onExecute={vi.fn()}
        onCancel={vi.fn()}
        onFormat={vi.fn()}
        hasQuery={true}
        showResults={true}
        viewMode="data"
        onToggleResults={vi.fn()}
        onViewModeChange={onViewModeChange}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "JSON" }));

    expect(screen.getByRole("tab", { name: "Data" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "JSON" })).toBeInTheDocument();
    expect(onViewModeChange).toHaveBeenCalledWith("json");
  });

  it("keeps format, overflow, and run controls in the right action cluster", () => {
    const onExecute = vi.fn();
    const onFormat = vi.fn();

    render(
      <MongoQueryToolbar
        isExecuting={false}
        canCancel={false}
        onExecute={onExecute}
        onCancel={vi.fn()}
        onFormat={onFormat}
        hasQuery={true}
        showResults={true}
        viewMode="json"
        onToggleResults={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    fireEvent.click(screen.getByRole("button", { name: "Format" }));

    expect(screen.getByLabelText("More options")).toBeInTheDocument();
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onFormat).toHaveBeenCalledTimes(1);
  });

  it("shows stop while executing when cancellation is supported", () => {
    const onCancel = vi.fn();

    render(
      <MongoQueryToolbar
        isExecuting={true}
        canCancel={true}
        onExecute={vi.fn()}
        onCancel={onCancel}
        onFormat={vi.fn()}
        hasQuery={true}
        showResults={true}
        viewMode="json"
        onToggleResults={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(screen.getByRole("button", { name: "Format" })).toBeDisabled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled running state while executing when cancellation is unavailable", () => {
    render(
      <MongoQueryToolbar
        isExecuting={true}
        canCancel={false}
        onExecute={vi.fn()}
        onCancel={vi.fn()}
        onFormat={vi.fn()}
        hasQuery={true}
        showResults={true}
        viewMode="json"
        onToggleResults={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Running" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Format" })).toBeDisabled();
  });
});
