import { PanelTabBar } from "./PanelTabBar";
import { TableViewPanel } from "./panels/TableViewPanel";
import { QueryPanel } from "./panels/QueryPanel";
import { SchemaViewPanel } from "./panels/SchemaViewPanel";
import { FunctionViewPanel } from "./panels/FunctionViewPanel";
import { ResultPanel } from "./panels/ResultPanel";
import { ERDPanel } from "./panels/ERDPanel";
import type { PanelState, TabState } from "@/types/workspaceScreen";
import { usePanelStore } from "@/stores/panelStore";

interface PanelProps {
  panel: PanelState;
  connectionId: string;
  isActive: boolean;
}

export function Panel({ panel, connectionId, isActive }: PanelProps) {
  const { 
    setActiveTabInPanel, 
    removeTabFromPanel, 
    updateTabInPanel, 
    addTabToPanel
  } = usePanelStore();
  // Get active tab
  const activeTab = panel.activeTabId 
    ? panel.tabs.get(panel.activeTabId)
    : undefined;

  const renderPanelContent = (tab: TabState) => {
    const props = {
      tab,
      connectionId,
      isActive,
      onUpdate: (updates: Partial<TabState>) => {
        updateTabInPanel(panel.id, tab.id, updates);
      },
      onClose: () => {
        removeTabFromPanel(panel.id, tab.id);
      },
    };

    switch (tab.type) {
      case "table":
        return <TableViewPanel {...props} />;
      case "query":
        return <QueryPanel {...props} />;
      case "schema":
        return <SchemaViewPanel {...props} />;
      case "function":
        return <FunctionViewPanel {...props} />;
      case "result":
        return <ResultPanel {...props} />;
      case "erd":
        return <ERDPanel {...props} />;
      default:
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Unknown tab type: {tab.type}
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <PanelTabBar
        panel={panel}
        onTabSelect={(tabId) => {
          setActiveTabInPanel(panel.id, tabId);
        }}
        onTabClose={(tabId) => {
          removeTabFromPanel(panel.id, tabId);
        }}
        onNewTab={() => {
          addTabToPanel(panel.id, {
            type: "query",
            connectionId,
            title: "New Query",
            payload: { sql: "" },
          });
        }}
      />

      {/* Panel Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab ? (
          renderPanelContent(activeTab)
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p className="text-lg font-medium mb-2">No tabs open</p>
              <p className="text-sm">Create a new tab to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}