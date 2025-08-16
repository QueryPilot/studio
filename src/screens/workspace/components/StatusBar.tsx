import { Button } from "@/components/ui/button";
import { Database, Rows, Plus, RefreshCw, Table, Layers } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, useEffect } from "react";
import { useConnectionStore } from "@/stores";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { useUIStore } from "@/stores/uiStore";

export function StatusBar() {
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const { connections, activeConnectionId, setActiveConnection, connect } =
    useConnectionStore();
  const { 
    selectedRowCount, 
    totalRowCount, 
    estimatedRowCount, 
    currentTableName,
    selectedSchema,
    setSelectedSchema,
    availableSchemas
  } = useUIStore();
  console.log(">>>", "connections", connections);
  // Get unique connections - filter out any duplicates by connection ID
  const uniqueConnections = new Map<
    string,
    typeof connections extends Map<any, infer V> ? V : never
  >();
  connections.forEach((connection) => {
    if (connection.config.id && !uniqueConnections.has(connection.config.id)) {
      uniqueConnections.set(connection.config.id, connection);
    }
  });

  const workspaceConnections = Array.from(uniqueConnections.values());

  const activeConnection = activeConnectionId
    ? connections.get(activeConnectionId)
    : null;

  const connectionStatus = activeConnection?.status || "disconnected";

  // Debug logging
  useEffect(() => {
    console.log(
      `[StatusBar] Active connection status: ${connectionStatus}, ID: ${activeConnectionId}`,
    );
  }, [connectionStatus, activeConnectionId]);


  const handleConnectionChange = async (connectionId: string) => {
    // Optimistically set the new connection as active immediately
    setActiveConnection(connectionId);
    
    // Get the selected connection
    const selectedConnection = connections.get(connectionId);
    
    // If the connection is not connected, initiate connection
    if (selectedConnection && 
        selectedConnection.status !== "connected" && 
        selectedConnection.status !== "connecting") {
      console.log(`[StatusBar] Initiating connection for ${connectionId} on selection`);
      try {
        await connect(connectionId);
      } catch (error) {
        console.error(`[StatusBar] Failed to connect:`, error);
      }
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
          {(connectionStatus === "error" || connectionStatus === "disconnected") && activeConnectionId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1 py-0"
              onClick={() => {
                console.log(`[StatusBar] Manual reconnect for ${activeConnectionId}`);
                connect(activeConnectionId).catch((error) => {
                  console.error(`[StatusBar] Reconnect failed:`, error);
                });
              }}
              title="Retry connection"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Connection Switcher */}
        <div className="flex items-center gap-1.5">
          <Database className="h-3 w-3 text-muted-foreground" />
          {workspaceConnections.length > 0 ? (
            <Select
              value={activeConnectionId || ""}
              onValueChange={handleConnectionChange}
            >
              <SelectTrigger className="!h-5 text-xs border-0 bg-transparent hover:bg-primary/10 px-2 py-0 gap-1 min-w-[120px]">
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
        
        {/* Schema Selector */}
        {activeConnection && connectionStatus === "connected" && availableSchemas.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Layers className="h-3 w-3 text-muted-foreground" />
            <Select
              value={selectedSchema}
              onValueChange={setSelectedSchema}
            >
              <SelectTrigger className="!h-5 text-xs border-0 bg-transparent hover:bg-primary/10 px-2 py-0 gap-1 min-w-[80px]">
                <SelectValue placeholder="Schema">
                  {selectedSchema === "all" ? "All Schemas" : selectedSchema}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Schemas</SelectItem>
                {availableSchemas.map((schema) => (
                  <SelectItem key={schema} value={schema}>
                    {schema}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Right side - Row counts and selection info */}
      <div className="flex items-center gap-2">
        {/* Combined selection and row count - show always when table is selected */}
        {currentTableName && (
          <div className="flex items-center gap-1.5 text-xs">
            {selectedRowCount > 0 && (
              <>
                <Rows className="h-3 w-3 text-primary" />
                <span className="text-primary font-medium">{selectedRowCount} selected</span>
                <span className="text-muted-foreground">|</span>
              </>
            )}
            <Table className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">
              {totalRowCount.toLocaleString()} rows
              {estimatedRowCount && estimatedRowCount > totalRowCount && 
                ` (~${estimatedRowCount.toLocaleString()} total)`
              }
            </span>
          </div>
        )}
      </div>

      <ConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={setConnectionDialogOpen}
      />
    </div>
  );
}
