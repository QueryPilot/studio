import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "@/stores/appStore";
import { ThemeSync } from "@/components/theme-sync";

const themeState = vi.hoisted(() => ({
  theme: "system" as "light" | "dark" | "system",
  setTheme: vi.fn(),
}));

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => themeState,
}));

describe("ThemeSync", () => {
  beforeEach(() => {
    themeState.theme = "system";
    themeState.setTheme.mockClear();
    useAppStore.setState({
      theme: "system",
      sidebarCollapsed: false,
      preferences: {
        autoSave: true,
        fontSize: 14,
        tabSize: 2,
      },
    });
  });

  it("pushes app store theme to next-themes", async () => {
    render(<ThemeSync />);

    act(() => {
      useAppStore.getState().setTheme("dark");
    });

    await waitFor(() => {
      expect(themeState.setTheme).toHaveBeenCalledWith("dark");
    });
  });
});
