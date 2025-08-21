import { Button } from "@/components/ui/button";
import { Rows, RefreshCw, Table, Clock } from "lucide-react";

import { useEffect } from "react";
import { useConnectionStore } from "@/stores";
import { useUIStore } from "@/stores/uiStore";

interface StatusBarProps {
  workspaceId?: string;
}

export function StatusBar({ workspaceId }: StatusBarProps) {
  const { connections, activeConnectionId, connect } = useConnectionStore();
  const {
    selectedRowCount,
    totalRowCount,
    estimatedRowCount,
    currentTableName,
    queryTime,
  } = useUIStore();

  const activeConnection = activeConnectionId
    ? connections.get(activeConnectionId)
    : null;

  const connectionStatus = activeConnection?.status || "disconnected";

  // Debug logging
  useEffect(() => {
    console.log(`[StatusBar] Active connection status: ${connectionStatus},`);
  }, [connectionStatus, activeConnectionId]);

  return (
    <div className="h-8 border-t bg-muted/50 flex items-center justify-between px-4 text-xs">
      <div className="flex items-center gap-4">
        {/* Connection Status */}
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              connectionStatus === "connected"
                ? "bg-green-500"
                : connectionStatus === "connecting"
                ? "bg-yellow-500 animate-pulse"
                : connectionStatus === "error"
                ? "bg-red-500"
                : "bg-gray-500"
            }`}
          />
          <span className="text-muted-foreground">
            {connectionStatus === "connected"
              ? "Connected"
              : connectionStatus === "connecting"
              ? "Connecting..."
              : connectionStatus === "error"
              ? activeConnection?.error || "Connection Error"
              : "Disconnected"}
          </span>
          {/* Reconnect button for failed connections */}
          {(connectionStatus === "error" ||
            connectionStatus === "disconnected") &&
            activeConnectionId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 py-0"
                onClick={() => {
                  console.log(
                    `[StatusBar] Manual reconnect for ${activeConnectionId}`,
                  );
                  connect(activeConnectionId, 3, workspaceId).catch((error) => {
                    console.error(`[StatusBar] Reconnect failed:`, error);
                  });
                }}
                title="Retry connection"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
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
