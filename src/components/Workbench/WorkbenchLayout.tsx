import { logger } from "@/lib/logger";
import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { GridRenderer } from "./GridRenderer";
import { Panel } from "./PanelDnd";
import { type Direction } from "@/types/workbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  IconTable,
  IconEye,
  IconMathFunction,
  IconBrandTabler,
} from "@tabler/icons-react";
import { PanelPortalProvider, PanelPortal } from "./PanelPortalContext";

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
    panelContents,
    focusedPanelId,
    setConnectionId,
    initializeLayout,
    splitPanelAction,
    moveTab,
  } = useWorkbenchStore();

  // Get stable list of panel IDs for rendering
  const panelIds = Array.from(panelContents.keys());

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTabInfo, setActiveTabInfo] = useState<{
    tabId: string;
    panelId: string;
    displayName?: string;
    tabType?: string;
    isView?: boolean;
    kind?: string;
  } | null>(null);
  // Track current pointer position for custom drag overlay
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(null);

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
    const { active, activatorEvent } = event;
    setActiveId(active.id as string);

    // Set initial pointer position from the activator event
    if (activatorEvent && "clientX" in activatorEvent && "clientY" in activatorEvent) {
      setPointerPosition({
        x: activatorEvent.clientX as number,
        y: activatorEvent.clientY as number,
      });
    }

    // Parse the tab and panel info from the draggable ID
    if (active.data.current) {
      const tabInfo = active.data.current as {
        tabId: string;
        panelId: string;
        displayName?: string;
        tabType?: string;
        isView?: boolean;
        kind?: string;
      };
      setActiveTabInfo(tabInfo);

      // Update the global store so panels can react
      const state = useWorkbenchStore.getState();
      state.setDragContext({
        draggedTab: { id: tabInfo.tabId, panelId: tabInfo.panelId },
      });
    }

    logger.info("🚀 Global drag started:", active.id, active.data.current);
  };

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    // Update pointer position during drag for custom overlay
    if (event.activatorEvent && "clientX" in event.activatorEvent) {
      // The delta represents how much the pointer moved since drag started
      // We need to add it to track the current position
      const activatorEvent = event.activatorEvent as PointerEvent;
      setPointerPosition({
        x: activatorEvent.clientX + event.delta.x,
        y: activatorEvent.clientY + event.delta.y,
      });
    }
  }, []);

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
    setPointerPosition(null);

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

  // Count total panels for focus border styling
  const totalPanels = panelIds.length;

  return (
    <PanelPortalProvider>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div
          className={cn("workbench-layout h-full overflow-hidden", className)}
        >
          <GridRenderer node={layoutTree} className="h-full" />
        </div>

        {/* Render all panels at a stable position in the tree */}
        {/* They will be portaled into their containers in GridRenderer */}
        {panelIds.map((panelId) => {
          const content = panelContents.get(panelId);
          if (!content) return null;
          return (
            <PanelPortal key={panelId} panelId={panelId}>
              <Panel
                content={content}
                className={cn(
                  "h-full rounded-xl overflow-hidden border-[3px]",
                  {
                    "border-primary/30":
                      totalPanels > 1 && panelId === focusedPanelId,
                    "border-background":
                      totalPanels <= 1 || panelId !== focusedPanelId,
                  },
                )}
              />
            </PanelPortal>
          );
        })}

      </DndContext>

      {/* Custom drag overlay that follows the cursor exactly using a portal */}
      {activeId && activeTabInfo && pointerPosition && createPortal(
        <div
          className="fixed pointer-events-none z-[9999]"
          style={{
            left: pointerPosition.x,
            top: pointerPosition.y,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md bg-background border border-border shadow-lg">
            {(() => {
              const { tabType, isView, kind } = activeTabInfo;
              let Icon = IconTable;
              let iconClass = "h-3.5 w-3.5 text-primary";

              if (tabType === "query") {
                Icon = IconBrandTabler;
              } else if (tabType === "function") {
                Icon = IconMathFunction;
                iconClass = "h-3.5 w-3.5 text-purple-500";
              } else if (tabType === "table" && isView) {
                Icon = IconEye;
                iconClass = kind === "MaterializedView"
                  ? "h-3.5 w-3.5 text-blue-500"
                  : "h-3.5 w-3.5 text-green-500";
              }

              return <Icon className={iconClass} />;
            })()}
            <span className="whitespace-nowrap font-medium">
              {activeTabInfo.displayName || activeTabInfo.tabId.split("-").pop()}
            </span>
          </div>
        </div>,
        document.body
      )}
    </PanelPortalProvider>
  );
};
