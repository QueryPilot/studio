import { type Command } from "@/types/command";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { useAcpStore } from "@/stores/acpStore";
import { useDialogStore } from "@/stores/ui/dialogStore";
import { editorRegistry } from "@/services/editorRegistry";
import { eventBus } from "@/services/eventBus";
import { toast } from "sonner";

/**
 * Opens the AI panel and ensures it's visible
 */
function openAiPanel(): void {
  const store = useWorkspaceScreenStore.getState();
  const sidebars = store.getSidebars();
  if (!sidebars.right) {
    store.toggleSidebar("right");
  }
  // Sync ACP panel state
  if (!useAcpStore.getState().isPanelOpen) {
    useAcpStore.getState().togglePanel();
  }
}

/**
 * Ensures an ACP session exists and returns true if ready to send messages
 */
async function ensureSession(connectionId?: string): Promise<boolean> {
  const acpStore = useAcpStore.getState();

  // Check if we have agents available
  if (acpStore.availableAgents.length === 0) {
    try {
      await acpStore.loadAgents();
    } catch {
      toast.error("No AI agents available. Please install an ACP-compatible agent.");
      return false;
    }
  }

  // Still no agents?
  if (acpStore.availableAgents.length === 0) {
    toast.error("No AI agents available. Please install an ACP-compatible agent.");
    return false;
  }

  // Start a session if one doesn't exist
  if (!acpStore.activeSession) {
    try {
      await acpStore.startSession(connectionId);
    } catch (error) {
      toast.error("Failed to start AI session");
      console.error("Failed to start AI session:", error);
      return false;
    }
  }

  return true;
}

export const aiCommands: Command[] = [
  {
    id: "ai.togglePanel",
    label: "Toggle AI Assistant",
    category: "AI",
    handler: () => {
      useWorkspaceScreenStore.getState().toggleSidebar("right");
      useAcpStore.getState().togglePanel();
    },
  },
  {
    id: "ai.explainQuery",
    label: "AI: Explain Query",
    category: "AI",
    when: "editorTextFocus && queryEditor",
    description: "Ask AI to explain the current SQL query",
    handler: async () => {
      // Get SQL from the active editor
      const content = editorRegistry.getActiveContent();
      if (!content || !content.sql) {
        toast.info("No SQL to explain. Select some SQL or write a query first.");
        return;
      }

      const context = editorRegistry.getActiveContext();

      // Open the AI panel
      openAiPanel();

      // Ensure we have a session
      const isReady = await ensureSession(context?.connectionId);
      if (!isReady) {
        return;
      }

      // Build the explain prompt
      const sourceDescription = content.isSelection ? "selected SQL" : "SQL query";
      const prompt = `Explain this ${sourceDescription}:\n\n\`\`\`sql\n${content.sql}\n\`\`\``;

      // Build context JSON
      let contextJson: string | undefined;
      if (context) {
        contextJson = JSON.stringify({
          connectionId: context.connectionId,
          database: context.database,
          schema: context.schema,
        });
      }

      // Send the message
      try {
        await useAcpStore.getState().sendMessage(prompt, contextJson);
      } catch (error) {
        toast.error("Failed to send message to AI");
        console.error("Failed to send explain query request:", error);
      }
    },
  },
  {
    id: "ai.generateSQL",
    label: "AI: Generate SQL",
    category: "AI",
    description: "Generate SQL from natural language description",
    handler: async () => {
      const context = editorRegistry.getActiveContext();

      // Open the AI panel
      openAiPanel();

      // Ensure we have a session
      const isReady = await ensureSession(context?.connectionId);
      if (!isReady) {
        return;
      }

      // For generate SQL, we just open the panel and emit an event
      // The AI panel can listen for this to show a specific prompt or UI
      eventBus.emit("ai:generate-sql", {
        connectionId: context?.connectionId,
        database: context?.database,
        schema: context?.schema,
      });
    },
  },
  {
    id: "ai.openSettings",
    label: "AI: Open Settings",
    category: "AI",
    description: "Configure AI providers and models",
    handler: () => {
      // This could open the preferences dialog to AI section
      // For now we'll use the existing preferences command
      useDialogStore.getState().openPreferences();
    },
  },
];
