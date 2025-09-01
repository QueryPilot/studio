import React, { useCallback, useState } from "react";
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
  } = useWorkbenchStore();

  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    const threshold = 0.25;
    let position: DropPosition = "center";

    if (x < w * threshold) position = "left";
    else if (x > w * (1 - threshold)) position = "right";
    else if (y < h * threshold) position = "top";
    else if (y > h * (1 - threshold)) position = "bottom";

    setDropPosition(position);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropPosition(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();

      const tabData = e.dataTransfer.getData("tab");
      if (tabData && dropPosition) {
        const { tabId, sourcePanelId } = JSON.parse(tabData);

        if (dropPosition === "center") {
          useWorkbenchStore
            .getState()
            .moveTab(tabId, sourcePanelId, content.id);
        } else {
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

          splitPanelAction({
            targetPanelId: content.id,
            direction: directionMap[dropPosition],
            newPanelContent: {
              id: "",
              type: "editor",
              tabIds: [tabId],
              activeTabId: tabId,
            },
          });

          useWorkbenchStore.getState().removeTab(sourcePanelId, tabId);
        }
      }

      setDropPosition(null);
    },
    [dropPosition, content.id, splitPanelAction],
  );

  return (
    <div
      className={cn(
        "panel flex flex-col bg-background h-full overflow-hidden relative border border-border",
        isFocused && "ring-1 ring-primary/50 border-primary/50",
        className,
      )}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
              <button
                key={tabId}
                className={cn(
                  "px-3 py-1 text-sm rounded-md transition-colors flex items-center gap-1",
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
                  e.dataTransfer.setData(
                    "tab",
                    JSON.stringify({
                      tabId,
                      sourcePanelId: content.id,
                    }),
                  );
                  e.dataTransfer.effectAllowed = "move";
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
              </button>
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

      <div className="panel-body flex-1 overflow-hidden">
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
      </div>

      {dropPosition && dropPosition !== "center" && (
        <div
          className={cn(
            "absolute bg-primary/20 border-2 border-primary pointer-events-none",
            dropPosition === "top" && "top-0 left-0 right-0 h-1/3",
            dropPosition === "bottom" && "bottom-0 left-0 right-0 h-1/3",
            dropPosition === "left" && "top-0 left-0 bottom-0 w-1/3",
            dropPosition === "right" && "top-0 right-0 bottom-0 w-1/3",
          )}
        />
      )}

      {dropPosition === "center" && (
        <div className="absolute inset-2 bg-primary/10 border-2 border-primary border-dashed rounded pointer-events-none" />
      )}
    </div>
  );
};
