import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  IconPlayerPlay,
  IconPlayerStop,
  IconWand,
  IconTrash,
} from "@tabler/icons-react";

interface MongoQueryToolbarProps {
  isExecuting: boolean;
  onExecute: () => void;
  onCancel: () => void;
  onFormat: () => void;
  onClear: () => void;
  hasQuery: boolean;
  hasResults: boolean;
}

export const MongoQueryToolbar = memo(function MongoQueryToolbar({
  isExecuting,
  onExecute,
  onCancel,
  onFormat,
  onClear,
  hasQuery,
  hasResults,
}: MongoQueryToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-1.5 px-2 py-1.5 bg-muted/20 border-b border-border/50">
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant={isExecuting ? "destructive" : "default"}
          onClick={isExecuting ? onCancel : onExecute}
          disabled={!hasQuery && !isExecuting}
          className="h-7 text-xs gap-1.5 px-3 font-medium shadow-sm transition-all"
        >
          {isExecuting ? (
            <>
              <IconPlayerStop className="h-3.5 w-3.5" />
              <span>Stop</span>
            </>
          ) : (
            <>
              <IconPlayerPlay className="h-3.5 w-3.5" />
              <span>Run</span>
            </>
          )}
        </Button>

        <div className="w-px h-4 bg-border mx-1" />

        <Button
          size="sm"
          variant="ghost"
          onClick={onFormat}
          disabled={isExecuting || !hasQuery}
          className="h-7 text-xs gap-1.5 px-2 text-muted-foreground hover:text-foreground"
          title="Format JSON"
        >
          <IconWand className="h-3.5 w-3.5" />
          <span>Format</span>
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
          disabled={!hasResults}
          className="h-7 text-xs gap-1.5 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          title="Clear Results"
        >
          <IconTrash className="h-3.5 w-3.5" />
          <span>Clear Results</span>
        </Button>
      </div>
    </div>
  );
});
