import { Button } from "@/components/ui/button";
import { Plus, X, Table, Code, Database, FunctionSquare, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PanelState } from "@/types/workspaceScreen";
import { usePanelStore } from "@/stores/panelStore";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverEvent,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";

interface DraggableTabBarProps {
  panel: PanelState;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onSplitPanel?: () => void;
}

interface SortableTabProps {
  tabId: string;
  panel: PanelState;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function SortableTab({ tabId, panel, isActive, onSelect, onClose }: SortableTabProps) {
  const tab = panel.tabs.get(tabId);
  if (!tab) return null;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tabId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getTabIcon = (type: string) => {
    switch (type) {
      case "table":
        return <Table className="h-3 w-3" />;
      case "query":
        return <Code className="h-3 w-3" />;
      case "schema":
        return <Database className="h-3 w-3" />;
      case "function":
        return <FunctionSquare className="h-3 w-3" />;
      default:
        return null;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 px-2 h-8 rounded-t cursor-pointer group",
        "border-b-2 transition-colors select-none",
        isActive 
          ? "bg-background border-primary" 
          : "hover:bg-muted/50 border-transparent",
        isDragging && "cursor-grabbing"
      )}
      onClick={onSelect}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>
      {getTabIcon(tab.type)}
      <span className="text-sm max-w-[120px] truncate">
        {tab.title}
      </span>
      <button
        className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function DraggableTabBar({ 
  panel, 
  onTabSelect, 
  onTabClose, 
  onNewTab,
  onSplitPanel,
}: DraggableTabBarProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { moveTabBetweenPanels, panels, setSplitMode, createPanel } = usePanelStore();
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;
    
    // Get the panel that the tab was dropped on
    const droppedPanelId = over.data.current?.panelId || panel.id;
    const activeTabId = active.id as string;
    
    if (droppedPanelId !== panel.id) {
      // Moving to a different panel
      moveTabBetweenPanels(activeTabId, panel.id, droppedPanelId);
    } else if (active.id !== over.id) {
      // Reordering within the same panel
      const oldIndex = panel.tabOrder.indexOf(activeTabId);
      const newIndex = panel.tabOrder.indexOf(over.id as string);
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = [...panel.tabOrder];
        newOrder.splice(oldIndex, 1);
        newOrder.splice(newIndex, 0, activeTabId);
        // TODO: Update tab order in store
      }
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    
    if (!over) return;
    
    // Check if dragging over a different panel
    const overPanelId = over.data.current?.panelId;
    
    if (overPanelId && overPanelId !== panel.id) {
      // Check if we need to create a split view
      const secondaryPanel = Array.from(panels.values()).find(p => p.type === "secondary");
      
      if (!secondaryPanel) {
        // Create secondary panel and enable split view
        const newPanelId = createPanel("secondary");
        setSplitMode("horizontal");
        
        // Move the tab to the new panel
        setTimeout(() => {
          moveTabBetweenPanels(active.id as string, panel.id, newPanelId);
        }, 0);
      }
    }
  };

  const activeTab = activeId ? panel.tabs.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
    >
      <div 
        className="flex items-center h-10 border-b bg-muted/20 px-2 gap-1 overflow-x-auto"
        data-panel-id={panel.id}
      >
        <SortableContext
          items={panel.tabOrder}
          strategy={horizontalListSortingStrategy}
        >
          {panel.tabOrder.map((tabId) => (
            <SortableTab
              key={tabId}
              tabId={tabId}
              panel={panel}
              isActive={panel.activeTabId === tabId}
              onSelect={() => onTabSelect(tabId)}
              onClose={() => onTabClose(tabId)}
            />
          ))}
        </SortableContext>
        
        {/* New Tab Button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={onNewTab}
        >
          <Plus className="h-4 w-4" />
        </Button>

        {/* Split Panel Button (only show for primary panel) */}
        {panel.type === "primary" && onSplitPanel && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 ml-auto"
            onClick={onSplitPanel}
            title="Split panel"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
              <line x1="12" y1="3" x2="12" y2="21" strokeWidth="2"/>
            </svg>
          </Button>
        )}
      </div>
      
      <DragOverlay>
        {activeTab && (
          <div className="flex items-center gap-2 px-3 h-8 rounded bg-background border shadow-lg">
            <span className="text-sm">{activeTab.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}