import { useDraggable } from "@dnd-kit/core";
import { X, Table, Code, Database, FunctionSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabContextMenu } from "./TabContextMenu";
import type { TabState } from "@/types/workspaceScreen";

interface DraggableTabProps {
  tab: TabState;
  isActive: boolean;
  index: number;
  onSelect: () => void;
  onClose: () => void;
}

export function DraggableTab({
  tab,
  isActive,
  index,
  onSelect,
  onClose,
}: DraggableTabProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: tab.id,
      data: {
        type: "tab",
        tab,
        panelId: tab.panelId,
        title: tab.title,
      },
    });

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
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
    <TabContextMenu tab={tab}>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "relative flex items-center gap-1.5 px-2 h-9 min-w-[120px] cursor-pointer group transition-colors",
          "border-r border-border/50",
          isActive
            ? "bg-primary/10 text-primary-foreground"
            : "bg-muted/30 hover:bg-muted/50",
          index === 0 && "border-l",
          isDragging && "z-50 opacity-50",
        )}
        onClick={onSelect}
        {...attributes}
        {...listeners}
      >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
      )}

      <div className="flex-shrink-0">{getTabIcon(tab.type)}</div>
      <span
        className={cn(
          "text-xs select-none whitespace-nowrap",
          isActive ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {tab.title}
      </span>

      {/* Close button */}
      <button
        className={cn(
          "rounded hover:bg-muted/80 p-0.5 transition-opacity flex-shrink-0",
          "opacity-0 group-hover:opacity-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-4 w-4 text-muted-foreground" />
      </button>
      </div>
    </TabContextMenu>
  );
}
