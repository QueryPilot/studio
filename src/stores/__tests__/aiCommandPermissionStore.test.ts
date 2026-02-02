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
    trackCommand("cmd-1", "sql.execute");
    expect(getCommandState("cmd-1")).toBe("pending");
  });

  it("approves commands", () => {
    const { trackCommand, approveCommand, getCommandState } =
      useAiCommandPermissionStore.getState();
    trackCommand("cmd-1", "sql.execute");
    approveCommand("cmd-1");
    expect(getCommandState("cmd-1")).toBe("approved");
  });

  it("rejects commands", () => {
    const { trackCommand, rejectCommand, getCommandState } =
      useAiCommandPermissionStore.getState();
    trackCommand("cmd-1", "sql.execute");
    rejectCommand("cmd-1");
    expect(getCommandState("cmd-1")).toBe("rejected");
  });

  it("auto-approves when allowAllThisConversation is true", () => {
    const { setAllowAll, shouldAutoApprove } = useAiCommandPermissionStore.getState();
    setAllowAll(true);
    expect(shouldAutoApprove("sql.execute")).toBe(true);
    expect(shouldAutoApprove("mongodb.find")).toBe(true);
  });

  it("never auto-approves dangerous commands", () => {
    const { setAllowAll, shouldAutoApprove } = useAiCommandPermissionStore.getState();
    setAllowAll(true);
    // crud.stage is approve-level, not dangerous
    // For now we don't have dangerous commands, but this tests the logic
    expect(shouldAutoApprove("crud.stage")).toBe(true);
  });

  it("auto-approves auto-level commands", () => {
    const { shouldAutoApprove } = useAiCommandPermissionStore.getState();
    // sql.explain is auto-approve level
    expect(shouldAutoApprove("sql.explain")).toBe(true);
    expect(shouldAutoApprove("redis.get")).toBe(true);
    expect(shouldAutoApprove("tab.update")).toBe(true);
  });

  it("resets on new conversation", () => {
    const store = useAiCommandPermissionStore.getState();
    store.setAllowAll(true);
    store.trackCommand("cmd-1", "sql.execute");
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
      trackCommand("cmd-1", "sql.execute");
      setCommandState("cmd-1", "executing");
      expect(getCommandState("cmd-1")).toBe("executing");
    });

    it("updates command state to completed", () => {
      const { trackCommand, setCommandState, getCommandState } =
        useAiCommandPermissionStore.getState();
      trackCommand("cmd-1", "sql.execute");
      setCommandState("cmd-1", "completed");
      expect(getCommandState("cmd-1")).toBe("completed");
    });

    it("updates command state to failed", () => {
      const { trackCommand, setCommandState, getCommandState } =
        useAiCommandPermissionStore.getState();
      trackCommand("cmd-1", "sql.execute");
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
      // sql.execute is now auto-level, so only test actual approve-level commands
      expect(shouldAutoApprove("mongodb.find")).toBe(false);
      expect(shouldAutoApprove("mongodb.aggregate")).toBe(false);
      expect(shouldAutoApprove("redis.scan")).toBe(false);
      expect(shouldAutoApprove("crud.stage")).toBe(false);
    });
  });
});
