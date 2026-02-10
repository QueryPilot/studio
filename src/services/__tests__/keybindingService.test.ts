import { describe, expect, it } from "vitest";

import { parseKeybindingInput } from "@/lib/keyboardDispatch";
import { ContextService } from "@/services/contextService";
import { KeybindingService } from "@/services/keybindingService";

describe("KeybindingService", () => {
  it("resolves highest-weight binding", () => {
    const context = new ContextService();
    const service = new KeybindingService(context);

    service.register({ command: "a", key: "cmd+k", weight: 10 }, "default");
    service.register({ command: "b", key: "cmd+k", weight: 100 }, "user");

    const result = service.resolve(parseKeybindingInput("cmd+k"));
    expect(result.match?.command).toBe("b");
  });

  it("supports unbinding via '-command' rules", () => {
    const context = new ContextService();
    const service = new KeybindingService(context);

    service.register({ command: "workbench.action.test", key: "cmd+t" }, "default");
    service.register({ command: "-workbench.action.test", key: "cmd+t" }, "user");

    const result = service.resolve(parseKeybindingInput("cmd+t"));
    expect(result.match).toBeUndefined();
    expect(service.list()).toHaveLength(0);
    expect(service.listWithRemovals()).toHaveLength(2);
  });

  it("can replace source bindings atomically", () => {
    const context = new ContextService();
    const service = new KeybindingService(context);

    service.register({ command: "test.one", key: "cmd+1" }, "default");
    service.replaceSourceBindings(
      [{ command: "test.two", key: "cmd+2" }],
      "default",
    );

    expect(service.resolve(parseKeybindingInput("cmd+1")).match).toBeUndefined();
    expect(service.resolve(parseKeybindingInput("cmd+2")).match?.command).toBe(
      "test.two",
    );
  });
});
