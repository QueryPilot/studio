import { usePanelStore } from '@/stores/panelStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useWorkspaceScreenStore } from '@/stores/workspaceScreenStore';
import { databaseService } from '@/services/databaseService';
import { tableDataService } from '@/services/tableDataService';
import { KeyboardManager } from '@/services/keyboard/KeyboardManager';
import type { CommandItem } from '../index';
import {
  Table,
  Eye,
  Database,
  FileCode,
  FunctionSquare,
  RefreshCw,
  Play,
  Save,
  FileText,
  Layout,
  Plus,
  X
} from 'lucide-react';

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

    allCommands.forEach(command => {
      if (command.shortcut) {
        const dispose = manager.registerCommand({
          id: command.id,
          title: command.label,
          handler: command.action,
          keybinding: {
            key: this.convertShortcut(command.shortcut),
            when: command.when
          }
        });
        this.registeredCommands.push(dispose);
      }
    });
  }

  private convertShortcut(shortcut: string): string {
    return shortcut
      .replace(/Cmd\+/g, 'cmd+')
      .replace(/Alt\+/g, 'alt+')
      .replace(/Shift\+/g, 'shift+')
      .replace(/Enter/g, 'enter')
      .toLowerCase();
  }

  dispose() {
    this.registeredCommands.forEach(dispose => dispose());
    this.registeredCommands = [];
  }

  getQueryCommands(): CommandItem[] {
    return [
      {
        id: 'query.execute',
        label: 'Execute Query',
        icon: <Play className="w-4 h-4" />,
        shortcut: 'Cmd+Enter',
        description: 'Run the current SQL query',
        category: 'Query',
        action: async () => {
          const panelStore = usePanelStore.getState();
          const activePanel = panelStore.getPanel(panelStore.activePanelId);
          if (activePanel?.type === 'query') {
            // Trigger query execution in active panel
            const event = new CustomEvent('executeQuery', {
              detail: { panelId: activePanel.id }
            });
            window.dispatchEvent(event);
          }
        },
        when: "activeView == 'queryEditor'"
      },
      {
        id: 'query.format',
        label: 'Format SQL',
        icon: <FileCode className="w-4 h-4" />,
        shortcut: 'Alt+Shift+F',
        description: 'Format the current SQL query',
        category: 'Query',
        action: async () => {
          const panelStore = usePanelStore.getState();
          const activePanel = panelStore.getPanel(panelStore.activePanelId);
          const event = new CustomEvent('formatQuery', {
            detail: { panelId: activePanel?.id }
          });
          window.dispatchEvent(event);
        },
        when: "activeView == 'queryEditor'"
      },
      {
        id: 'query.save',
        label: 'Save Query',
        icon: <Save className="w-4 h-4" />,
        shortcut: 'Cmd+S',
        description: 'Save the current query',
        category: 'Query',
        action: async () => {
          const panelStore = usePanelStore.getState();
          const activePanel = panelStore.getPanel(panelStore.activePanelId);
          const event = new CustomEvent('saveQuery', {
            detail: { panelId: activePanel?.id }
          });
          window.dispatchEvent(event);
        },
        when: "activeView == 'queryEditor'"
      },
      {
        id: 'query.newTab',
        label: 'New Query Tab',
        icon: <Plus className="w-4 h-4" />,
        shortcut: 'Cmd+T',
        description: 'Open a new query tab',
        category: 'Query',
        action: async () => {
          const panelStore = usePanelStore.getState();
          const activePanel = panelStore.getPanel(panelStore.activePanelId);
          if (activePanel) {
            panelStore.addTabToPanel(activePanel.id, {
              type: 'query',
              title: 'New Query',
              connectionId: this.connectionId,
              payload: {
                sql: ''
              }
            });
          }
        }
      }
    ];
  }

  getViewCommands(): CommandItem[] {
    return [
      {
        id: 'view.toggleSidebar',
        label: 'Toggle Sidebar',
        icon: <Layout className="w-4 h-4" />,
        shortcut: 'Cmd+B',
        description: 'Show or hide the sidebar',
        category: 'View',
        action: async () => {
          const workspaceStore = useWorkspaceScreenStore.getState();
          workspaceStore.toggleSidebar('left');
        }
      },
      {
        id: 'view.toggleAISidebar',
        label: 'Toggle AI Assistant',
        icon: <Layout className="w-4 h-4" />,
        shortcut: 'Cmd+Shift+A',
        description: 'Show or hide AI assistant',
        category: 'View',
        action: async () => {
          const workspaceStore = useWorkspaceScreenStore.getState();
          workspaceStore.toggleSidebar('right');
        }
      }
    ];
  }

  getDatabaseCommands(): CommandItem[] {
    return [
      {
        id: 'database.refresh',
        label: 'Refresh Schema',
        icon: <RefreshCw className="w-4 h-4" />,
        shortcut: 'Cmd+Shift+R',
        description: 'Refresh database schema',
        category: 'Database',
        action: async () => {
          const schemaStore = useSchemaStore.getState();
          await schemaStore.loadSchemas(this.connectionId);
        }
      },
      {
        id: 'database.disconnect',
        label: 'Disconnect',
        icon: <Database className="w-4 h-4" />,
        description: 'Disconnect from database',
        category: 'Database',
        action: async () => {
          await databaseService.disconnect(this.connectionId);
        }
      }
    ];
  }

  getTabCommands(): CommandItem[] {
    return [
      {
        id: 'tab.close',
        label: 'Close Tab',
        icon: <X className="w-4 h-4" />,
        shortcut: 'Cmd+W',
        description: 'Close the current tab',
        category: 'Navigation',
        action: async () => {
          const panelStore = usePanelStore.getState();
          const activePanel = panelStore.getPanel(panelStore.activePanelId);
          if (activePanel) {
            panelStore.removePanel(activePanel.id);
          }
        }
      },
      {
        id: 'tab.closeAll',
        label: 'Close All Tabs',
        icon: <X className="w-4 h-4" />,
        description: 'Close all open tabs',
        category: 'Navigation',
        action: async () => {
          const panelStore = usePanelStore.getState();
          const panels = Array.from(panelStore.panels.values());
          panels.forEach(panel => {
            panelStore.removePanel(panel.id);
          });
        }
      },
      {
        id: 'tab.closeOthers',
        label: 'Close Other Tabs',
        icon: <X className="w-4 h-4" />,
        description: 'Close all tabs except current',
        category: 'Navigation',
        action: async () => {
          const panelStore = usePanelStore.getState();
          const activePanel = panelStore.getPanel(panelStore.activePanelId);
          const panels = Array.from(panelStore.panels.values());
          panels.forEach(panel => {
            if (panel.id !== activePanel?.id) {
              panelStore.removePanel(panel.id);
            }
          });
        }
      }
    ];
  }

  getSchemaObjects(): CommandItem[] {
    const schemaStore = useSchemaStore.getState();
    const schemas = schemaStore.schemas.get(this.connectionId) || [];
    const items: CommandItem[] = [];

    schemas.forEach(schema => {
      // Add tables
      schema.tables?.forEach(table => {
        items.push({
          id: `table.${schema.name}.${table.name}`,
          label: table.name,
          icon: <Table className="w-4 h-4" />,
          description: `${schema.name}.${table.name}`,
          category: 'Tables',
          action: async () => {
            // Open table in new tab
            const panelStore = usePanelStore.getState();
            const activePanel = panelStore.getPanel(panelStore.activePanelId);
            if (activePanel) {
              panelStore.addTabToPanel(activePanel.id, {
                type: 'table',
                title: table.name,
                connectionId: this.connectionId,
                payload: {
                  schema: schema.name,
                  table: table.name
                }
              });
            }
          },
          keywords: ['table', schema.name]
        });
      });

      // Add views
      schema.views?.forEach(view => {
        items.push({
          id: `view.${schema.name}.${view.name}`,
          label: view.name,
          icon: <Eye className="w-4 h-4" />,
          description: `${schema.name}.${view.name}`,
          category: 'Views',
          action: async () => {
            const panelStore = usePanelStore.getState();
            const activePanel = panelStore.getPanel(panelStore.activePanelId);
            if (activePanel) {
              panelStore.addTabToPanel(activePanel.id, {
                type: 'view',
                title: view.name,
                connectionId: this.connectionId,
                payload: {
                  schema: schema.name,
                  view: view.name
                }
              });
            }
          },
          keywords: ['view', schema.name]
        });
      });

      // Add functions
      schema.functions?.forEach(func => {
        items.push({
          id: `function.${schema.name}.${func.name}`,
          label: func.name,
          icon: <FunctionSquare className="w-4 h-4" />,
          description: `${schema.name}.${func.name}`,
          category: 'Functions',
          action: async () => {
            const panelStore = usePanelStore.getState();
            const activePanel = panelStore.getPanel(panelStore.activePanelId);
            if (activePanel) {
              panelStore.addTabToPanel(activePanel.id, {
                type: 'function',
                title: func.name,
                connectionId: this.connectionId,
                payload: {
                  schema: schema.name,
                  function: func.name
                }
              });
            }
          },
          keywords: ['function', 'procedure', schema.name]
        });
      });
    });

    return items;
  }

  getAllCommands(): CommandItem[] {
    const allCommands = [
      ...this.getQueryCommands(),
      ...this.getViewCommands(),
      ...this.getDatabaseCommands(),
      ...this.getTabCommands()
    ];

    // Remove duplicates by id
    const uniqueCommands = allCommands.filter((command, index, self) =>
      index === self.findIndex(c => c.id === command.id)
    );

    return uniqueCommands;
  }
}