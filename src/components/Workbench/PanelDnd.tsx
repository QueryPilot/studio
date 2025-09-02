import React, { useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { type PanelContent, type DropPosition } from "@/types/workbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelContentRenderer } from "./PanelContentRenderer";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

interface DraggableTabProps {
  tabId: string;
  panelId: string;
  displayName: string;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}

const DraggableTab: React.FC<DraggableTabProps> = ({
  tabId,
  panelId,
  displayName,
  isActive,
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "px-3 py-1 text-sm rounded-md transition-colors flex items-center gap-1 cursor-move",
        isActive ? "bg-background border" : "hover:bg-muted/50",
        isDragging && "opacity-50",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
    >
      <span className="max-w-[120px] truncate">{displayName}</span>
      <button
        className="hover:bg-destructive/20 rounded p-0.5"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
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
        "panel flex flex-col bg-background h-full overflow-hidden relative border border-border",
        isFocused && "ring-1 ring-primary/50 border-primary/50",
        className,
      )}
      onClick={handleClick}
    >
      <div className="panel-header flex items-center justify-between h-8 px-2 bg-muted/20 border-b">
        <div className="flex items-center gap-1 overflow-x-auto">
          {content.tabIds.map((tabId) => {
            const metadata = content.metadata?.[tabId];
            const displayName =
              metadata?.title ||
              metadata?.table ||
              tabId.split("-").pop() ||
              tabId;

            return (
              <DraggableTab
                key={tabId}
                tabId={tabId}
                panelId={content.id}
                displayName={displayName}
                isActive={content.activeTabId === tabId}
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
            <span className="text-muted-foreground text-sm px-2">
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
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("right");
                }}
              >
                Split Right
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("down");
                }}
              >
                Split Down
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("left");
                }}
              >
                Split Left
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleSplit("up");
                }}
              >
                Split Up
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              closePanelAction(content.id);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
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
