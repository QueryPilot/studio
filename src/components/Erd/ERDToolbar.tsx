import React from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LayoutPanelTop,
  SplitSquareVertical,
  Plus,
  RefreshCw,
  Shuffle,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";

type ErdMode = "visual" | "split";

interface ERDToolbarProps {
  mode: ErdMode;
  onModeChange: (mode: ErdMode) => void;
  onCreateView?: () => void;
  onRefresh?: () => void;
  onAutoArrange?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
}

export const ERDToolbar: React.FC<ERDToolbarProps> = ({
  mode,
  onModeChange,
  onCreateView,
  onRefresh,
  onAutoArrange,
  onZoomIn,
  onZoomOut,
  onFitView,
}) => {
  return (
    <div className="flex items-center justify-between p-1.5">
      <Tabs
        value={mode}
        onValueChange={(value) => {
          onModeChange(value as ErdMode);
        }}
      >
        <TabsList className="grid grid-cols-2 h-8 ">
          <TabsTrigger
            value="visual"
            className="flex items-center gap-1 text-xs"
          >
            <LayoutPanelTop className="h-3 w-3" />
            Visual
          </TabsTrigger>

          <TabsTrigger
            value="split"
            className="flex items-center gap-1 text-xs"
          >
            <SplitSquareVertical className="h-3 w-3" />
            Split
          </TabsTrigger>
        </TabsList>
      </Tabs>
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
