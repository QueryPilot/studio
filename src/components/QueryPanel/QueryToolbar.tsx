import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StopCircle } from "lucide-react";
import { QueryLimitControl } from "./QueryLimitControl";
import { KeyboardShortcut } from "@/components/ui/keyboard-shortcut";

interface QueryToolbarProps {
  isExecuting: boolean;
  query: string;
  showHistory: boolean;
  viewMode: "table" | "json";
  appliedLimit?: number;
  executeHint?: string;
  beautifyHint?: string;
  onExecute: () => void;
  onCancel: () => void;
  onBeautify: () => void;
  onToggleHistory: () => void;
  onViewModeChange: (mode: "table" | "json") => void;
}

export const QueryToolbar = memo(function QueryToolbar({
  isExecuting,
  query,
  showHistory,
  viewMode,
  appliedLimit,
  executeHint,
  beautifyHint,
  onExecute,
  onCancel,
  onBeautify,
  onToggleHistory,
  onViewModeChange,
}: QueryToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-1 p-1 bg-muted/20 flex-shrink-0">
      <div className="flex items-center gap-1">
        <Tabs
          value={viewMode}
          onValueChange={(value) => {
            onViewModeChange(value as "table" | "json");
          }}
        >
          <TabsList className="!h-7">
            <TabsTrigger value="table" className="text-xs h-6">
              Table
            </TabsTrigger>
            <TabsTrigger value="json" className="text-xs h-6">
              JSON
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex items-center gap-2">
        <QueryLimitControl appliedLimit={appliedLimit} />

        <Button
          size="sm"
          variant={showHistory ? "secondary" : "ghost"}
          onClick={onToggleHistory}
          className="!h-7 text-xs gap-1"
          title="Toggle history panel"
        >
          <KeyboardShortcut
            keys={["⌥", "H"]}
            variant={showHistory ? "secondary" : "ghost"}
          />
          <span className="ml-1">History</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onBeautify}
          disabled={isExecuting || !query.trim()}
          className="!h-7 text-xs gap-1"
          title="Format SQL"
        >
          <KeyboardShortcut keys={["⌥", "F"]} variant="ghost" />
          <span className="ml-1">Format</span>
        </Button>

        <div className="w-px h-4 bg-border mx-1" />

        <Button
          size="sm"
          variant={isExecuting ? "destructive" : "default"}
          onClick={isExecuting ? onCancel : onExecute}
          disabled={!query.trim() && !isExecuting}
          className="!h-7 text-xs gap-1"
          title={
            isExecuting
              ? "Cancel execution"
              : executeHint
              ? `Execute query (${executeHint})`
              : "Execute query"
          }
        >
          {isExecuting ? (
            <>
              <StopCircle className="h-3.5 w-3.5" />
              <span className="ml-1">Cancel</span>
            </>
          ) : (
            <>
              <KeyboardShortcut keys={["⌘", "↵"]} variant="default" />
              <span className="ml-1">Run</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
});
