import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryToolbar } from "../QueryToolbar";

describe("QueryToolbar", () => {
  it("does not render result view mode tabs in the top toolbar", () => {
    render(
      <QueryToolbar
        isExecuting={false}
        hasQuery={true}
        showResults={true}
        showOutline={false}
        dialect="auto"
        detectedDialect="postgresql"
        onExecute={vi.fn()}
        onExecuteAll={vi.fn()}
        onCancel={vi.fn()}
        onBeautify={vi.fn()}
        onToggleResults={vi.fn()}
        onToggleOutline={vi.fn()}
        onDialectChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("tab", { name: "Table" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "JSON" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Plan" })).not.toBeInTheDocument();
  });
});
