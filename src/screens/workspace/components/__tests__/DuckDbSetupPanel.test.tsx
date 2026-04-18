import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@/screens/workspace/components/DuckDbExtensionsPanel", () => ({
  DuckDbExtensionsPanel: ({ connectionId }: { connectionId: string }) =>
    React.createElement("div", { "data-testid": "extensions-panel" }, `extensions:${connectionId}`),
}));
vi.mock("@/screens/workspace/components/DuckDbSecretsPanel", () => ({
  DuckDbSecretsPanel: ({ connectionId }: { connectionId: string }) =>
    React.createElement("div", { "data-testid": "secrets-panel" }, `secrets:${connectionId}`),
}));
vi.mock("@/screens/workspace/components/DuckDbAttachmentsPanel", () => ({
  DuckDbAttachmentsPanel: ({ connectionId }: { connectionId: string }) =>
    React.createElement("div", { "data-testid": "attachments-panel" }, `attachments:${connectionId}`),
}));

import { DuckDbSetupPanel } from "@/screens/workspace/components/DuckDbSetupPanel";

describe("DuckDbSetupPanel", () => {
  it("renders three tabs: Extensions, Attachments, Secrets", () => {
    render(<DuckDbSetupPanel connectionId="conn-1" />);
    expect(screen.getByRole("tab", { name: /extensions/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /attachments/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /secrets/i })).toBeInTheDocument();
  });

  it("extensions panel is shown by default", () => {
    render(<DuckDbSetupPanel connectionId="conn-1" />);
    expect(screen.getByTestId("extensions-panel")).toBeInTheDocument();
  });

  it("switches to secrets tab and shows secrets panel", async () => {
    const user = userEvent.setup();
    render(<DuckDbSetupPanel connectionId="conn-1" />);
    await user.click(screen.getByRole("tab", { name: /secrets/i }));
    // After clicking secrets tab, the secrets panel should be visible
    expect(screen.getByTestId("secrets-panel")).toBeVisible();
  });
});
