import { useDraggable } from "@dnd-kit/core";
import { X, Table, Code, Database, FunctionSquare, Eye } from "lucide-react";
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
        // Check if it's a view or materialized view
        if (tab.payload.isView) {
          // Check if it's a materialized view
          if (tab.payload.kind === "MaterializedView") {
            return (
              <Eye
                className={cn(
                  "h-3.5 w-3.5",
                  isActive ? "text-purple-500" : "text-purple-500/60",
                )}
              />
            );
          }
          return (
            <Eye
              className={cn(
                "h-3.5 w-3.5",
                isActive ? "text-green-500" : "text-green-500/60",
              )}
            />
          );
        }
        return (
          <Table
            className={cn(
              "h-3.5 w-3.5",
              isActive ? "text-blue-500" : "text-blue-500/60",
            )}
          />
        );
      case "query":
        return (
          <Code
            className={cn(
              "h-3.5 w-3.5",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          />
        );
      case "schema":
        return (
          <Database
            className={cn(
              "h-3.5 w-3.5",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          />
        );
      case "function":
        return (
          <FunctionSquare
            className={cn(
              "h-3.5 w-3.5",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          />
        );
      default:
        return null;
    }
  };
  console.log(">>>", "tab", tab);
  return (
    <TabContextMenu tab={tab}>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "relative flex items-center gap-1.5 px-2 h-8 min-w-[120px] cursor-pointer group transition-colors",
          "border-r border-border/50",
          isActive ? "bg-background" : "bg-muted/20 hover:bg-muted/40",
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

        <div className="flex-shrink-0 relative w-3.5 h-3.5">
          <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity">
            {getTabIcon(tab.type)}
          </div>
          <button
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
        <span
          className={cn(
            "text-xs select-none whitespace-nowrap",
            isActive ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {tab.title}
        </span>
      </div>
    </TabContextMenu>
  );
}
