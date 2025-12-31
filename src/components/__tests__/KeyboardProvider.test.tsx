import { describe, expect, it } from "vitest";

import { commandService } from "@/services/commandService";
import "@/components/KeyboardProvider";

describe("KeyboardProvider", () => {
  it("registers appearance commands on initialization", () => {
    expect(commandService.has("appearance.setThemeLight")).toBe(true);
    expect(commandService.has("appearance.setThemeDark")).toBe(true);
    expect(commandService.has("appearance.setThemeSystem")).toBe(true);
  });
});
