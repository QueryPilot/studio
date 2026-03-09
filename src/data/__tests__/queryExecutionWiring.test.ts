import { afterEach, describe, expect, it, vi } from "vitest";
import { queryCommands } from "@/data/commands/queryCommands";
import { defaultCommands } from "@/data/defaultCommands";
import { defaultKeybindings } from "@/data/defaultKeybindings";
import { menuActionCommandMap } from "@/data/menuActionCommandMap";
import { queryActionDispatcher } from "@/services/queryActionDispatcher";
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

  it("routes query.executeSelection to focused query panel dispatch", () => {
    const dispatchSpy = vi.spyOn(queryActionDispatcher, "dispatch");
    const command = queryCommands.find((item) => item.id === "query.executeSelection");

    expect(command).toBeDefined();
    void command?.handler(undefined, commandContext);

    expect(dispatchSpy).toHaveBeenCalledWith("executeSelection");
  });

  it("routes query.executeAll to focused query panel dispatch", () => {
    const dispatchSpy = vi.spyOn(queryActionDispatcher, "dispatch");
    const command = queryCommands.find((item) => item.id === "query.executeAll");

    expect(command).toBeDefined();
    void command?.handler(undefined, commandContext);

    expect(dispatchSpy).toHaveBeenCalledWith("executeAll");
  });

  it("exposes editor.action.executeAll and dispatches to the focused query panel", () => {
    const dispatchSpy = vi.spyOn(queryActionDispatcher, "dispatch");
    const command = defaultCommands.find(
      (item) => item.id === "editor.action.executeAll",
    );

    expect(command).toBeDefined();
    void command?.handler(undefined, commandContext);

    expect(dispatchSpy).toHaveBeenCalledWith("executeAll");
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
