import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ERDToolbar } from "@/components/Erd/ERDToolbar";

describe("ERDToolbar schemas popover", () => {
  it("renders a Schemas button labeled with the primary schema", () => {
    render(
      <ERDToolbar
        isCodeVisible={false}
        onToggleCodePanel={() => {}}
        selectedSchemas={["public"]}
        allSchemas={["public", "reporting"]}
        onSchemasChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /public/ })).toBeInTheDocument();
  });

  it("shows `public (+2 more)` label when 3 schemas selected", () => {
    render(
      <ERDToolbar
        isCodeVisible={false}
        onToggleCodePanel={() => {}}
        selectedSchemas={["public", "reporting", "analytics"]}
        allSchemas={["public", "reporting", "analytics"]}
        onSchemasChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /public \(\+2 more\)/ }),
    ).toBeInTheDocument();
  });

  it("dispatches onSchemasChange from the popover Apply button", async () => {
    const onSchemasChange = vi.fn();
    render(
      <ERDToolbar
        isCodeVisible={false}
        onToggleCodePanel={() => {}}
        selectedSchemas={["public"]}
        allSchemas={["public", "reporting"]}
        onSchemasChange={onSchemasChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /public/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /reporting/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSchemasChange).toHaveBeenCalledWith(["public", "reporting"]);
  });

  it("disables Apply when no schemas are selected", async () => {
    render(
      <ERDToolbar
        isCodeVisible={false}
        onToggleCodePanel={() => {}}
        selectedSchemas={["public"]}
        allSchemas={["public", "reporting"]}
        onSchemasChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /public/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /public/i }));
    expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
  });

  it("popover header reads 'Scope this ERD view'", async () => {
    render(
      <ERDToolbar
        isCodeVisible={false}
        onToggleCodePanel={() => {}}
        selectedSchemas={["public"]}
        allSchemas={["public", "reporting"]}
        onSchemasChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /public/ }));
    expect(await screen.findByText(/scope this erd view/i)).toBeInTheDocument();
  });
});
