import React from "react";
import { cn } from "@/lib/utils";
import { X, Table2, Eye, FunctionSquare, Code } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

interface DraggableTabProps {
  tabId: string;
  panelId: string;
  displayName: string;
  isActive: boolean;
  isFocused: boolean;
  isLast: boolean;
  tabType?: string;
  isView?: boolean;
  kind?: "Table" | "View" | "MaterializedView";
  isNextActive?: boolean;
  onActivate: () => void;
  onClose: () => void;
}

export const DraggableTab: React.FC<DraggableTabProps> = ({
  tabId,
  panelId,
  displayName,
  isActive,
  isFocused,
  isLast,
  tabType = "table",
  isView,
  kind,
  isNextActive = false,
  onActivate,
  onClose,
}) => {
  const draggableId = `tab-${panelId}-${tabId}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: draggableId,
      data: { tabId, panelId },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  const getIcon = () => {
    switch (tabType) {
      case "table":
        if (isView) {
          return Eye;
        }
        return Table2;
      case "view":
        return Eye;
      case "function":
        return FunctionSquare;
      case "query":
        return Code;
      default:
        return Table2;
    }
  };

  const Icon = getIcon();

  // Determine icon color based on type
  const getIconClass = () => {
    if (tabType === "table" && isView) {
      if (kind === "MaterializedView") {
        return cn(
          "h-3.5 w-3.5",
          isActive && isFocused ? "text-blue-500" : "text-blue-500/60",
        );
      }
      return cn(
        "h-3.5 w-3.5",
        isActive && isFocused ? "text-green-500" : "text-green-500/60",
      );
    }
    if (tabType === "table") {
      return cn(
        "h-3.5 w-3.5",
        isActive && isFocused ? "text-primary" : "text-primary/60",
      );
    }
    return "h-3.5 w-3.5";
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        className={cn(
          "group px-2 py-1 text-xs h-8 transition-colors flex items-center gap-1.5 cursor-move relative group",
          {
            "bg-background rounded-t-xl text-foreground font-medium z-10 sticky left-0 right-0":
              isActive && isFocused,
            "bg-background/60 rounded-t-xl z-10 sticky left-0 right-0":
              isActive && !isFocused,
            "bg-muted": !isActive,
            "hover:bg-background/80": !isActive && !isFocused,
            "opacity-50": isDragging,
          },
        )}
        onClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
      >
        <div className="h-5 w-5 flex items-center justify-center flex-shrink-0">
          <button
            className="hidden group-hover:flex group-focus-within:flex items-center justify-center hover:bg-destructive/10 rounded transition-colors h-5 w-5"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <Icon
            className={cn(
              getIconClass(),
              "block group-hover:hidden group-focus-within:hidden",
            )}
          />
        </div>
        <span className="whitespace-nowrap pr-1">{displayName}</span>
      </div>

      <div
        className={cn("py-1.5 bg-muted/60", {
          "bg-transparent": !(!isLast && !isActive && !isNextActive),
        })}
      >
        <div
          className={cn("h-5 w-px min-w-px self-center", {
            "bg-muted-foreground/30": !isLast && !isActive && !isNextActive,
            "bg-transparent": !(!isLast && !isActive && !isNextActive),
          })}
        />
      </div>
    </>
  );
};
