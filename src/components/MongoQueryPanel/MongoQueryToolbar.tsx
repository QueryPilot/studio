import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  IconDotsVertical,
  IconLayoutRows,
  IconPlayerPlay,
  IconPlayerStop,
  IconWand,
} from "@tabler/icons-react";

export type MongoResultViewMode = "data" | "json";

interface MongoQueryToolbarProps {
  isExecuting: boolean;
  onExecute: () => void;
  onCancel: () => void;
  onFormat: () => void;
  hasQuery: boolean;
  showResults: boolean;
  viewMode: MongoResultViewMode;
  onToggleResults: () => void;
  onViewModeChange: (mode: MongoResultViewMode) => void;
}

export const MongoQueryToolbar = memo(function MongoQueryToolbar({
  isExecuting,
  onExecute,
  onCancel,
  onFormat,
  hasQuery,
  showResults,
  viewMode,
  onToggleResults,
  onViewModeChange,
}: MongoQueryToolbarProps) {
  return (
    <div className="@container/toolbar shrink-0">
      <div className="flex items-center justify-between gap-1.5 px-1.5 py-1 bg-muted/20">
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={showResults ? "secondary" : "ghost"}
            onClick={onToggleResults}
            className="!h-6 !w-6 !p-0"
            title={showResults ? "Hide results" : "Show results"}
            aria-label={showResults ? "Hide results" : "Show results"}
          >
            <IconLayoutRows className="h-3.5 w-3.5" />
          </Button>

          {showResults && (
            <Tabs
              value={viewMode}
              onValueChange={(value) => {
                onViewModeChange(value as MongoResultViewMode);
              }}
            >
              <TabsList className="!h-6 !p-0.5">
                <TabsTrigger value="data" className="text-xs !h-5 !px-2">
                  Data
                </TabsTrigger>
                <TabsTrigger value="json" className="text-xs !h-5 !px-2">
                  JSON
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={onFormat}
            disabled={isExecuting || !hasQuery}
            className="!h-6 text-xs gap-1 hidden @[500px]/toolbar:flex !px-2"
            title="Format JSON"
          >
            <IconWand className="h-3 w-3" />
            <span>Format</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={(props) => (
                <Button
                  {...props}
                  size="sm"
                  variant="ghost"
                  className="!h-6 !w-6 !p-0 @[500px]/toolbar:hidden"
                  title="More options"
                  aria-label="More options"
                >
                  <IconDotsVertical className="h-3.5 w-3.5" />
                </Button>
              )}
            />
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onClick={onFormat}
                disabled={isExecuting || !hasQuery}
                className="text-xs"
              >
                <IconWand className="h-3 w-3 mr-2" />
                Format JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {isExecuting ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={onCancel}
              className="!h-6 text-xs gap-1 !px-2.5"
              title="Cancel execution"
            >
              <IconPlayerStop className="h-3.5 w-3.5" />
              <span>Stop</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="default"
              onClick={onExecute}
              disabled={!hasQuery}
              className="!h-6 text-xs gap-1 !px-2.5"
              title="Execute query"
            >
              <IconPlayerPlay className="h-3.5 w-3.5" />
              <span>Run</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
