import { memo, useMemo } from "react";
import { IconLoader2, IconCheck, IconX, IconClock } from "@tabler/icons-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTabStateStore } from "@/stores/tabStateStore";
import type { BackgroundQuery } from "@/stores/tabStateStore";
import { cn } from "@/lib/utils";

interface BackgroundQueryIndicatorProps {
  className?: string;
}

function formatDuration(startTime: number, endTime?: number): string {
  const duration = (endTime ?? Date.now()) - startTime;
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function truncateQuery(query: string, maxLength: number = 50): string {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

interface BackgroundQueryItemProps {
  query: BackgroundQuery;
  onClear: (queryId: string) => void;
}

const BackgroundQueryItem = memo(function BackgroundQueryItem({
  query,
  onClear,
}: BackgroundQueryItemProps) {
  const statusConfig = useMemo(() => {
    switch (query.status) {
      case "running":
        return {
          icon: <IconLoader2 className="w-4 h-4 animate-spin" />,
          color: "text-blue-500",
          bg: "bg-blue-500/10",
          label: "Running",
        };
      case "completed":
        return {
          icon: <IconCheck className="w-4 h-4" />,
          color: "text-green-500",
          bg: "bg-green-500/10",
          label: "Completed",
        };
      case "error":
        return {
          icon: <IconX className="w-4 h-4" />,
          color: "text-red-500",
          bg: "bg-red-500/10",
          label: "Failed",
        };
      case "cancelled":
        return {
          icon: <IconX className="w-4 h-4" />,
          color: "text-gray-500",
          bg: "bg-gray-500/10",
          label: "Cancelled",
        };
      default:
        return {
          icon: <IconClock className="w-4 h-4" />,
          color: "text-gray-500",
          bg: "bg-gray-500/10",
          label: "Unknown",
        };
    }
  }, [query.status]);

  const resultInfo = useMemo(() => {
    if (query.result) {
      if (query.result.error) {
        return `Error: ${truncateQuery(query.result.error, 60)}`;
      }
      if (query.result.affectedRows !== undefined) {
        return `${query.result.affectedRows} row(s) affected`;
      }
      return `${query.result.rowCount} row(s)`;
    }
    if (query.error) {
      return `Error: ${truncateQuery(query.error, 60)}`;
    }
    return null;
  }, [query.result, query.error]);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3 rounded-lg border",
        statusConfig.bg
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={statusConfig.color}>{statusConfig.icon}</div>
          <div className="flex flex-col min-w-0 flex-1">
            <code className="text-xs font-mono truncate">
              {truncateQuery(query.query)}
            </code>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-xs">
                {statusConfig.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDuration(query.startTime, query.endTime)}
              </span>
            </div>
          </div>
        </div>

        {query.status !== "running" && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onClear(query.id)}
            className="shrink-0"
            title="Clear"
          >
            <IconX className="w-3 h-3" />
          </Button>
        )}
      </div>

      {resultInfo && (
        <div className="text-xs text-muted-foreground pl-6">{resultInfo}</div>
      )}
    </div>
  );
});

export const BackgroundQueryIndicator = memo(function BackgroundQueryIndicator({
  className,
}: BackgroundQueryIndicatorProps) {
  const backgroundQueries = useTabStateStore((state) => state.getBackgroundQueries());
  const runningCount = useTabStateStore((state) => state.getRunningBackgroundQueriesCount());
  const clearBackgroundQuery = useTabStateStore((state) => state.clearBackgroundQuery);

  const sortedQueries = useMemo(() => {
    return [...backgroundQueries].sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (a.status !== "running" && b.status === "running") return 1;
      return b.startTime - a.startTime;
    });
  }, [backgroundQueries]);

  if (backgroundQueries.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger>
        <Button
          size="sm"
          variant="ghost"
          className={cn("relative", className)}
          title={`${runningCount} background ${runningCount === 1 ? "query" : "queries"} running`}
        >
          <IconClock className="w-4 h-4" />
          {runningCount > 0 && (
            <Badge
              variant="default"
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1 flex items-center justify-center text-xs"
            >
              {runningCount}
            </Badge>
          )}
          <span className="ml-1">Background</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Background Queries</h3>
            <Badge variant="secondary">
              {runningCount} running / {backgroundQueries.length} total
            </Badge>
          </div>

          <ScrollArea className="max-h-[400px]">
            <div className="flex flex-col gap-2">
              {sortedQueries.map((query) => (
                <BackgroundQueryItem
                  key={query.id}
                  query={query}
                  onClear={clearBackgroundQuery}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
});
