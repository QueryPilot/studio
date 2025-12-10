import { type Command } from "@/types/command";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { eventBus } from "@/services/eventBus";

export const aiCommands: Command[] = [
  {
    id: "ai.togglePanel",
    label: "Toggle AI Assistant",
    category: "AI",
    handler: () => {
      useWorkspaceScreenStore.getState().toggleSidebar("right");
    },
  },
  {
    id: "ai.explainQuery",
    label: "AI: Explain Query",
    category: "AI",
    when: "editorTextFocus && queryEditor",
    description: "Ask AI to explain the current SQL query",
    handler: () => {
      // Open AI panel and send explain request
      const store = useWorkspaceScreenStore.getState();
      const sidebars = store.getSidebars();
      if (!sidebars.right) {
        store.toggleSidebar("right");
      }
      eventBus.emit("ai:explain-query", {});
    },
  },
  {
    id: "ai.generateSQL",
    label: "AI: Generate SQL",
    category: "AI",
    description: "Generate SQL from natural language description",
    handler: () => {
      // Open AI panel for SQL generation
      const store = useWorkspaceScreenStore.getState();
      const sidebars = store.getSidebars();
      if (!sidebars.right) {
        store.toggleSidebar("right");
      }
      eventBus.emit("ai:generate-sql", {});
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
      const { useDialogStore } = require("@/stores/ui/dialogStore");
      useDialogStore.getState().openPreferences();
    },
  },
];
