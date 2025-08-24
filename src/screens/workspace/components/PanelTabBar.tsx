import { Plus } from "lucide-react";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { DraggableTab } from "./DraggableTab";
import type { PanelState } from "@/types/workspaceScreen";

interface PanelTabBarProps {
  panel: PanelState;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
}

export function PanelTabBar({ 
  panel, 
  onTabSelect, 
  onTabClose, 
  onNewTab,
}: PanelTabBarProps) {
  return (
    <div 
      className="flex items-center h-9 border-b bg-background overflow-x-auto overflow-y-hidden scrollbar-thin"
      id={`panel-${panel.id}`}
      data-panel-id={panel.id}
      data-type="panel"
    >
      <div className="flex items-center flex-nowrap">
        <SortableContext
          items={panel.tabOrder}
          strategy={horizontalListSortingStrategy}
        >
          {/* Tabs */}
          {panel.tabOrder.map((tabId, index) => {
            const tab = panel.tabs.get(tabId);
            if (!tab) return null;
            
            const isActive = panel.activeTabId === tabId;
            
            return (
              <DraggableTab
                key={tabId}
                tab={tab}
                isActive={isActive}
                index={index}
                onSelect={() => onTabSelect(tabId)}
                onClose={() => onTabClose(tabId)}
              />
            );
          })}
        </SortableContext>
        
        {/* New Tab Button */}
        <button
          className="flex items-center justify-center h-9 min-w-[36px] px-2 hover:bg-muted/50 transition-colors border-r border-border/50 flex-shrink-0"
          onClick={onNewTab}
          title="New Tab"
        >
          <Plus className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}