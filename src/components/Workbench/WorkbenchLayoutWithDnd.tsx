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
}

export const WorkbenchLayout: React.FC<WorkbenchLayoutProps> = ({
  className,
}) => {
  const {
    layoutTree,
    focusedPanelId,
    initializeLayout,
    splitPanelAction,
    focusAdjacentPanel,
    undo,
    redo,
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

  useEffect(() => {
    if (!layoutTree) {
      initializeLayout();
    }
  }, [layoutTree, initializeLayout]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (!modKey) return;

      // Cmd+\ for split right, Cmd+Shift+\ for split down
      if (e.key === "\\") {
        console.log(`⌨️ Backslash key pressed, focusedPanelId: ${focusedPanelId}, shift: ${e.shiftKey}`);
        if (focusedPanelId) {
          e.preventDefault();
          const direction: Direction = e.shiftKey ? "down" : "right";
          console.log(`⌨️ Calling splitPanelAction via keyboard:`, {
            targetPanelId: focusedPanelId,
            direction,
            splitRatio: 0.5,
          });
          splitPanelAction({
            targetPanelId: focusedPanelId,
            direction,
            splitRatio: 0.5,
          });
        } else {
          console.warn('⌨️ No focused panel - cannot split');
        }
      }

      // Cmd+Alt+Left for split left
      if (e.key === "ArrowLeft" && e.altKey && focusedPanelId) {
        e.preventDefault();
        splitPanelAction({
          targetPanelId: focusedPanelId,
          direction: "left",
          splitRatio: 0.5,
        });
      }

      // Cmd+Alt+Up for split up
      if (e.key === "ArrowUp" && e.altKey && focusedPanelId) {
        e.preventDefault();
        splitPanelAction({
          targetPanelId: focusedPanelId,
          direction: "up",
          splitRatio: 0.5,
        });
      }

      // Cmd+W to close current tab
      if (e.key === "w" && !e.shiftKey && focusedPanelId) {
        e.preventDefault();
        const state = useWorkbenchStore.getState();
        const panel = state.panelContents.get(focusedPanelId);
        if (panel && panel.activeTabId) {
          state.removeTab(focusedPanelId, panel.activeTabId);
        }
      }

      // Cmd+Shift+W to close panel
      if (e.key === "w" && e.shiftKey && focusedPanelId) {
        e.preventDefault();
        const state = useWorkbenchStore.getState();
        state.closePanelAction(focusedPanelId);
      }

      // Undo/Redo
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        redo();
      }

      if (e.key === "k") {
        const keyHandler = (e2: KeyboardEvent) => {
          e2.preventDefault();
          const directionMap: Record<string, Direction> = {
            ArrowLeft: "left",
            ArrowRight: "right",
            ArrowUp: "up",
            ArrowDown: "down",
          };

          const direction = directionMap[e2.key];
          if (direction) {
            focusAdjacentPanel(direction);
          }

          window.removeEventListener("keydown", keyHandler);
        };

        window.addEventListener("keydown", keyHandler);
        setTimeout(() => {
          window.removeEventListener("keydown", keyHandler);
        }, 1000);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [focusedPanelId, splitPanelAction, focusAdjacentPanel, undo, redo]);

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

    console.log("🚀 Global drag started:", active.id, active.data.current);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    console.log("🔄 Drag over:", { active: active?.id, over: over?.id });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    console.log("🏁 Global drag ended:", {
      active: active?.id,
      over: over?.id,
      activeData: active?.data.current,
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

    console.log(
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
        console.error('Invalid drop position:', position);
        return;
      }

      const state = useWorkbenchStore.getState();
      const sourcePanel = state.panelContents.get(sourcePanelId);
      const tabMetadata = sourcePanel?.metadata?.[tabId];

      const newPanelId = `panel-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 11)}`;

      // Always create the split with the tab in the new panel
      console.log(`🔨 Calling splitPanelAction:`, {
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
      <div
        className={cn(
          "workbench-layout h-full overflow-hidden border-x border-b border-border",
          className,
        )}
      >
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
