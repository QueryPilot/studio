import { afterEach, describe, expect, it, vi } from "vitest";
import { queryCommands } from "@/data/commands/queryCommands";
import { defaultCommands } from "@/data/defaultCommands";
import { defaultKeybindings } from "@/data/defaultKeybindings";
import { menuActionCommandMap } from "@/data/menuActionCommandMap";
import { eventBus } from "@/services/eventBus";
import { type CommandExecutionContext } from "@/types/command";

const commandContext: CommandExecutionContext = {
  id: "test",
  context: new Map(),
  source: "system",
};

describe("query execution wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes query.executeSelection to execute-selection event", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    const command = queryCommands.find((item) => item.id === "query.executeSelection");

    expect(command).toBeDefined();
    void command?.handler(undefined, commandContext);

    expect(emitSpy).toHaveBeenCalledWith("query-editor:execute-selection", {
      mode: "text",
    });
  });

  it("routes query.executeAll to execute-all event", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    const command = queryCommands.find((item) => item.id === "query.executeAll");

    expect(command).toBeDefined();
    void command?.handler(undefined, commandContext);

    expect(emitSpy).toHaveBeenCalledWith("query-editor:execute-all", {});
  });

  it("exposes editor.action.executeAll and emits execute-all event", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    const command = defaultCommands.find(
      (item) => item.id === "editor.action.executeAll",
    );

    expect(command).toBeDefined();
    void command?.handler(undefined, commandContext);

    expect(emitSpy).toHaveBeenCalledWith("query-editor:execute-all", {});
  });

  it("binds cmd+shift+enter to editor.action.executeAll", () => {
    const binding = defaultKeybindings.find(
      (item) => item.key === "cmd+shift+enter",
    );

    expect(binding).toBeDefined();
    expect(binding?.command).toBe("editor.action.executeAll");
  });

  it("maps execute_all menu action to query.executeAll", () => {
    expect(menuActionCommandMap.execute_all).toBe("query.executeAll");
  });
});
