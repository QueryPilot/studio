import { logger } from "@/lib/logger";
import React, { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { type Direction } from "@/types/workbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  IconTable,
  IconEye,
  IconMathFunction,
  IconBrandTabler,
} from "@tabler/icons-react";

interface WorkbenchDndProviderProps {
  children: React.ReactNode;
}

/**
 * Provides the DndContext that wraps both sidebar and workbench areas,
 * enabling drag-and-drop from sidebar items to workbench panel drop zones.
 *
 * Extracted from WorkbenchLayout so the DndContext can sit higher in the tree
 * (at WorkspaceScreen level) while panel drop zones remain inside WorkbenchLayout.
 */
export const WorkbenchDndProvider: React.FC<WorkbenchDndProviderProps> = ({
  children,
}) => {
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
  const [pointerPosition, setPointerPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active, activatorEvent } = event;
    setActiveId(active.id as string);

    // Set initial pointer position from the activator event
    if (
      activatorEvent &&
      "clientX" in activatorEvent &&
      "clientY" in activatorEvent
    ) {
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
  }, []);

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

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

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
    const overData = over.data.current as {
      panelId: string;
      position: string;
    };

    const { tabId, panelId: sourcePanelId } = activeData;
    const { panelId: targetPanelId, position } = overData;

    if (position === "center") {
      // Move tab to existing panel (only if different panels)
      if (sourcePanelId !== targetPanelId) {
        const s = useWorkbenchStore.getState();
        s.moveTab(tabId, sourcePanelId, targetPanelId);
        // Focus the target panel and activate the moved tab
        s.focusPanel(targetPanelId);
        s.setActiveTab(targetPanelId, tabId);
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

      const s = useWorkbenchStore.getState();
      const sourcePanel = s.panelContents.get(sourcePanelId);
      const tabMetadata = sourcePanel?.metadata?.[tabId];

      const newPanelId = `panel-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 11)}`;

      s.splitPanelAction({
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
  }, []);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      {children}

      {/* Custom drag overlay that follows the cursor exactly using a portal */}
      {activeId &&
        activeTabInfo &&
        pointerPosition &&
        createPortal(
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
                  iconClass =
                    kind === "MaterializedView"
                      ? "h-3.5 w-3.5 text-blue-500"
                      : "h-3.5 w-3.5 text-green-500";
                }

                return <Icon className={iconClass} />;
              })()}
              <span className="whitespace-nowrap font-medium">
                {activeTabInfo.displayName ||
                  activeTabInfo.tabId.split("-").pop()}
              </span>
            </div>
          </div>,
          document.body,
        )}
    </DndContext>
  );
};
