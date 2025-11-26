import { logger } from "@/lib/logger";
import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { GridRenderer } from "./GridRenderer";
import { type Direction } from "@/types/workbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";

interface WorkbenchLayoutProps {
  className?: string;
  connectionId?: string;
  database?: string;
}

export const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({
  className,
  connectionId,
}) => {
  const {
    layoutTree,
    setConnectionId,
    initializeLayout,
    splitPanelAction,
    moveTab,
  } = useWorkbenchStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTabInfo, setActiveTabInfo] = useState<{
    tabId: string;
    panelId: string;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  // Set connection ID when component mounts or connection changes
  useEffect(() => {
    if (connectionId) {
      setConnectionId(connectionId);
    }
  }, [connectionId, setConnectionId]);

  useEffect(() => {
    if (!layoutTree) {
      initializeLayout();
    }
  }, [layoutTree, initializeLayout]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);

    // Parse the tab and panel info from the draggable ID
    if (active.data.current) {
      const tabInfo = active.data.current as { tabId: string; panelId: string };
      setActiveTabInfo(tabInfo);

      // Update the global store so panels can react
      const state = useWorkbenchStore.getState();
      state.setDragContext({
        draggedTab: { id: tabInfo.tabId, panelId: tabInfo.panelId },
      });
    }

    logger.info("🚀 Global drag started:", active.id, active.data.current);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    logger.info("🔄 Drag over:", { active: active.id, over: over?.id });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    logger.info("🏁 Global drag ended:", {
      active: active.id,
      over: over?.id,
      activeData: active.data.current,
      overData: over?.data.current,
    });

    setActiveId(null);
    setActiveTabInfo(null);

    // Clear the global drag context
    const state = useWorkbenchStore.getState();
    state.clearDragContext();

    if (!over || !active.data.current || !over.data.current) return;

    const activeData = active.data.current as {
      tabId: string;
      panelId: string;
    };
    const overData = over.data.current as { panelId: string; position: string };

    const { tabId, panelId: sourcePanelId } = activeData;
    const { panelId: targetPanelId, position } = overData;

    logger.info(
      `💧 Processing drop: ${tabId} from ${sourcePanelId} to ${targetPanelId} at ${position}`,
    );

    if (position === "center") {
      // Move tab to existing panel (only if different panels)
      if (sourcePanelId !== targetPanelId) {
        moveTab(tabId, sourcePanelId, targetPanelId);
        // Focus the target panel and activate the moved tab
        const state = useWorkbenchStore.getState();
        state.focusPanel(targetPanelId);
        state.setActiveTab(targetPanelId, tabId);
      }
    } else {
      // Create new panel with tab
      const directionMap: Record<string, Direction> = {
        top: "up",
        bottom: "down",
        left: "left",
        right: "right",
      };

      const direction = directionMap[position];
      if (!direction) {
        logger.error("Invalid drop position:", position);
        return;
      }

      const state = useWorkbenchStore.getState();
      const sourcePanel = state.panelContents.get(sourcePanelId);
      const tabMetadata = sourcePanel?.metadata?.[tabId];

      const newPanelId = `panel-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 11)}`;

      // Always create the split with the tab in the new panel
      logger.info(`🔨 Calling splitPanelAction:`, {
        targetPanelId,
        direction,
        newPanelId,
      });

      // Always create the split with the tab in the new panel
      splitPanelAction({
        targetPanelId,
        direction,
        newPanelContent: {
          id: newPanelId,
          type: "editor",
          tabIds: [tabId],
          activeTabId: tabId,
          metadata: tabMetadata ? { [tabId]: tabMetadata } : undefined,
        },
      });

      // Remove from source panel after split is created
      // Always remove the tab from source after successful split
      // The split already created a new panel with the tab
      setTimeout(() => {
        const updatedState = useWorkbenchStore.getState();
        const sourcePanel = updatedState.panelContents.get(sourcePanelId);

        if (sourcePanel) {
          updatedState.removeTab(sourcePanelId, tabId);
        }

        // Focus the new panel and activate the moved tab
        updatedState.focusPanel(newPanelId);
        updatedState.setActiveTab(newPanelId, tabId);
      }, 50);
    }
  };

  if (!layoutTree) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <div className="text-muted-foreground">Initializing workbench...</div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className={cn("workbench-layout h-full overflow-hidden", className)}>
        <GridRenderer node={layoutTree} className="h-full" />
      </div>

      <DragOverlay>
        {activeId && activeTabInfo && (
          <div className="px-3 py-1 text-sm rounded-md bg-primary text-primary-foreground shadow-lg">
            {activeTabInfo.tabId.split("-").pop()}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
};
