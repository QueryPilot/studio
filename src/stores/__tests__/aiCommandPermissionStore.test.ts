import { describe, it, expect, beforeEach } from "vitest";
import { useAiCommandPermissionStore } from "../aiCommandPermissionStore";

describe("aiCommandPermissionStore", () => {
  beforeEach(() => {
    useAiCommandPermissionStore.getState().reset();
  });

  it("starts with default state", () => {
    const state = useAiCommandPermissionStore.getState();
    expect(state.allowAllThisConversation).toBe(false);
    expect(state.commandStates.size).toBe(0);
  });

  it("tracks pending commands", () => {
    const { trackCommand, getCommandState } = useAiCommandPermissionStore.getState();
    trackCommand("cmd-1", "crud.stage");
    expect(getCommandState("cmd-1")).toBe("pending");
  });

  it("approves commands", () => {
    const { trackCommand, approveCommand, getCommandState } =
      useAiCommandPermissionStore.getState();
    trackCommand("cmd-1", "crud.stage");
    approveCommand("cmd-1");
    expect(getCommandState("cmd-1")).toBe("approved");
  });

  it("rejects commands", () => {
    const { trackCommand, rejectCommand, getCommandState } =
      useAiCommandPermissionStore.getState();
    trackCommand("cmd-1", "crud.stage");
    rejectCommand("cmd-1");
    expect(getCommandState("cmd-1")).toBe("rejected");
  });

  it("auto-approves when allowAllThisConversation is true", () => {
    const { setAllowAll, shouldAutoApprove } = useAiCommandPermissionStore.getState();
    setAllowAll(true);
    // crud.stage is approve-level, so it auto-approves with allowAll
    expect(shouldAutoApprove("crud.stage")).toBe(true);
  });

  it("auto-approves auto-level commands", () => {
    const { shouldAutoApprove } = useAiCommandPermissionStore.getState();
    // These are auto-approve level
    expect(shouldAutoApprove("tab.updateContent")).toBe(true);
    expect(shouldAutoApprove("tab.create")).toBe(true);
    expect(shouldAutoApprove("editor.insert")).toBe(true);
  });

  it("does not auto-approve approve-level commands without allowAll", () => {
    const { shouldAutoApprove } = useAiCommandPermissionStore.getState();
    // crud.stage is approve-level, needs explicit approval
    expect(shouldAutoApprove("crud.stage")).toBe(false);
  });

  it("resets on new conversation", () => {
    const store = useAiCommandPermissionStore.getState();
    store.setAllowAll(true);
    store.trackCommand("cmd-1", "crud.stage");
    store.approveCommand("cmd-1");

    store.reset();

    const state = useAiCommandPermissionStore.getState();
    expect(state.allowAllThisConversation).toBe(false);
    expect(state.commandStates.size).toBe(0);
  });

  describe("setCommandState", () => {
    it("updates command state to executing", () => {
      const { trackCommand, setCommandState, getCommandState } =
        useAiCommandPermissionStore.getState();
      trackCommand("cmd-1", "crud.stage");
      setCommandState("cmd-1", "executing");
      expect(getCommandState("cmd-1")).toBe("executing");
    });

    it("updates command state to completed", () => {
      const { trackCommand, setCommandState, getCommandState } =
        useAiCommandPermissionStore.getState();
      trackCommand("cmd-1", "tab.updateContent");
      setCommandState("cmd-1", "completed");
      expect(getCommandState("cmd-1")).toBe("completed");
    });

    it("updates command state to failed", () => {
      const { trackCommand, setCommandState, getCommandState } =
        useAiCommandPermissionStore.getState();
      trackCommand("cmd-1", "editor.insert");
      setCommandState("cmd-1", "failed");
      expect(getCommandState("cmd-1")).toBe("failed");
    });
  });

  describe("getCommandState", () => {
    it("returns pending for unknown commands", () => {
      const { getCommandState } = useAiCommandPermissionStore.getState();
      expect(getCommandState("unknown-cmd")).toBe("pending");
    });
  });

  describe("shouldAutoApprove", () => {
    it("returns false for unknown command names", () => {
      const { shouldAutoApprove } = useAiCommandPermissionStore.getState();
      // @ts-expect-error - Testing unknown command
      expect(shouldAutoApprove("unknown.command")).toBe(false);
    });

    it("returns false for approve-level commands without allowAll", () => {
      const { shouldAutoApprove } = useAiCommandPermissionStore.getState();
      // crud.stage is the only approve-level command remaining
      expect(shouldAutoApprove("crud.stage")).toBe(false);
    });

    it("returns true for approve-level commands with allowAll", () => {
      const { setAllowAll, shouldAutoApprove } = useAiCommandPermissionStore.getState();
      setAllowAll(true);
      expect(shouldAutoApprove("crud.stage")).toBe(true);
    });
  });
});
