import { useEffect, useState } from "react";
import { Circle, Clock, Activity, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { databaseService, type ConnectionHealth } from "@/services/databaseService";

interface WorkspaceStatusBarProps {
  connectionId: string;
}

export function WorkspaceStatusBar({ connectionId }: WorkspaceStatusBarProps) {
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Track query metrics (these would be updated by query execution)
  const [queryTime] = useState<number | null>(null);
  const [rowCount] = useState<number | null>(null);

  useEffect(() => {
    // Subscribe to health updates
    const unsubscribe = databaseService.onHealthChange(connectionId, (health) => {
      setConnectionHealth(health);
      setIsConnecting(false);
    });

    return () => {
      unsubscribe();
    };
  }, [connectionId]);

  const getStatusColor = () => {
    if (isConnecting) return "text-yellow-500";
    if (!connectionHealth) return "text-gray-500";
    
    switch (connectionHealth.status) {
      case "ready":
        return "text-green-500";
      case "degraded":
        return "text-yellow-500";
      case "error":
        return "text-red-500";
      default:
        return "text-gray-500";
    }
  };

  const getStatusText = () => {
    if (isConnecting) return "Connecting...";
    if (!connectionHealth) return "Not connected";
    
    switch (connectionHealth.status) {
      case "ready":
        return `Connected${connectionHealth.rttMs ? ` (${connectionHealth.rttMs}ms)` : ""}`;
      case "degraded":
        return `Degraded${connectionHealth.rttMs ? ` (${connectionHealth.rttMs}ms)` : ""}`;
      case "error":
        return connectionHealth.error || "Connection error";
      default:
        return "Unknown";
    }
  };

  const getStatusIcon = () => {
    if (isConnecting) {
      return <Loader2 className="h-2 w-2 animate-spin" />;
    }
    
    if (connectionHealth?.status === "error") {
      return <AlertCircle className="h-3 w-3" />;
    }
    
    return (
      <Circle 
        className={cn(
          "h-2 w-2 fill-current",
          getStatusColor(),
          connectionHealth?.status === "ready" && "animate-pulse"
        )}
      />
    );
  };

  return (
    <div className="h-8 border-t bg-muted/30 flex items-center justify-between px-4 text-xs">
      {/* Left Section - Connection Health */}
      <div className="flex items-center gap-2">
        {getStatusIcon()}
        <span className={cn(getStatusColor())}>
          {getStatusText()}
        </span>
      </div>

      {/* Right Section - Query Metrics */}
      <div className="flex items-center gap-4 text-muted-foreground">
        {rowCount !== null && (
          <div className="flex items-center gap-1">
            <Activity className="h-3 w-3" />
            <span>{rowCount.toLocaleString()} rows</span>
          </div>
        )}
        
        {queryTime !== null && (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{queryTime}ms</span>
          </div>
        )}
      </div>
    </div>
  );
}