import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Database, Rows, Plus, ChevronDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useConnectionStore } from "@/stores/connectionStore";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { useParams } from "react-router-dom";

export function StatusBar() {
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const { connections, activeConnectionId, setActiveConnection, connect } =
    useConnectionStore();
  const { id: workspaceId } = useParams<{ id: string }>();

  // Filter connections for current workspace
  const workspaceConnections = Array.from(connections.values()).filter(
    (conn) =>
      conn.config.workspaceId === workspaceId ||
      (!conn.config.workspaceId && workspaceId === "uncategorized"),
  );

  const activeConnection = activeConnectionId
    ? connections.get(activeConnectionId)
    : null;

  const connectionStatus = activeConnection?.status || "disconnected";

  const handleConnectionChange = (connectionId: string) => {
    setActiveConnection(connectionId);
    const connection = connections.get(connectionId);
    if (connection && connection.status === "disconnected") {
      connect(connectionId);
    }
  };

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
                : "bg-red-500"
            }`}
          />
          <span className="text-muted-foreground">
            {connectionStatus === "connected"
              ? "Connected"
              : connectionStatus === "connecting"
              ? "Connecting..."
              : "Disconnected"}
          </span>
        </div>

        {/* Connection Switcher */}
        <div className="flex items-center gap-1.5">
          <Database className="h-3 w-3 text-muted-foreground" />
          {workspaceConnections.length > 0 ? (
            <Select
              value={activeConnectionId || ""}
              onValueChange={handleConnectionChange}
            >
              <SelectTrigger className="h-5 text-xs border-0 bg-transparent hover:bg-muted px-2 py-0 gap-1 min-w-[120px]">
                <SelectValue placeholder="Select connection">
                  {activeConnection
                    ? activeConnection.config.name
                    : "No connection"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {workspaceConnections.map((connection) => (
                  <SelectItem
                    key={connection.config.id}
                    value={connection.config.id}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          connection.status === "connected"
                            ? "bg-green-500"
                            : connection.status === "connecting"
                            ? "bg-yellow-500"
                            : "bg-gray-400"
                        }`}
                      />
                      <span>{connection.config.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {connection.config.type}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-xs px-2 py-0"
              onClick={() => setConnectionDialogOpen(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Connection
            </Button>
          )}
        </div>

        {/* Current Database */}
        {activeConnection && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">DB:</span>
            <span className="text-foreground font-mono text-xs">
              {activeConnection.config.database}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Query: 0.234s</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Rows className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Rows: 1,234</span>
        </div>

        <Badge variant="outline" className="h-5 text-[10px]">
          {activeConnection
            ? `${activeConnection.config.type.toUpperCase()}`
            : "No Connection"}
        </Badge>
      </div>

      <ConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={setConnectionDialogOpen}
      />
    </div>
  );
}
