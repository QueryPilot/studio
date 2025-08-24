import { Button } from "@/components/ui/button";
import { Plus, X, Table, Code, Database, FunctionSquare, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PanelState } from "@/types/workspaceScreen";
import { usePanelStore } from "@/stores/panelStore";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SimpleTabBarProps {
  panel: PanelState;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onSplitPanel?: () => void;
}

interface DraggableTabProps {
  tabId: string;
  panel: PanelState;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function DraggableTab({ tabId, panel, isActive, onSelect, onClose }: DraggableTabProps) {
  const tab = panel.tabs.get(tabId);
  if (!tab) return null;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: tabId,
    data: {
      type: 'tab',
      panelId: panel.id,
      tab,
    }
  });

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

export function SimpleTabBar({ 
  panel, 
  onTabSelect, 
  onTabClose, 
  onNewTab,
  onSplitPanel,
}: SimpleTabBarProps) {
  const { panels } = usePanelStore();
  const hasSecondaryPanel = Array.from(panels.values()).some(p => p.type === "secondary");

  return (
    <div 
      className="flex items-center h-10 border-b bg-muted/20 px-2 gap-1 overflow-x-auto"
    >
      {panel.tabOrder.map((tabId) => (
        <DraggableTab
          key={tabId}
          tabId={tabId}
          panel={panel}
          isActive={panel.activeTabId === tabId}
          onSelect={() => onTabSelect(tabId)}
          onClose={() => onTabClose(tabId)}
        />
      ))}
      
      {/* New Tab Button */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={onNewTab}
      >
        <Plus className="h-4 w-4" />
      </Button>

      {/* Split Panel Button (only show for primary panel when no secondary exists) */}
      {panel.type === "primary" && !hasSecondaryPanel && onSplitPanel && (
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
  );
}