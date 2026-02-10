import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandService } from "@/services/commandService";
import { ContextService } from "@/services/contextService";
import { KeyboardHandler } from "@/services/keyboardHandler";
import { KeybindingService } from "@/services/keybindingService";

describe("KeyboardHandler", () => {
  let contextService: ContextService;
  let commandService: CommandService;
  let keybindingService: KeybindingService;
  let handler: KeyboardHandler;

  beforeEach(() => {
    contextService = new ContextService();
    commandService = new CommandService(contextService);
    keybindingService = new KeybindingService(contextService, "linux");
    handler = new KeyboardHandler(
      commandService,
      keybindingService,
      contextService,
      { preventDefault: false, chordTimeoutMs: 500 },
      "linux",
    );
    handler.initialize();
  });

  afterEach(() => {
    handler.dispose();
  });

  it("prefers exact match over chord prefix", async () => {
    const standalone = vi.fn();
    const chord = vi.fn();

    commandService.register({
      id: "test.standalone",
      label: "Standalone",
      handler: standalone,
    });
    commandService.register({
      id: "test.chord",
      label: "Chord",
      handler: chord,
    });

    keybindingService.register({ command: "test.standalone", key: "ctrl+k" });
    keybindingService.register({ command: "test.chord", key: "ctrl+k ctrl+c" });

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));

    await Promise.resolve();

    expect(standalone).toHaveBeenCalledTimes(1);
    expect(chord).not.toHaveBeenCalled();
  });

  it("executes chord when no exact first-step binding exists", async () => {
    const chord = vi.fn();

    commandService.register({
      id: "test.chord",
      label: "Chord",
      handler: chord,
    });

    keybindingService.register({ command: "test.chord", key: "ctrl+k ctrl+c" });

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "c",
      code: "KeyC",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));

    await Promise.resolve();

    expect(chord).toHaveBeenCalledTimes(1);
  });
});
