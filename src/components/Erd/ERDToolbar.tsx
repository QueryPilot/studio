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
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={isCodeVisible ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              aria-pressed={isCodeVisible}
              onClick={onToggleCodePanel}
            >
              <IconLayoutSidebar className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isCodeVisible ? "Hide IconCode Editor" : "Show IconCode Editor"}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex items-center gap-1">
        {/* Zoom Controls */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                onZoomIn?.();
              }}
            >
              <IconZoomIn className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom In</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                onZoomOut?.();
              }}
            >
              <IconZoomOut className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom Out</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                onFitView?.();
              }}
            >
              <IconMaximize className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Fit View</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                onAutoArrange?.();
              }}
            >
              <IconArrowsShuffle className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Auto Arrange</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                onRefresh?.();
              }}
            >
              <IconRefresh className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        {/* Divider */}
        <div className="h-5 w-px bg-border mx-0.5" />

        {/* Layout Direction Controls */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={layoutDirection === "TB" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                onLayoutDirectionChange?.("TB");
              }}
            >
              <IconArrowsUpDown className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Vertical Layout</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={layoutDirection === "LR" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                onLayoutDirectionChange?.("LR");
              }}
            >
              <IconArrowsRightLeft className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Horizontal Layout</TooltipContent>
        </Tooltip>
        {/* Divider */}
        <div className="h-5 w-px bg-border mx-0.5" />

        {/* Other Controls */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                onCreateView?.();
              }}
            >
              <IconPlus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New View</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
