/**
 * AI Command Permission Store
 *
 * Tracks approval state for AI-generated commands.
 * Supports per-command and conversation-level approval.
 */

import { create } from "zustand";
import { COMMAND_META, type AiCommandName } from "@/types/aiCommands";
import { usePreferencesStore } from "@/stores/preferencesStore";

export type CommandState =
  | "pending"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed";

interface AiCommandPermissionState {
  // Conversation-level setting
  allowAllThisConversation: boolean;

  // Per-command state: commandId -> state
  commandStates: Map<string, CommandState>;

  // Command name tracking: commandId -> commandName
  commandNames: Map<string, AiCommandName>;

  // Actions
  setAllowAll: (allow: boolean) => void;
  trackCommand: (commandId: string, commandName: AiCommandName) => void;
  approveCommand: (commandId: string) => void;
  rejectCommand: (commandId: string) => void;
  setCommandState: (commandId: string, state: CommandState) => void;
  getCommandState: (commandId: string) => CommandState;
  shouldAutoApprove: (commandName: AiCommandName) => boolean;
  reset: () => void;
}

export const useAiCommandPermissionStore = create<AiCommandPermissionState>()(
  (set, get) => ({
    allowAllThisConversation: false,
    commandStates: new Map(),
    commandNames: new Map(),

    setAllowAll: (allow) => {
      set({ allowAllThisConversation: allow });
    },

    trackCommand: (commandId, commandName) => {
      set((state) => {
        const commandStates = new Map(state.commandStates);
        const commandNames = new Map(state.commandNames);
        if (!commandStates.has(commandId)) {
          commandStates.set(commandId, "pending");
        }
        if (!commandNames.has(commandId)) {
          commandNames.set(commandId, commandName);
        }
        return { commandStates, commandNames };
      });
    },

    approveCommand: (commandId) => {
      set((state) => {
        const commandStates = new Map(state.commandStates);
        commandStates.set(commandId, "approved");
        return { commandStates };
      });
    },

    rejectCommand: (commandId) => {
      set((state) => {
        const commandStates = new Map(state.commandStates);
        commandStates.set(commandId, "rejected");
        return { commandStates };
      });
    },

    setCommandState: (commandId, newState) => {
      set((state) => {
        const commandStates = new Map(state.commandStates);
        commandStates.set(commandId, newState);
        return { commandStates };
      });
    },

    getCommandState: (commandId) => {
      return get().commandStates.get(commandId) ?? "pending";
    },

    shouldAutoApprove: (commandName) => {
      const meta = COMMAND_META[commandName] as
        | (typeof COMMAND_META)[AiCommandName]
        | undefined;
      if (!meta) return false;
      const globalBypass = usePreferencesStore.getState().skipApprovalGate;

      switch (meta.approvalLevel) {
        case "auto":
          // Auto-level commands always auto-approve
          return true;
        case "dangerous":
          // Dangerous commands never auto-approve
          return false;
        case "approve":
          // Approve-level commands auto-approve if conversation allow-all or global bypass is enabled
          return get().allowAllThisConversation || globalBypass;
      }
    },

    reset: () => {
      set({
        allowAllThisConversation: false,
        commandStates: new Map(),
        commandNames: new Map(),
      });
    },
  })
);
