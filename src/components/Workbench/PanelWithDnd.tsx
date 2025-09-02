import React, { useCallback, useEffect, useState } from "react";
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
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
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
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `${panelId}-${tabId}`,
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
  onDrop: (position: DropPosition) => void;
}

const DroppableZone: React.FC<DroppableZoneProps> = ({
  panelId,
  position,
  onDrop,
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id: `${panelId}-drop-${position}`,
    data: { panelId, position },
  });

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
        isOver ? "opacity-100 bg-primary/30" : "opacity-50 hover:opacity-100",
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
    moveTab,
  } = useWorkbenchStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const isFocused = focusedPanelId === content.id;

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

  const handleDragStart = (event: any) => {
    const { active } = event;
    setActiveId(active.id);
    setIsDragActive(true);
    console.log(`🚀 Drag started: ${active.id}`, active.data.current);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    setActiveId(null);
    setIsDragActive(false);

    console.log(`🏁 Drag ended`, { active, over });

    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (!activeData || !overData) return;

    const { tabId, panelId: sourcePanelId } = activeData;
    const { panelId: targetPanelId, position } = overData;

    console.log(
      `💧 Dropping ${tabId} from ${sourcePanelId} to ${targetPanelId} at ${position}`,
    );

    if (position === "center") {
      // Move tab to existing panel
      moveTab(tabId, sourcePanelId, targetPanelId);
    } else {
      // Create new panel with tab
      const directionMap: Record<
        DropPosition,
        "up" | "down" | "left" | "right"
      > = {
        top: "up",
        bottom: "down",
        left: "left",
        right: "right",
        center: "right",
      };

      const state = useWorkbenchStore.getState();
      const sourcePanel = state.panelContents.get(sourcePanelId);
      const tabMetadata = sourcePanel?.metadata?.[tabId];

      const newPanelId = `panel-${Date.now()}`;
      splitPanelAction({
        targetPanelId,
        direction: directionMap[position],
        newPanelContent: {
          id: newPanelId,
          type: "editor",
          tabIds: [tabId],
          activeTabId: tabId,
          metadata: tabMetadata ? { [tabId]: tabMetadata } : undefined,
        },
      });

      // Remove from source panel
      state.removeTab(sourcePanelId, tabId);
    }
  };

  const handleDragOver = (event: any) => {
    console.log(`🔄 Drag over`, event);
  };

  // Check if this panel is the source of the drag
  const draggedData = activeId ? activeId.split("-")[0] === content.id : false;
  const showDropZones = isDragActive && !draggedData;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
    >
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
          {showDropZones && (
            <>
              <DroppableZone
                panelId={content.id}
                position="top"
                onDrop={() => {}}
              />
              <DroppableZone
                panelId={content.id}
                position="bottom"
                onDrop={() => {}}
              />
              <DroppableZone
                panelId={content.id}
                position="left"
                onDrop={() => {}}
              />
              <DroppableZone
                panelId={content.id}
                position="right"
                onDrop={() => {}}
              />
              <DroppableZone
                panelId={content.id}
                position="center"
                onDrop={() => {}}
              />
            </>
          )}
        </div>
      </div>

      <DragOverlay>
        {activeId && (
          <div className="px-3 py-1 text-sm rounded-md bg-primary text-primary-foreground shadow-lg">
            Dragging...
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
};
