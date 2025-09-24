import { KeyboardManager } from "@/services/keyboard/KeyboardManager";
import type { CommandItem } from "../index";
import {
  Database,
  FileCode,
  RefreshCw,
  Play,
  Save,
  Layout,
  Plus,
  X,
} from "lucide-react";

export class DatabaseCommandProvider {
  private connectionId: string;
  private registeredCommands: (() => void)[] = [];

  constructor(connectionId: string) {
    this.connectionId = connectionId;
    this.registerKeyboardCommands();
  }

  private registerKeyboardCommands() {
    const manager = KeyboardManager.getInstance();
    const allCommands = this.getAllCommands();

    allCommands.forEach((command) => {
      if (command.shortcut) {
        const dispose = manager.registerCommand({
          id: command.id,
          title: command.label,
          handler: command.action,
          keybinding: {
            key: this.convertShortcut(command.shortcut),
            when: command.when,
          },
        });
        this.registeredCommands.push(dispose);
      }
    });
  }

  private convertShortcut(shortcut: string): string {
    return shortcut
      .replace(/Cmd\+/g, "cmd+")
      .replace(/Alt\+/g, "alt+")
      .replace(/Shift\+/g, "shift+")
      .replace(/Enter/g, "enter")
      .toLowerCase();
  }

  dispose() {
    this.registeredCommands.forEach((dispose) => {
      dispose();
    });
    this.registeredCommands = [];
  }

  getQueryCommands(): CommandItem[] {
    return [
      {
        id: "query.execute",
        label: "Execute Query",
        icon: <Play className="w-4 h-4" />,
        shortcut: "Cmd+Enter",
        description: "Run the current SQL query",
        category: "Query",
        action: async () => {
          // TODO: Implement
        },
        when: "activeView == 'queryEditor'",
      },
      {
        id: "query.format",
        label: "Format SQL",
        icon: <FileCode className="w-4 h-4" />,
        shortcut: "Alt+Shift+F",
        description: "Format the current SQL query",
        category: "Query",
        action: async () => {
          // TODO: Implement
        },
        when: "activeView == 'queryEditor'",
      },
      {
        id: "query.save",
        label: "Save Query",
        icon: <Save className="w-4 h-4" />,
        shortcut: "Cmd+S",
        description: "Save the current query",
        category: "Query",
        action: async () => {
          // TODO: Implement
        },
        when: "activeView == 'queryEditor'",
      },
      {
        id: "query.newTab",
        label: "New Query Tab",
        icon: <Plus className="w-4 h-4" />,
        shortcut: "Cmd+T",
        description: "Open a new query tab",
        category: "Query",
        action: async () => {
          // TODO: Implement
        },
        when: "activeView == 'queryEditor'",
      },
    ];
  }

  getViewCommands(): CommandItem[] {
    return [
      {
        id: "view.toggleSidebar",
        label: "Toggle Sidebar",
        icon: <Layout className="w-4 h-4" />,
        shortcut: "Cmd+B",
        description: "Show or hide the sidebar",
        category: "View",
        action: async () => {
          // TODO: Implement
        },
      },
      {
        id: "view.toggleAISidebar",
        label: "Toggle AI Assistant",
        icon: <Layout className="w-4 h-4" />,
        shortcut: "Cmd+Shift+A",
        description: "Show or hide AI assistant",
        category: "View",
        action: async () => {
          // TODO: Implement
        },
      },
    ];
  }

  getDatabaseCommands(): CommandItem[] {
    return [
      {
        id: "database.refresh",
        label: "Refresh Schema",
        icon: <RefreshCw className="w-4 h-4" />,
        shortcut: "Cmd+Shift+R",
        description: "Refresh database schema",
        category: "Database",
        action: async () => {
          // TODO: Implement
        },
      },
      {
        id: "database.disconnect",
        label: "Disconnect",
        icon: <Database className="w-4 h-4" />,
        description: "Disconnect from database",
        category: "Database",
        action: async () => {
          // TODO: Implement
        },
      },
    ];
  }

  getTabCommands(): CommandItem[] {
    return [
      {
        id: "tab.close",
        label: "Close Tab",
        icon: <X className="w-4 h-4" />,
        shortcut: "Cmd+W",
        description: "Close the current tab",
        category: "Navigation",
        action: async () => {
          // TODO: Implement
        },
      },
      {
        id: "tab.closeAll",
        label: "Close All Tabs",
        icon: <X className="w-4 h-4" />,
        description: "Close all open tabs",
        category: "Navigation",
        action: async () => {
          // TODO: Implement
        },
      },
      {
        id: "tab.closeOthers",
        label: "Close Other Tabs",
        icon: <X className="w-4 h-4" />,
        description: "Close all tabs except current",
        category: "Navigation",
        action: async () => {
          // TODO: Implement
        },
      },
    ];
  }

  getSchemaObjects(): CommandItem[] {
    // TODO: Implement
    return [];
  }

  getAllCommands(): CommandItem[] {
    const allCommands = [
      ...this.getQueryCommands(),
      ...this.getViewCommands(),
      ...this.getDatabaseCommands(),
      ...this.getTabCommands(),
    ];

    // Remove duplicates by id
    const uniqueCommands = allCommands.filter(
      (command, index, self) =>
        index === self.findIndex((c) => c.id === command.id),
    );

    return uniqueCommands;
  }
}
