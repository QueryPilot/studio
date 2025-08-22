import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type TabState } from "@/types/workspace";
import { useConnectionHealthStore } from "@/stores/connectionHealthStore";
import { useSecureConnectionStore } from "@/stores/secureConnectionStore";
import {
  X,
  Database,
  FileText,
  Play,
  Table,
  Circle,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface SortableTabProps {
  tab: TabState;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}

const tabIcons = {
  query: Play,
  table: Table,
  schema: Database,
  result: FileText,
} as const;

export function SortableTab({
  tab,
  isActive,
  onActivate,
  onClose,
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const Icon = tabIcons[tab.type] || FileText;

  // Get connection information
  const connection = useSecureConnectionStore((s) =>
    s.connections.get(tab.connectionId),
  );
  const connectionHealth = useConnectionHealthStore((s) =>
    s.getHealth(tab.connectionId),
  );

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  // Connection status indicator
  const getConnectionStatusIcon = () => {
    if (!connectionHealth) {
      return <Circle className="h-2 w-2 text-muted-foreground" />;
    }

    switch (connectionHealth.status) {
      case "ready":
        return <Circle className="h-2 w-2 text-green-500 fill-current" />;
      case "degraded":
        return <Circle className="h-2 w-2 text-yellow-500 fill-current" />;
      case "reconnecting":
        return <Loader2 className="h-2 w-2 text-blue-500 animate-spin" />;
      case "error":
        return <AlertCircle className="h-2 w-2 text-red-500" />;
      default:
        return <Circle className="h-2 w-2 text-muted-foreground" />;
    }
  };

  const getConnectionStatusText = () => {
    if (!connectionHealth) {
      return "No health data";
    }

    const rttText = connectionHealth.rttMs
      ? ` (${connectionHealth.rttMs}ms)`
      : "";

    switch (connectionHealth.status) {
      case "ready":
        return `Ready${rttText}`;
      case "degraded":
        return `Degraded${rttText}`;
      case "reconnecting":
        return "Reconnecting...";
      case "error":
        return connectionHealth.reason || "Error";
      default:
        return "Unknown";
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            "group relative flex items-center gap-2 px-3 py-2 border-r border-border/50 bg-background cursor-pointer select-none transition-colors",
            {
              "bg-background border-b-2 border-b-primary": isActive,
              "hover:bg-muted/50": !isActive,
              "opacity-50": isDragging,
            },
          )}
          onClick={onActivate}
          {...attributes}
          {...listeners}
        >
          {/* Tab icon */}
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />

          {/* Tab title */}
          <span className="text-sm font-medium truncate max-w-[120px] min-w-0">
            {tab.title}
          </span>

          {/* Status indicators */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Connection status indicator */}
            {getConnectionStatusIcon()}

            {tab.isDirty && (
              <Badge
                variant="secondary"
                className="h-1.5 w-1.5 p-0 rounded-full bg-orange-500"
              />
            )}

            {tab.isLoading && (
              <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            )}

            {tab.error && (
              <Badge
                variant="destructive"
                className="h-1.5 w-1.5 p-0 rounded-full"
              />
            )}
          </div>

          {/* Close button */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-5 w-5 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20 hover:text-destructive",
              {
                "opacity-100": isActive,
              },
            )}
            onClick={handleClose}
          >
            <X className="h-3 w-3" />
            <span className="sr-only">Close tab</span>
          </Button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <div className="space-y-1">
          <div className="font-medium">{tab.title}</div>
          <div className="text-muted-foreground">
            {tab.type.charAt(0).toUpperCase() + tab.type.slice(1)} •{" "}
            {connection?.config.name || "Unknown Connection"}
          </div>
          <div className="flex items-center gap-1">
            {getConnectionStatusIcon()}
            <span className="text-xs">{getConnectionStatusText()}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
