import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, Table, Code, Database, FunctionSquare } from "lucide-react";
import { cn } from "@/lib/utils";
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
  onClose 
}: DraggableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tab.id,
    data: {
      type: 'tab',
      tab,
      panelId: tab.panelId,
    },
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
        "relative flex items-center gap-1.5 px-3 h-9 min-w-[120px] max-w-[200px] cursor-pointer group transition-colors",
        "border-r border-border/50",
        isActive 
          ? "bg-background" 
          : "bg-muted/30 hover:bg-muted/50",
        index === 0 && "border-l",
        isDragging && "z-50"
      )}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
      )}
      
      <div className="flex-shrink-0">
        {getTabIcon(tab.type)}
      </div>
      <span className={cn(
        "text-sm select-none truncate flex-1 min-w-0",
        isActive ? "font-medium" : "text-muted-foreground"
      )}>
        {tab.title}
      </span>
      
      {/* Close button */}
      <button
        className={cn(
          "ml-1 rounded hover:bg-muted/80 p-0.5 transition-opacity flex-shrink-0",
          isActive
            ? "opacity-60 hover:opacity-100" 
            : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
        )}
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