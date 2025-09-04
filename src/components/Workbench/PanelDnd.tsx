import React, { useCallback, useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { type PanelContent, type DropPosition } from "@/types/workbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import {
  X,
  Plus,
  Table2,
  Eye,
  FunctionSquare,
  Database,
  PanelRight,
  PanelBottom,
  PanelLeft,
  PanelTop,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { PanelContentRenderer } from "./PanelContentRenderer";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

interface DraggableTabProps {
  tabId: string;
  panelId: string;
  displayName: string;
  isActive: boolean;
  isFocused: boolean;
  isLast: boolean;
  tabType?: string;
  isNextActive?: boolean;
  onActivate: () => void;
  onClose: () => void;
}

const DraggableTab: React.FC<DraggableTabProps> = ({
  tabId,
  panelId,
  displayName,
  isActive,
  isFocused,
  isLast,
  tabType = "table",
  isNextActive = false,
  onActivate,
  onClose,
}) => {
  const [isHovered, setIsHovered] = useState(false);
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
      case "view":
        return Eye;
      case "function":
        return FunctionSquare;
      case "query":
        return Database;
      default:
        return Table2;
    }
  };

  const Icon = getIcon();

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        className={cn(
          "px-2 py-1 text-xs h-8 transition-colors flex items-center gap-1.5 cursor-move relative group",
          isActive && isFocused
            ? "bg-primary/50 text-foreground font-medium"
            : isActive
            ? "bg-primary/10"
            : "hover:bg-muted/30",
          isDragging && "opacity-50",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
        onMouseEnter={() => {
          setIsHovered(true);
        }}
        onMouseLeave={() => {
          setIsHovered(false);
        }}
      >
        <div className="h-4 w-4 flex items-center justify-center flex-shrink-0">
          {isHovered ? (
            <button
              className="hover:bg-destructive/20 rounded p-0.5 transition-colors h-4 w-4 flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Icon className="h-3.5 w-3.5" />
          )}
        </div>
        <span className="max-w-[120px] truncate">{displayName}</span>
      </div>
      {!isLast && !isActive && !isNextActive && (
        <div className="h-5 w-px bg-muted-foreground/30 self-center" />
      )}
    </>
  );
};

interface DroppableZoneProps {
  panelId: string;
  position: DropPosition;
  isVisible: boolean;
}

const DroppableZone: React.FC<DroppableZoneProps> = ({
  panelId,
  position,
  isVisible,
}) => {
  const droppableId = `drop-${panelId}-${position}`;
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: { panelId, position },
  });

  if (!isVisible) return null;

  const positionStyles: Record<DropPosition, string> = {
    top: "absolute top-1 left-1 right-1 h-1/3",
    bottom: "absolute bottom-1 left-1 right-1 h-1/3",
    left: "absolute top-1 left-1 bottom-1 w-1/3",
    right: "absolute top-1 right-1 bottom-1 w-1/3",
    center: "absolute inset-4",
  };

  const labels: Record<DropPosition, string> = {
    top: "Split Up",
    bottom: "Split Down",
    left: "Split Left",
    right: "Split Right",
    center: "Move Tab Here",
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        positionStyles[position],
        "bg-primary/20 border-2 border-primary border-dashed rounded-md z-50",
        "flex items-center justify-center group cursor-pointer transition-all duration-200",
        isOver
          ? "opacity-100 bg-primary/30 border-solid"
          : "opacity-50 hover:opacity-100",
      )}
    >
      <div className="text-primary-foreground font-medium text-sm bg-primary/90 px-3 py-1 rounded shadow-lg group-hover:scale-105 transition-transform pointer-events-none">
        {labels[position]}
      </div>
    </div>
  );
};

interface PanelProps {
  content: PanelContent;
  path?: number[];
  className?: string;
}

export const Panel: React.FC<PanelProps> = ({ content, className }) => {
  const {
    focusedPanelId,
    focusPanel,
    closePanelAction,
    splitPanelAction,
    setActiveTab,
    removeTab,
  } = useWorkbenchStore();

  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to drag state
  const draggedTab = useWorkbenchStore(
    (state) => state.dragDropContext.draggedTab,
  );
  const panelCount = useWorkbenchStore((state) => state.panelContents.size);
  const isDragActive = useWorkbenchStore(
    (state) => state.dragDropContext.draggedTab !== null,
  );
  const isSourcePanel = draggedTab?.panelId === content.id;
  // Show drop zones if dragging and either not source panel OR only one panel exists
  const showDropZones = isDragActive && (!isSourcePanel || panelCount === 1);

  const isFocused = focusedPanelId === content.id;

  // Auto-scroll to active tab when it changes
  useEffect(() => {
    if (tabsContainerRef.current && content.activeTabId) {
      const activeIndex = content.tabIds.indexOf(content.activeTabId);
      if (activeIndex >= 0) {
        const tabElements = tabsContainerRef.current.children;
        const activeTabElement = tabElements[activeIndex * 2]; // *2 because of dividers
        if (activeTabElement) {
          activeTabElement.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "center",
          });
        }
      }
    }
  }, [content.activeTabId, content.tabIds]);

  useEffect(() => {
    console.log(`Panel ${content.id} - Drag state:`, {
      isDragActive,
      isSourcePanel,
      showDropZones,
      draggedTab,
      panelCount,
      contentId: content.id,
    });
  }, [
    isDragActive,
    isSourcePanel,
    showDropZones,
    draggedTab,
    panelCount,
    content.id,
  ]);

  const handleClick = useCallback(() => {
    focusPanel(content.id);
  }, [focusPanel, content.id]);

  const handleSplit = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      splitPanelAction({
        targetPanelId: content.id,
        direction,
        splitRatio: 0.5,
      });
    },
    [splitPanelAction, content.id],
  );

  return (
    <div
      className={cn(
        "panel flex flex-col bg-background h-full overflow-hidden relative border border-border ",
        className,
      )}
      onClick={handleClick}
    >
      <div className="panel-header flex items-center justify-between bg-muted/20 border-b">
        <div
          ref={tabsContainerRef}
          className="flex items-center overflow-x-auto scrollbar-tabs"
        >
          {content.tabIds.map((tabId, index) => {
            const metadata = content.metadata?.[tabId];
            const displayName =
              metadata?.title ||
              metadata?.table ||
              tabId.split("-").pop() ||
              tabId;

            const nextTabId = content.tabIds[index + 1];
            const isNextActive = nextTabId
              ? content.activeTabId === nextTabId
              : false;

            return (
              <DraggableTab
                key={tabId}
                tabId={tabId}
                panelId={content.id}
                displayName={displayName}
                isActive={content.activeTabId === tabId}
                isFocused={isFocused}
                isLast={index === content.tabIds.length - 1}
                tabType={metadata?.type || "table"}
                isNextActive={isNextActive}
                onActivate={() => {
                  setActiveTab(content.id, tabId);
                  focusPanel(content.id);
                }}
                onClose={() => {
                  removeTab(content.id, tabId);
                }}
              />
            );
          })}

          {content.tabIds.length === 0 && (
            <span className="text-muted-foreground px-2 h-8 flex items-center text-xs font-bold">
              Empty Panel
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Plus className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("right");
                }}
              >
                <PanelRight className="mr-2 h-4 w-4" />
                Split Right
                <DropdownMenuShortcut>⌘\</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("down");
                }}
              >
                <PanelBottom className="mr-2 h-4 w-4" />
                Split Down
                <DropdownMenuShortcut>⌘⇧\</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("left");
                }}
              >
                <PanelLeft className="mr-2 h-4 w-4" />
                Split Left
                <DropdownMenuShortcut>⌘⌥←</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("up");
                }}
              >
                <PanelTop className="mr-2 h-4 w-4" />
                Split Up
                <DropdownMenuShortcut>⌘⌥↑</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  closePanelAction(content.id);
                }}
                className="text-destructive focus:text-destructive"
              >
                <X className="mr-2 h-4 w-4" />
                Close Panel
                <DropdownMenuShortcut>⌘⇧W</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="panel-body flex-1 overflow-hidden relative">
        {content.activeTabId && (
          <PanelContentRenderer
            tabId={content.activeTabId}
            metadata={content.metadata?.[content.activeTabId]}
          />
        )}
        {!content.activeTabId && (
          <div className="h-full flex items-center justify-center text-muted-foreground p-4">
            <div className="text-center">
              <p className="text-sm">Empty Panel</p>
              <p className="text-xs mt-2">Split or drag a tab here</p>
            </div>
          </div>
        )}

        {/* Drop Zones */}
        <DroppableZone
          panelId={content.id}
          position="top"
          isVisible={showDropZones}
        />
        <DroppableZone
          panelId={content.id}
          position="bottom"
          isVisible={showDropZones}
        />
        <DroppableZone
          panelId={content.id}
          position="left"
          isVisible={showDropZones}
        />
        <DroppableZone
          panelId={content.id}
          position="right"
          isVisible={showDropZones}
        />
        <DroppableZone
          panelId={content.id}
          position="center"
          isVisible={showDropZones}
        />
      </div>
    </div>
  );
};
