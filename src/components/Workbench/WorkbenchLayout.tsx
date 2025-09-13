import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { GridRenderer } from "./GridRenderer";
import { type Direction } from "@/types/workbench";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useShortcut, KeyboardScope } from "@/services/keyboard";
import { useSyncWorkbenchState } from "@/services/keyboard/integration/storeIntegration";
import { windowManager } from "@/services/windowManager";
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
  database,
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

  // Sync workbench state with keyboard context
  useSyncWorkbenchState(!!focusedPanelId, layoutTree ? 1 : 0);

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

  // Register keyboard shortcuts using the new system
  useShortcut(
    "cmd+\\",
    () => {
      if (focusedPanelId) {
        splitPanelAction({
          targetPanelId: focusedPanelId,
          direction: "right",
          splitRatio: 0.5,
        });
      }
    },
    {
      preventDefault: true,
      description: "Split panel right",
    },
  );

  useShortcut(
    "cmd+shift+\\",
    () => {
      if (focusedPanelId) {
        splitPanelAction({
          targetPanelId: focusedPanelId,
          direction: "down",
          splitRatio: 0.5,
        });
      }
    },
    {
      preventDefault: true,
      description: "Split panel down",
    },
  );

  useShortcut(
    "cmd+alt+left",
    () => {
      if (focusedPanelId) {
        splitPanelAction({
          targetPanelId: focusedPanelId,
          direction: "left",
          splitRatio: 0.5,
        });
      }
    },
    {
      preventDefault: true,
      description: "Split panel left",
    },
  );

  useShortcut(
    "cmd+alt+up",
    () => {
      if (focusedPanelId) {
        splitPanelAction({
          targetPanelId: focusedPanelId,
          direction: "up",
          splitRatio: 0.5,
        });
      }
    },
    {
      preventDefault: true,
      description: "Split panel up",
    },
  );

  useShortcut(
    "cmd+t",
    () => {
      if (focusedPanelId) {
        const state = useWorkbenchStore.getState();
        const tabId = `query-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 11)}`;
        state.addTab(focusedPanelId, tabId, {
          type: "query",
          title: "New Query",
          isQuery: true,
          connectionId,
          database,
        });
      }
    },
    {
      preventDefault: true,
      description: "New query tab",
    },
  );

  useShortcut(
    "cmd+w",
    async () => {
      console.log("🔥 [CMD+W DEBUG] Shortcut triggered!");
      const state = useWorkbenchStore.getState();

      console.log("🔍 [CMD+W DEBUG] Initial state:", {
        focusedPanelId,
        panelCount: state.panelContents.size,
        layoutTreeExists: !!state.layoutTree,
        preventAutoInit: state.preventAutoInit,
      });

      // Direct window close only if it's the last panel AND it has no tabs
      if (state.panelContents.size === 1 && focusedPanelId) {
        const panel = state.panelContents.get(focusedPanelId);
        if (panel && panel.tabIds.length === 0) {
          console.log(
            "🪟 [CMD+W DEBUG] Last empty panel, closing window directly",
          );
          try {
            await windowManager.closeCurrentWindow();
            console.log("✅ [CMD+W DEBUG] Window close initiated successfully");
            return;
          } catch (error) {
            console.error("❌ [CMD+W DEBUG] Failed to close window:", error);
          }
        }
      }

      if (focusedPanelId) {
        const panel = state.panelContents.get(focusedPanelId);
        console.log("🔍 [CMD+W DEBUG] Focused panel:", {
          panelId: focusedPanelId,
          panelExists: !!panel,
          activeTabId: panel?.activeTabId,
          tabCount: panel?.tabIds?.length || 0,
        });

        if (panel && panel.activeTabId) {
          console.log(
            "📋 [CMD+W DEBUG] Closing active tab:",
            panel.activeTabId,
          );
          // Close the active tab
          state.removeTab(focusedPanelId, panel.activeTabId);

          // Check if panel is now empty after a small delay
          setTimeout(async () => {
            console.log("⏱️ [CMD+W DEBUG] Checking panel after tab removal...");
            const updatedState = useWorkbenchStore.getState();
            const updatedPanel = updatedState.panelContents.get(focusedPanelId);

            console.log("🔍 [CMD+W DEBUG] Updated panel state:", {
              panelExists: !!updatedPanel,
              tabCount: updatedPanel?.tabIds?.length || 0,
              isEmpty: !updatedPanel || updatedPanel.tabIds.length === 0,
            });

            if (!updatedPanel || updatedPanel.tabIds.length === 0) {
              console.log(
                "🗑️ [CMD+W DEBUG] Panel is empty, closing panel with preventAutoInit=true",
              );
              updatedState.closePanelAction(focusedPanelId, true);

              // Check if this was the last panel after closing
              setTimeout(async () => {
                console.log(
                  "⏱️ [CMD+W DEBUG] Checking if last panel after closing...",
                );
                const finalState = useWorkbenchStore.getState();
                console.log("🔍 [CMD+W DEBUG] Final state:", {
                  panelCount: finalState.panelContents.size,
                  layoutTreeExists: !!finalState.layoutTree,
                  preventAutoInit: finalState.preventAutoInit,
                });

                if (
                  finalState.panelContents.size === 0 ||
                  !finalState.layoutTree
                ) {
                  console.log(
                    "🪟 [CMD+W DEBUG] No panels left, attempting to close window...",
                  );
                  try {
                    await windowManager.closeCurrentWindow();
                    console.log(
                      "✅ [CMD+W DEBUG] Window close initiated successfully",
                    );
                  } catch (error) {
                    console.error(
                      "❌ [CMD+W DEBUG] Failed to close window:",
                      error,
                    );
                  }
                } else {
                  console.log(
                    "⚠️ [CMD+W DEBUG] Panels still exist, not closing window",
                  );
                }
              }, 50);
            } else {
              console.log(
                "📝 [CMD+W DEBUG] Panel still has tabs, not closing panel",
              );
            }
          }, 50);
        } else {
          console.log(
            "🗑️ [CMD+W DEBUG] No active tab, closing empty panel with preventAutoInit=true",
          );
          // No tabs in the panel, close the panel and prevent auto-init
          state.closePanelAction(focusedPanelId, true);

          // Check if this was the last panel after closing
          setTimeout(async () => {
            console.log(
              "⏱️ [CMD+W DEBUG] Checking if last panel after closing empty panel...",
            );
            const updatedState = useWorkbenchStore.getState();
            console.log("🔍 [CMD+W DEBUG] State after closing empty panel:", {
              panelCount: updatedState.panelContents.size,
              layoutTreeExists: !!updatedState.layoutTree,
              preventAutoInit: updatedState.preventAutoInit,
            });

            if (
              updatedState.panelContents.size === 0 ||
              !updatedState.layoutTree
            ) {
              console.log(
                "🪟 [CMD+W DEBUG] No panels left after empty panel close, attempting to close window...",
              );
              try {
                await windowManager.closeCurrentWindow();
                console.log(
                  "✅ [CMD+W DEBUG] Window close initiated successfully",
                );
              } catch (error) {
                console.error(
                  "❌ [CMD+W DEBUG] Failed to close window:",
                  error,
                );
              }
            } else {
              console.log(
                "⚠️ [CMD+W DEBUG] Panels still exist after empty panel close, not closing window",
              );
            }
          }, 50);
        }
      } else {
        console.log(
          "❓ [CMD+W DEBUG] No focused panel, checking if any panels exist",
        );
        // No focused panel, check if there are any panels at all
        const panels = state.panelContents;
        if (panels.size === 0 || !state.layoutTree) {
          console.log(
            "🪟 [CMD+W DEBUG] No panels at all, closing window immediately",
          );
          try {
            await windowManager.closeCurrentWindow();
            console.log("✅ [CMD+W DEBUG] Window close initiated successfully");
          } catch (error) {
            console.error("❌ [CMD+W DEBUG] Failed to close window:", error);
          }
        } else {
          console.log(
            "⚠️ [CMD+W DEBUG] Panels exist but no focus, not closing",
          );
        }
      }
    },
    {
      preventDefault: true,
      stopPropagation: true,
      description: "Close tab, panel, or window",
    },
  );

  useShortcut(
    "cmd+shift+w",
    () => {
      if (focusedPanelId) {
        const state = useWorkbenchStore.getState();
        state.closePanelAction(focusedPanelId);
      }
    },
    {
      preventDefault: true,
      stopPropagation: true,
      description: "Close panel",
    },
  );

  useShortcut("cmd+z", undo, {
    preventDefault: true,
    description: "Undo",
  });

  useShortcut("cmd+shift+z", redo, {
    preventDefault: true,
    description: "Redo",
  });

  useShortcut("cmd+y", redo, {
    preventDefault: true,
    description: "Redo",
  });

  // Navigation shortcuts with chord
  useShortcut(
    "cmd+k left",
    () => {
      focusAdjacentPanel("left");
    },
    {
      preventDefault: true,
      description: "Navigate left panel",
    },
  );

  useShortcut(
    "cmd+k right",
    () => {
      focusAdjacentPanel("right");
    },
    {
      preventDefault: true,
      description: "Navigate right panel",
    },
  );

  useShortcut(
    "cmd+k up",
    () => {
      focusAdjacentPanel("up");
    },
    {
      preventDefault: true,
      description: "Navigate up panel",
    },
  );

  useShortcut(
    "cmd+k down",
    () => {
      focusAdjacentPanel("down");
    },
    {
      preventDefault: true,
      description: "Navigate down panel",
    },
  );

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
    console.log("🔄 Drag over:", { active: active.id, over: over?.id });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    console.log("🏁 Global drag ended:", {
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
        console.error("Invalid drop position:", position);
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
    <KeyboardScope context="workbench">
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div
          className={cn(
            "workbench-layout h-full overflow-hidden border-x border-border",
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
    </KeyboardScope>
  );
};
