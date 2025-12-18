import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { IconLayoutSidebar, IconPlus, IconRefresh, IconArrowsShuffle, IconZoomIn, IconZoomOut, IconMaximize, IconArrowsRightLeft, IconArrowsUpDown } from '@tabler/icons-react';

export type LayoutDirection = "LR" | "TB" | "RL" | "BT";

interface ERDToolbarProps {
  isCodeVisible: boolean;
  onToggleCodePanel: () => void;
  onCreateView?: () => void;
  onRefresh?: () => void;
  onAutoArrange?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
  layoutDirection?: LayoutDirection;
  onLayoutDirectionChange?: (direction: LayoutDirection) => void;
}

export const ERDToolbar: React.FC<ERDToolbarProps> = ({
  isCodeVisible,
  onToggleCodePanel,
  onCreateView,
  onRefresh,
  onAutoArrange,
  onZoomIn,
  onZoomOut,
  onFitView,
  layoutDirection = "LR",
  onLayoutDirectionChange,
}) => {
  return (
    <div className="flex items-center justify-between p-1.5">
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={isCodeVisible ? "secondary" : "ghost"}
                size="icon"
                aria-pressed={isCodeVisible}
                onClick={onToggleCodePanel}
              >
                <IconLayoutSidebar />
              </Button>
            }
          />
          <TooltipContent>
            {isCodeVisible ? "Hide IconCode Editor" : "Show IconCode Editor"}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex items-center gap-1">
        {/* Zoom Controls */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onZoomIn?.();
                }}
              >
                <IconZoomIn />
              </Button>
            }
          />
          <TooltipContent>Zoom In</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onZoomOut?.();
                }}
              >
                <IconZoomOut />
              </Button>
            }
          />
          <TooltipContent>Zoom Out</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onFitView?.();
                }}
              >
                <IconMaximize />
              </Button>
            }
          />
          <TooltipContent>Fit View</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onAutoArrange?.();
                }}
              >
                <IconArrowsShuffle />
              </Button>
            }
          />
          <TooltipContent>Auto Arrange</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onRefresh?.();
                }}
              >
                <IconRefresh />
              </Button>
            }
          />
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        {/* Divider */}
        <div className="h-5 w-px bg-border mx-0.5" />

        {/* Layout Direction Controls */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={layoutDirection === "TB" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => {
                  onLayoutDirectionChange?.("TB");
                }}
              >
                <IconArrowsUpDown />
              </Button>
            }
          />
          <TooltipContent>Vertical Layout</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={layoutDirection === "LR" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => {
                  onLayoutDirectionChange?.("LR");
                }}
              >
                <IconArrowsRightLeft />
              </Button>
            }
          />
          <TooltipContent>Horizontal Layout</TooltipContent>
        </Tooltip>
        {/* Divider */}
        <div className="h-5 w-px bg-border mx-0.5" />

        {/* Other Controls */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onCreateView?.();
                }}
              >
                <IconPlus />
              </Button>
            }
          />
          <TooltipContent>New View</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
