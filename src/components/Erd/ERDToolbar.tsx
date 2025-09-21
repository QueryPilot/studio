import React from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LayoutPanelTop,
  CodeXml,
  SplitSquareVertical,
  Plus,
  RefreshCw,
  Shuffle,
} from "lucide-react";

type ErdMode = "visual" | "code" | "split";

interface ERDToolbarProps {
  mode: ErdMode;
  onModeChange: (mode: ErdMode) => void;
  onCreateView?: () => void;
  onRefresh?: () => void;
  onAutoArrange?: () => void;
}

export const ERDToolbar: React.FC<ERDToolbarProps> = ({
  mode,
  onModeChange,
  onCreateView,
  onRefresh,
  onAutoArrange,
}) => {
  return (
    <div className="flex items-center justify-between border-b bg-muted/30 p-1">
      <Tabs
        value={mode}
        onValueChange={(value) => {
          onModeChange(value as ErdMode);
        }}
      >
        <TabsList className="grid grid-cols-3 h-8">
          <TabsTrigger
            value="visual"
            className="flex items-center gap-1 text-xs"
          >
            <LayoutPanelTop className="h-3 w-3" />
            Visual
          </TabsTrigger>
          <TabsTrigger value="code" className="flex items-center gap-1 text-xs">
            <CodeXml className="h-3 w-3" />
            Code
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            onAutoArrange?.();
          }}
          title="Auto Arrange"
        >
          <Shuffle className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            onCreateView?.();
          }}
          title="New View"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            onRefresh?.();
          }}
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};
