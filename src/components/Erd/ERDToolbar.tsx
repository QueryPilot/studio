import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  PanelLeft,
  Plus,
  RefreshCw,
  Shuffle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ArrowRightLeft,
  ArrowUpDown,
} from "lucide-react";

export type LayoutDirection = "LR" | "TB";

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
              <PanelLeft className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isCodeVisible ? "Hide Code Editor" : "Show Code Editor"}
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
              <ZoomIn className="h-3.5 w-3.5" />
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
              <ZoomOut className="h-3.5 w-3.5" />
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
              <Maximize2 className="h-3.5 w-3.5" />
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
              <Shuffle className="h-3.5 w-3.5" />
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
              <RefreshCw className="h-3.5 w-3.5" />
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
              variant={layoutDirection === "LR" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                onLayoutDirectionChange?.("LR");
              }}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Horizontal Layout</TooltipContent>
        </Tooltip>
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
              <ArrowUpDown className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Vertical Layout</TooltipContent>
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
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New View</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
