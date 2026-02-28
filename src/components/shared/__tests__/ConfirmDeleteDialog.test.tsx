import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfirmDeleteDialog } from "../ConfirmDeleteDialog";

describe("ConfirmDeleteDialog", () => {
  it("renders destructive confirm button with readable text color", () => {
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={vi.fn()}
        title="Delete Objects"
        description="This will delete objects."
        onConfirm={vi.fn()}
      />,
    );

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(deleteButton).toHaveClass("bg-destructive");
    expect(deleteButton).toHaveClass("text-white");
  });

  it("supports custom label and extra content", () => {
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={vi.fn()}
        title="Truncate Objects"
        description="Choose truncate options."
        onConfirm={vi.fn()}
        confirmLabel="Stage Truncate"
        extraContent={
          <div>
            <span>Restart identity</span>
          </div>
        }
      />,
    );

    expect(
      screen.getByRole("button", { name: "Stage Truncate" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Restart identity")).toBeInTheDocument();
  });
});
