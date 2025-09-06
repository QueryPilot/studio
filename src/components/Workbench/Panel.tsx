import React, { useCallback, useEffect, useState, useRef } from "react";
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
    setDragContext,
    clearDragContext,
  } = useWorkbenchStore();

  // Subscribe specifically to dragDropContext changes with proper selectors
  const draggedTab = useWorkbenchStore(
    (state) => state.dragDropContext.draggedTab,
  );
  const dragDropContext = useWorkbenchStore((state) => state.dragDropContext);

  const isFocused = focusedPanelId === content.id;
  const isDragActive = draggedTab !== null;
  const isSourcePanel = draggedTab?.panelId === content.id;
  const [isHovered, setIsHovered] = useState(false);
  const dragElementRef = useRef<HTMLElement | null>(null);

  // Debug logging - log when dragDropContext changes
  useEffect(() => {
    console.log(`🔄 Panel ${content.id} - dragDropContext changed:`, {
      isDragActive,
      isSourcePanel,
      draggedTab: dragDropContext.draggedTab,
      fullContext: dragDropContext,
    });

    if (isDragActive && !isSourcePanel) {
      console.log(`✅ Panel ${content.id} SHOULD show drop zones`);
    } else if (isDragActive && isSourcePanel) {
      console.log(`❌ Panel ${content.id} is SOURCE - NO drop zones`);
    } else {
      console.log(`❌ Panel ${content.id} - drag not active`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dragDropContext only used for logging
  }, [draggedTab, isDragActive, isSourcePanel, content.id]);

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

  const handleDropClick = useCallback(
    (position: DropPosition) => {
      if (!dragDropContext.draggedTab) return;

      const { id: tabId, panelId: sourcePanelId } = dragDropContext.draggedTab;
      console.log(
        `💧 Drop ${tabId} onto panel ${content.id} at position ${position}`,
      );

      const state = useWorkbenchStore.getState();

      if (position === "center") {
        // Move tab to existing panel (moveTab now handles metadata)
        state.moveTab(tabId, sourcePanelId, content.id);
      } else {
        // Get the source panel to copy metadata for new panel
        const sourcePanel = state.panelContents.get(sourcePanelId);
        const tabMetadata = sourcePanel?.metadata?.[tabId];

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

        const newPanelId = `panel-${Date.now()}`;
        splitPanelAction({
          targetPanelId: content.id,
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

      clearDragContext();
      setIsHovered(false); // Clear hover state after drop
    },
    [
      dragDropContext.draggedTab,
      content.id,
      splitPanelAction,
      clearDragContext,
    ],
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
              <div
                key={tabId}
                className={cn(
                  "px-3 py-1 text-sm rounded-md transition-colors flex items-center gap-1 cursor-pointer",
                  content.activeTabId === tabId
                    ? "bg-background border"
                    : "hover:bg-muted/50",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab(content.id, tabId);
                }}
                draggable
                onDragStart={(e) => {
                  console.log(
                    `🚀 Starting drag for tab: ${tabId} from panel: ${content.id}`,
                  );

                  // Set global drag state
                  setDragContext({
                    draggedTab: { id: tabId, panelId: content.id },
                  });

                  // Verify the state was set
                  setTimeout(() => {
                    const state = useWorkbenchStore.getState();
                    console.log(
                      `🔍 After setDragContext - dragDropContext:`,
                      state.dragDropContext,
                    );
                  }, 0);

                  e.dataTransfer.setData(
                    "tab",
                    JSON.stringify({
                      tabId,
                      sourcePanelId: content.id,
                    }),
                  );
                  e.dataTransfer.effectAllowed = "move";

                  // Create a custom drag image for better visual feedback
                  const dragElement = e.currentTarget.cloneNode(
                    true,
                  ) as HTMLElement;
                  dragElement.style.opacity = "0.8";
                  dragElement.style.transform = "rotate(-2deg)";
                  dragElement.style.backgroundColor = "var(--primary)";
                  dragElement.style.color = "var(--primary-foreground)";
                  dragElement.style.border = "2px solid var(--primary)";
                  dragElement.style.borderRadius = "6px";
                  dragElement.style.padding = "4px 8px";

                  document.body.appendChild(dragElement);
                  e.dataTransfer.setDragImage(dragElement, 10, 10);

                  // Store the drag element in the ref for cleanup later
                  dragElementRef.current = dragElement;
                }}
                onDragEnd={() => {
                  console.log(`🏁 Drag ended`);

                  // Clean up the drag element
                  if (
                    dragElementRef.current &&
                    document.body.contains(dragElementRef.current)
                  ) {
                    document.body.removeChild(dragElementRef.current);
                    dragElementRef.current = null;
                  }

                  clearDragContext();
                  setIsHovered(false); // Clear hover state when drag ends
                }}
              >
                <span className="max-w-[120px] truncate">{displayName}</span>
                <button
                  className="hover:bg-destructive/20 rounded p-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(content.id, tabId);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
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

      <div
        className="panel-body flex-1 overflow-hidden relative"
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log(
            `📥 DragEnter panel ${content.id}, isDragActive: ${isDragActive}, isSourcePanel: ${isSourcePanel}`,
          );
          if (isDragActive && !isSourcePanel) {
            console.log(`✅ Setting isHovered to true for panel ${content.id}`);
            setIsHovered(true);
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Only clear if leaving the panel entirely, not when entering child elements
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            console.log(`📤 DragLeave panel ${content.id}, clearing hover`);
            setIsHovered(false);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault(); // Required to allow drop
          e.stopPropagation();
        }}
        onDrop={(e) => {
          // Only handle drop if it's not on a drop zone
          const target = e.target as HTMLElement;
          if (!target.closest("[data-drop-zone]")) {
            e.preventDefault();
            e.stopPropagation();
            console.log(`📦 Drop on panel ${content.id} (not on drop zone)`);
            // Clear hover state on drop
            setIsHovered(false);
          }
        }}
      >
        {/* Render all tab contents but only show the active one */}
        {content.tabIds.length > 0 ? (
          content.tabIds.map((tabId) => (
            <div
              key={tabId}
              className={cn(
                "absolute inset-0",
                content.activeTabId === tabId ? "block" : "hidden"
              )}
            >
              <PanelContentRenderer
                tabId={tabId}
                metadata={content.metadata?.[tabId]}
              />
            </div>
          ))
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground p-4">
            <div className="text-center">
              <p className="text-sm">Empty Panel</p>
              <p className="text-xs mt-2">Split or drag a tab here</p>
            </div>
          </div>
        )}

        {/* Debug: Show state for drop zones */}
        {isDragActive && (
          <div className="absolute top-0 right-0 bg-yellow-500 text-black text-xs px-2 py-1 z-[100]">
            Panel: {content.id.slice(-4)} | Source:{" "}
            {isSourcePanel ? "YES" : "NO"} | Show Zones:{" "}
            {!isSourcePanel ? "YES" : "NO"}
          </div>
        )}

        {/* Drop Zones - Show on ALL panels except source when dragging */}
        {isDragActive && !isSourcePanel && (
          <>
            {/* Top Drop Zone */}
            <div
              data-drop-zone="top"
              className="absolute top-1 left-1 right-1 h-1/3 bg-primary/20 border-2 border-primary border-dashed rounded-md z-50 opacity-50 hover:opacity-100 transition-opacity duration-200 flex items-center justify-center group cursor-pointer"
              // onDragEnter={(e) => {
              //   e.preventDefault();
              //   e.stopPropagation();
              //   console.log(`🟢 DragEnter TOP zone - Panel ${content.id}`);
              // }}
              // onDragLeave={(e) => {
              //   e.preventDefault();
              //   e.stopPropagation();
              //   console.log(`🔴 DragLeave TOP zone - Panel ${content.id}`);
              // }}
              // onDragOver={(e) => {
              //   e.preventDefault();
              //   e.stopPropagation();
              // }}
              // onDrop={(e) => {
              //   e.preventDefault();
              //   e.stopPropagation();
              //   console.log(`📦 DROP on TOP zone - Panel ${content.id}`);
              //   handleDropClick("top");
              // }}
            >
              <div className="text-primary-foreground font-medium text-sm bg-primary/90 px-3 py-1 rounded shadow-lg group-hover:scale-105 transition-transform pointer-events-none">
                Split Up
              </div>
            </div>

            {/* Bottom Drop Zone */}
            <div
              data-drop-zone="bottom"
              className="absolute bottom-1 left-1 right-1 h-1/3 bg-primary/20 border-2 border-primary border-dashed rounded-md z-50 opacity-50 hover:opacity-100 transition-opacity duration-200 flex items-center justify-center group cursor-pointer"
              onDragOver={(e) => {
                // e.preventDefault();
                // e.stopPropagation();
                console.log(`🟢 DragOver BOTTOM zone - Panel ${content.id}`);
              }}
              onDrop={(e) => {
                // e.preventDefault();
                // e.stopPropagation();
                console.log(`📦 DROP on BOTTOM zone - Panel ${content.id}`);
                handleDropClick("bottom");
              }}
            >
              <div className="text-primary-foreground font-medium text-sm bg-primary/90 px-3 py-1 rounded shadow-lg group-hover:scale-105 transition-transform pointer-events-none">
                Split Down
              </div>
            </div>

            {/* Left Drop Zone */}
            <div
              data-drop-zone="left"
              className="absolute top-1 left-1 bottom-1 w-1/3 bg-primary/20 border-2 border-primary border-dashed rounded-md z-50 opacity-50 hover:opacity-100 transition-opacity duration-200 flex items-center justify-center group cursor-pointer"
              onDragOver={(e) => {
                // e.preventDefault();
                // e.stopPropagation();
                console.log(`🟢 DragOver BOTTOM zone - Panel ${content.id}`);
              }}
              onDrop={(e) => {
                // e.preventDefault();
                // e.stopPropagation();
                console.log(`📦 DROP on LEFT zone - Panel ${content.id}`);
                handleDropClick("left");
              }}
            >
              <div className="text-primary-foreground font-medium text-sm bg-primary/90 px-3 py-1 rounded shadow-lg group-hover:scale-105 transition-transform pointer-events-none">
                Split Left
              </div>
            </div>

            {/* Right Drop Zone */}
            <div
              data-drop-zone="right"
              className="absolute top-1 right-1 bottom-1 w-1/3 bg-primary/20 border-2 border-primary border-dashed rounded-md z-50 opacity-50 hover:opacity-100 transition-opacity duration-200 flex items-center justify-center group cursor-pointer"
              onDragOver={(e) => {
                // e.preventDefault();
                // e.stopPropagation();
                console.log(`🟢 DragOver RIGHT zone - Panel ${content.id}`);
              }}
              onDrop={(e) => {
                // e.preventDefault();
                // e.stopPropagation();
                console.log(`📦 DROP on RIGHT zone - Panel ${content.id}`);
                console.log(`💧 Calling handleDropClick with position: right`);
                handleDropClick("right");
              }}
            >
              <div className="text-primary-foreground font-medium text-sm bg-primary/90 px-3 py-1 rounded shadow-lg group-hover:scale-105 transition-transform pointer-events-none">
                Split Right
              </div>
            </div>

            {/* Center Drop Zone - Move tab to existing panel */}
            <div
              data-drop-zone="center"
              className="absolute inset-4 bg-primary/10 border-2 border-primary border-dashed rounded-md z-50 opacity-50 hover:opacity-100 transition-opacity duration-200 flex items-center justify-center group cursor-pointer"
              onDragEnter={(e) => {
                // e.preventDefault();
                // e.stopPropagation();
                console.log(`🟢 DragEnter CENTER zone - Panel ${content.id}`);
              }}
              onDragLeave={(e) => {
                // e.preventDefault();
                // e.stopPropagation();
                console.log(`🔴 DragLeave CENTER zone - Panel ${content.id}`);
              }}
              onDragOver={(e) => {
                // e.preventDefault();
                // e.stopPropagation();
                console.log(`🟢 DragOver CENTER zone - Panel ${content.id}`);
              }}
              onDrop={(e) => {
                // e.preventDefault();
                // e.stopPropagation();
                console.log(`📦 DROP on CENTER zone - Panel ${content.id}`);
                console.log(`💧 Calling handleDropClick with position: center`);
                console.log(`💧 Calling handleDropClick with position: center`);
                handleDropClick("center");
              }}
            >
              <div className="text-primary-foreground font-medium text-sm bg-primary/90 px-4 py-2 rounded shadow-lg group-hover:scale-105 transition-transform pointer-events-none">
                Move Tab Here
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
