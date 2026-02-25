import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionForm } from "../ConnectionForm";

const clipboardMock = vi.hoisted(() => ({
  readText: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: clipboardMock.readText,
}));

describe("ConnectionForm", () => {
  beforeEach(() => {
    clipboardMock.readText.mockReset();
    localStorage.clear();
  });

  it("keeps the parsed SQL Server port when pasting a config string", async () => {
    clipboardMock.readText.mockResolvedValue(
      "Server=localhost,11435;Database=todoapp;User Id=sa;Password=DevPass123;",
    );

    render(<ConnectionForm />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /paste config/i }));

    const portInput = screen.getByLabelText("Port");
    await waitFor(() => {
      expect(portInput).toHaveValue("11435");
    });
  });
});
