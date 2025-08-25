import { Panel as PanelComponent } from "./Panel";
import { usePanelStore } from "@/stores/panelStore";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  rectIntersection,
  useDroppable,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import type { TabState } from "@/types/workspaceScreen";

interface WorkspacePanelContainerProps {
  connectionId: string;
}

export function WorkspacePanelContainer({
  connectionId,
}: WorkspacePanelContainerProps) {
  const {
    panels,
    splitMode,
    setSplitMode,
    createPanel,
    moveTabBetweenPanels,
    // reorderTabInPanel,
  } = usePanelStore();
  const [draggedTab, setDraggedTab] = useState<TabState | null>(null);
  const [draggedFromPanelId, setDraggedFromPanelId] = useState<string | null>(
    null,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  // Get primary and secondary panels
  const [primaryPanel, secondaryPanel] = useMemo(
    () => [
      Array.from(panels.values()).find((p) => p.type === "primary"),
      Array.from(panels.values()).find((p) => p.type === "secondary"),
    ],
    [panels],
  );

  // Setup droppable zone for creating secondary panel
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: "new-secondary-panel",
    data: {
      type: "panel-drop-zone",
      panelId: "new-secondary",
    },
    disabled: !!secondaryPanel, // Only disable if secondary panel exists
  });

  // Debug panel state
  console.log("🔍 Panel state:", {
    totalPanels: panels.size,
    primaryPanel: primaryPanel
      ? {
          id: primaryPanel.id,
          type: primaryPanel.type,
          tabCount: primaryPanel.tabs.size,
        }
      : null,
    secondaryPanel: secondaryPanel
      ? {
          id: secondaryPanel.id,
          type: secondaryPanel.type,
          tabCount: secondaryPanel.tabs.size,
        }
      : null,
    splitMode,
    allPanels: Array.from(panels.values()).map((p) => ({
      id: p.id,
      type: p.type,
      tabCount: p.tabs.size,
    })),
  });

  // Setup droppable zones for existing panels
  const { setNodeRef: setPrimaryDropRef, isOver: isPrimaryOver } = useDroppable(
    {
      id: `panel-${primaryPanel?.id || "primary"}`,
      data: {
        type: "panel",
        panelId: primaryPanel?.id,
      },
      disabled: false, // Always enabled for testing
    },
  );

  const { setNodeRef: setSecondaryDropRef, isOver: isSecondaryOver } =
    useDroppable({
      id: `panel-${secondaryPanel?.id || "secondary"}`,
      data: {
        type: "panel",
        panelId: secondaryPanel?.id,
      },
      disabled: !secondaryPanel, // Only disable if panel doesn't exist
    });

  // Debug logging after all variables are defined
  if (draggedTab) {
    console.log("🔧 Drag state:", {
      primaryPanel: primaryPanel?.id,
      secondaryPanel: secondaryPanel?.id,
      splitMode,
      draggedTab: draggedTab?.id,
      draggedFromPanelId,
      dropZones: {
        newSecondaryDisabled: !!secondaryPanel,
        primaryDisabled: false,
        secondaryDisabled: !secondaryPanel,
      },
      hovering: {
        isOver,
        isPrimaryOver,
        isSecondaryOver,
      },
    });
  }

  const handleDragStart = (event: DragStartEvent) => {
    const tabId = event.active.id as string;
    const sourcePanel = Array.from(panels.values()).find((panel) =>
      panel.tabs.has(tabId),
    );

    console.log("🚀 DRAG START:", {
      tabId,
      sourcePanel: sourcePanel?.id,
    });

    if (sourcePanel) {
      const tab = sourcePanel.tabs.get(tabId);
      if (tab) {
        setDraggedTab(tab);
        setDraggedFromPanelId(sourcePanel.id);
        console.log("✅ Drag started for:", tab.title);
      }
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over, collisions } = event;

    // Log all collisions to see what's available
    console.log(
      "🌊 DRAG OVER - All collisions:",
      collisions?.map((c) => ({
        id: c.id,
        data: c.data?.droppableContainer?.data?.current,
      })),
    );

    if (!over || !draggedTab || !draggedFromPanelId) {
      console.log("🌊 DRAG OVER - early return:", {
        hasOver: !!over,
        hasDraggedTab: !!draggedTab,
        hasDraggedFromPanelId: !!draggedFromPanelId,
        allCollisions: collisions?.length || 0,
      });
      return;
    }

    const overId = over.id as string;
    const overData = over.data.current;

    console.log("🌊 DRAG OVER:", {
      overId,
      overType: overData?.type,
      overPanelId: overData?.panelId,
      overRect: over.rect,
      activeRect: active.rect,
      collisionRect: over.rect
        ? {
            x: over.rect.left,
            y: over.rect.top,
            w: over.rect.width,
            h: over.rect.height,
          }
        : null,
      totalCollisions: collisions?.length || 0,
    });

    // Skip tab reordering for now to focus on panel movement
    // TODO: Re-enable tab reordering after panel movement is working
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { over, active, collisions } = event;

    console.log("🎯 DRAG END - Full Event:", {
      hasOver: !!over,
      overId: over?.id,
      overData: over?.data?.current,
      activeId: active.id,
      allCollisions: collisions?.map((c) => ({
        id: c.id,
        data: c.data?.droppableContainer?.data?.current,
      })),
      draggedTab: draggedTab?.id,
      draggedFromPanelId,
    });

    if (!draggedTab || !draggedFromPanelId) {
      console.log("🚫 Missing drag state, cleaning up");
      setDraggedTab(null);
      setDraggedFromPanelId(null);
      return;
    }

    if (!over) {
      console.log("⚠️ No drop target detected");
      console.log(
        "📋 Available collisions were:",
        collisions?.map((c) => c.id),
      );
      setDraggedTab(null);
      setDraggedFromPanelId(null);
      return;
    }

    const overId = over.id as string;
    const activeId = active.id as string;
    const overData = over.data.current;

    console.log("🎯 DRAG END - Processing Drop:", {
      overId,
      overType: overData?.type,
      overPanelId: overData?.panelId,
      expectedDropZone: "new-secondary-panel",
      isCorrectDropZone: overId === "new-secondary-panel",
    });

    // Check if dropped on our test zone
    if (overId === "new-secondary-panel") {
      console.log("🎉 SUCCESS! Creating split panel");
      const newPanelId = createPanel("secondary");
      setSplitMode("horizontal");
      moveTabBetweenPanels(activeId, draggedFromPanelId, newPanelId);
    } else {
      console.log(
        "❌ Wrong drop zone. Expected: new-secondary-panel, Got:",
        overId,
      );
    }

    setDraggedTab(null);
    setDraggedFromPanelId(null);
  };

  if (splitMode === "none" || !secondaryPanel) {
    // Single panel view
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="h-full relative">
          {/* Primary panel */}
          {primaryPanel && (
            <PanelComponent
              panel={primaryPanel}
              connectionId={connectionId}
              isActive={true}
            />
          )}

          {/* Simple drop zone for creating split panel */}
          {draggedTab && !secondaryPanel && (
            <div
              ref={setDroppableRef}
              className="absolute inset-0 pointer-events-auto"
              style={{
                background: "rgba(59, 130, 246, 0.05)",
                zIndex: 9999,
                minHeight: "100%",
                minWidth: "100%",
              }}
              data-droppable-id="new-secondary-panel"
            >
              {/* Visual indicator overlay */}
              <div
                className="absolute right-0 top-0 bottom-0 pointer-events-none"
                style={{
                  width: "50%",
                  background: isOver
                    ? "rgba(59, 130, 246, 0.3)"
                    : "rgba(59, 130, 246, 0.1)",
                  border: "2px dashed rgba(59, 130, 246, 0.5)",
                }}
              >
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm font-medium">
                    {isOver ? "🎯 Release to split!" : "📍 Drop here to split"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DragOverlay>
          {draggedTab && (
            <div className="bg-background border rounded shadow-lg px-3 py-1">
              <span className="text-sm">{draggedTab.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    );
  }

  // Split panel view
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <ResizablePanelGroup
        direction={splitMode === "horizontal" ? "horizontal" : "vertical"}
        className="h-full"
      >
        <ResizablePanel defaultSize={50} minSize={20}>
          <div className="h-full relative" data-panel-id={primaryPanel?.id}>
            {primaryPanel && (
              <PanelComponent
                panel={primaryPanel}
                connectionId={connectionId}
                isActive={true}
              />
            )}

            {/* Primary panel drop zone */}
            {draggedTab && draggedFromPanelId !== primaryPanel?.id && (
              <div
                ref={setPrimaryDropRef}
                className="absolute inset-0"
                style={{
                  zIndex: 99998,
                  pointerEvents: "all",
                  background: isPrimaryOver
                    ? "rgba(34, 197, 94, 0.1)"
                    : "transparent",
                  border: isPrimaryOver
                    ? "2px dashed rgba(34, 197, 94, 0.4)"
                    : "none",
                  borderRadius: "0.375rem",
                }}
                data-panel-id={primaryPanel?.id}
                data-type="panel"
              >
                {isPrimaryOver && (
                  <div className="flex items-center justify-center h-full pointer-events-none">
                    <div className="text-center">
                      <p className="text-sm font-medium text-green-600">
                        Drop tab here
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={50} minSize={20}>
          <div className="h-full relative" data-panel-id={secondaryPanel?.id}>
            {secondaryPanel && (
              <PanelComponent
                panel={secondaryPanel}
                connectionId={connectionId}
                isActive={false}
              />
            )}

            {/* Secondary panel drop zone */}
            {draggedTab && draggedFromPanelId !== secondaryPanel?.id && (
              <div
                ref={setSecondaryDropRef}
                className="absolute inset-0"
                style={{
                  zIndex: 99998,
                  pointerEvents: "all",
                  background: isSecondaryOver
                    ? "rgba(168, 85, 247, 0.1)"
                    : "transparent",
                  border: isSecondaryOver
                    ? "2px dashed rgba(168, 85, 247, 0.4)"
                    : "none",
                  borderRadius: "0.375rem",
                }}
                data-panel-id={secondaryPanel?.id}
                data-type="panel"
              >
                {isSecondaryOver && (
                  <div className="flex items-center justify-center h-full pointer-events-none">
                    <div className="text-center">
                      <p className="text-sm font-medium text-purple-600">
                        Drop tab here
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <DragOverlay>
        {draggedTab && (
          <div className="bg-background border rounded shadow-lg px-3 py-1">
            <span className="text-sm">{draggedTab.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
