import { Button } from "@/components/ui/button";
import { Rows, RefreshCw, Table, Clock } from "lucide-react";

import { useEffect } from "react";
import { useConnectionStore } from "@/stores";
import { useUIStore } from "@/stores/uiStore";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { useConnectionHealth } from "@/hooks/useConnectionHealth";

interface StatusBarProps {
  workspaceId?: string;
}

export function StatusBar({ workspaceId }: StatusBarProps) {
  const { connections, activeConnectionId } = useConnectionStore();
  const {
    selectedRowCount,
    totalRowCount,
    estimatedRowCount,
    currentTableName,
    queryTime,
  } = useUIStore();
  
  // Get the actual backend connection ID for health monitoring
  const activeConnection = activeConnectionId
    ? connections.get(activeConnectionId)
    : null;
  const actualConnectionId = activeConnection?.actualConnectionId;
  
  const { health } = useConnectionHealth(actualConnectionId || undefined);

  const connectionStatus = activeConnection?.status || "disconnected";

  // Debug logging
  useEffect(() => {
    console.log(`[StatusBar] Active connection ID: ${activeConnectionId}, actual: ${actualConnectionId}, status: ${connectionStatus}, health: ${JSON.stringify(health)}`);
    console.log(`[StatusBar] All connections:`, Array.from(connections.keys()));
    if (activeConnection) {
      console.log(`[StatusBar] Active connection details:`, {
        id: activeConnection.config?.id,
        name: activeConnection.config?.name,
        actualConnectionId: activeConnection.actualConnectionId,
        status: activeConnection.status
      });
    }
  }, [connectionStatus, activeConnectionId, actualConnectionId, health, connections, activeConnection]);

  return (
    <div className="h-8 border-t bg-muted/50 flex items-center justify-between px-4 text-xs">
      <div className="flex items-center gap-4">
        {/* Connection Status - Using new health monitoring component */}
        {actualConnectionId ? (
          <ConnectionStatus 
            connectionId={actualConnectionId}
            showLabel={true}
            showLatency={true}
          />
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-gray-500" />
            <span className="text-muted-foreground">No connection</span>
          </div>
        )}
        
        {/* Debug info */}
        <div className="text-xs text-gray-500">
          Debug: active={activeConnectionId?.slice(-8)}, actual={actualConnectionId?.slice(-8)}, status={connectionStatus}
        </div>
      </div>

      {/* Right side - Row counts and selection info */}
      <div className="flex items-center gap-2">
        {/* Combined selection and row count - show always when table is selected */}
        {currentTableName && (
          <div className="flex items-center gap-1.5 text-xs">
            {queryTime !== null && (
              <>
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">{queryTime}ms</span>
                <span className="text-muted-foreground">|</span>
              </>
            )}
            {selectedRowCount > 0 && (
              <>
                <Rows className="h-3 w-3 text-primary" />
                <span className="text-primary font-medium">
                  {selectedRowCount} selected
                </span>
                <span className="text-muted-foreground">|</span>
              </>
            )}
            <Table className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">
              {totalRowCount.toLocaleString()} rows loaded
              {estimatedRowCount && estimatedRowCount > totalRowCount && (
                <span className="text-muted-foreground/70">
                  {` (of ~${estimatedRowCount.toLocaleString()} total)`}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
