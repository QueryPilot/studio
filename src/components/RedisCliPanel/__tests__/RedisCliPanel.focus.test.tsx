import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const selectDatabaseMock = vi.fn();
const executeRawMock = vi.fn();

vi.mock("@/adapters/redis/RedisAdapter", () => ({
  RedisAdapter: class MockRedisAdapter {
    constructor(_connectionId: string) {
      void _connectionId;
    }

    selectDatabase(...args: unknown[]) {
      return selectDatabaseMock(...args);
    }

    executeRaw(...args: unknown[]) {
      return executeRawMock(...args);
    }
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { RedisCliPanel } from "../RedisCliPanel";

describe("RedisCliPanel focus ownership", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    selectDatabaseMock.mockResolvedValue(undefined);
    executeRawMock.mockResolvedValue("PONG");
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("does not steal focus back after execution when the mounted tab is not interactive", async () => {
    render(
      React.createElement(RedisCliPanel as unknown as React.ComponentType<Record<string, unknown>>, {
        panelId: "panel-1",
        tabId: "tab-1",
        connectionId: "conn-1",
        database: 0,
        isInteractive: false,
      }),
    );

    const input = screen.getByPlaceholderText("Type a command...");
    const runButton = screen.getByRole("button", { name: "" });

    fireEvent.change(input, { target: { value: "PING" } });
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(executeRawMock).toHaveBeenCalledWith("PING", []);
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(document.activeElement).not.toBe(input);
  });
});
