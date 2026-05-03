import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DuckDbAddFileDialog } from "../DuckDbAddFileDialog";

describe("DuckDbAddFileDialog", () => {
  it("loads sheet names for xlsx files and submits the default first sheet", async () => {
    const onConfirm = vi.fn();
    const loadSheets = vi.fn().mockResolvedValue(["Sheet One", "Second Sheet"]);

    render(
      <DuckDbAddFileDialog
        open
        onOpenChange={vi.fn()}
        files={[
          {
            filePath: "/tmp/workbook.xlsx",
            targetName: "workbook",
            format: "xlsx",
          },
        ]}
        isSubmitting={false}
        loadSheets={loadSheets}
        onConfirm={onConfirm}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Sheet")).toHaveValue("Sheet One");
    });

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({
        filePath: "/tmp/workbook.xlsx",
        selectedSheet: "Sheet One",
      }),
    ]);
    expect(loadSheets).toHaveBeenCalledWith("/tmp/workbook.xlsx");
  });
});
