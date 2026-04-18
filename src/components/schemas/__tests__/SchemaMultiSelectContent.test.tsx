import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SchemaMultiSelectContent } from "@/components/schemas/SchemaMultiSelectContent";

vi.mock("@/services/databaseService", () => ({
  databaseService: { listSchemas: vi.fn().mockResolvedValue(["public", "reporting"]) },
}));

describe("SchemaMultiSelectContent", () => {
  it("auto-applies when toggling an unselected schema", async () => {
    const onApply = vi.fn();
    render(
      <SchemaMultiSelectContent
        connectionId="c"
        database="d"
        initialSchemas={["public"]}
        onApply={onApply}
        scopeLabel="This tab"
      />,
    );
    await screen.findByText(/reporting/i);
    fireEvent.click(screen.getByRole("checkbox", { name: /reporting/i }));
    expect(onApply).toHaveBeenCalledWith(expect.arrayContaining(["public", "reporting"]));
  });

  it("does not remove last schema when allowEmptySelection is false", async () => {
    const onApply = vi.fn();
    render(
      <SchemaMultiSelectContent
        connectionId="c"
        database="d"
        initialSchemas={["public"]}
        onApply={onApply}
        scopeLabel="This tab"
      />,
    );
    await screen.findByText(/public/i);
    // Try to uncheck the only selected schema — should be prevented
    fireEvent.click(screen.getByRole("checkbox", { name: /public/i }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("sets primary when clicking a schema label", async () => {
    const onApply = vi.fn();
    render(
      <SchemaMultiSelectContent
        connectionId="c"
        database="d"
        initialSchemas={["public", "reporting"]}
        onApply={onApply}
        scopeLabel="This tab"
      />,
    );
    // Click "reporting" label to make it primary
    fireEvent.click(screen.getByTitle("Click to set as primary"));
    expect(onApply).toHaveBeenCalledWith(["reporting", "public"]);
  });

  it("renders footerSlot", async () => {
    render(
      <SchemaMultiSelectContent
        connectionId="c"
        database="d"
        initialSchemas={["public"]}
        onApply={vi.fn()}
        scopeLabel="This tab"
        footerSlot={<button>Apply to connection instead</button>}
      />,
    );
    expect(
      await screen.findByRole("button", { name: /apply to connection instead/i }),
    ).toBeInTheDocument();
  });
});
