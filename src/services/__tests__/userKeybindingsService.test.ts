import { beforeEach, describe, expect, it } from "vitest";

import { parseKeybindingInput } from "@/lib/keyboardDispatch";
import { keybindingService } from "@/services/keybindingService";
import { userKeybindingsService } from "@/services/userKeybindingsService";

describe("userKeybindingsService", () => {
  beforeEach(() => {
    window.localStorage.clear();
    keybindingService.clearSource("default");
    keybindingService.clearSource("user");
    keybindingService.clearSource("extension");
    userKeybindingsService.initialize();
    userKeybindingsService.resetAll();
  });

  it("applies user overrides to resolver", () => {
    keybindingService.register(
      { command: "workbench.action.sample", key: "cmd+a" },
      "default",
    );

    userKeybindingsService.upsert({
      command: "workbench.action.sample",
      key: "cmd+b",
    });

    expect(
      keybindingService.resolve(parseKeybindingInput("cmd+a")).match,
    ).toBeUndefined();
    expect(
      keybindingService.resolve(parseKeybindingInput("cmd+b")).match?.command,
    ).toBe("workbench.action.sample");
  });

  it("persists and reloads keybindings from localStorage", () => {
    userKeybindingsService.setAll([
      { command: "workbench.action.persisted", key: "cmd+p" },
    ]);

    const stored = window.localStorage.getItem("querypilot.userKeybindings.v1");
    expect(stored).toContain("workbench.action.persisted");
    expect(userKeybindingsService.list()).toEqual([
      { command: "workbench.action.persisted", key: "cmd+p", when: undefined, args: undefined },
    ]);
  });

  it("resets user bindings for a command", () => {
    userKeybindingsService.setAll([
      { command: "workbench.action.sample", key: "cmd+b" },
      { command: "-workbench.action.sample", key: "cmd+a" },
      { command: "workbench.action.other", key: "cmd+o" },
    ]);

    userKeybindingsService.resetCommand("workbench.action.sample");

    expect(userKeybindingsService.list()).toEqual([
      { command: "workbench.action.other", key: "cmd+o", when: undefined, args: undefined },
    ]);
  });
});
