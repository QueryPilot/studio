import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandService } from "@/services/commandService";
import { ContextService } from "@/services/contextService";
import { KeyboardHandler } from "@/services/keyboardHandler";
import { KeybindingService } from "@/services/keybindingService";
import { defaultKeybindings } from "@/data/defaultKeybindings";

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

  it("does not close quick open on Escape while command actions popover is visible", async () => {
    const closeQuickOpen = vi.fn();

    commandService.register({
      id: "quickOpen.close",
      label: "Close Quick Open",
      handler: closeQuickOpen,
    });

    const quickOpenCloseBinding = defaultKeybindings.find(
      (binding) => binding.command === "quickOpen.close" && binding.key === "escape",
    );

    if (!quickOpenCloseBinding) {
      throw new Error("Missing default escape binding for quickOpen.close");
    }

    keybindingService.register(quickOpenCloseBinding);
    contextService.setValue("inQuickOpen", true);
    contextService.setValue("inCommandPaletteActions", true);

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    await Promise.resolve();

    expect(closeQuickOpen).not.toHaveBeenCalled();

    contextService.setValue("inCommandPaletteActions", false);

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    await Promise.resolve();

    expect(closeQuickOpen).toHaveBeenCalledTimes(1);
  });

  it("treats active .cm-editor as text-focus when keydown target is not an input", async () => {
    const deleteRows = vi.fn();
    const editorRoot = document.createElement("div");
    editorRoot.className = "cm-editor";
    editorRoot.tabIndex = -1;
    document.body.appendChild(editorRoot);
    editorRoot.focus();

    commandService.register({
      id: "dataGrid.action.deleteRows",
      label: "Delete Rows",
      handler: deleteRows,
    });
    keybindingService.register({
      command: "dataGrid.action.deleteRows",
      key: "ctrl+d",
      when: "dataGridFocus && !editingCell && dataGridEditable",
    });
    contextService.setValue("dataGridFocus", true);
    contextService.setValue("dataGridEditable", true);

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "d",
      code: "KeyD",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));

    await Promise.resolve();

    expect(deleteRows).not.toHaveBeenCalled();
    editorRoot.remove();
  });
});
