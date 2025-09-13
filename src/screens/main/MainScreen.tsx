import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

import { ThemeToggle } from "@/components/theme-toggle";
import { Database, Settings, Search, Trash2, Download } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.png";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useConnectionSync } from "@/hooks/useConnectionSync";
import { useWindowConnection } from "@/hooks/useWindowConnection";
import { ConnectionProfile, DbType, SslMode } from "@/types/connection";
import { windowManager } from "@/services/windowManager";

export function MainScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { 
    fetchConnections, 
    saveConnection, 
    deleteConnection,
    connections 
  } = useConnectionStore();
  
  // Use window connection hook
  const { activeConnectionId, setActiveConnection } = useWindowConnection();
  
  // Enable cross-window sync
  useConnectionSync();

  // Load connections from backend on startup
  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  const handleLoadPostgreSQLDev = async () => {
    setIsLoadingDefaults(true);
    try {
      // Check if PostgreSQL Dev already exists
      const existingPg = connections.find(conn => 
        conn.profile.name === "PostgreSQL Dev" && 
        conn.profile.host === "localhost" &&
        conn.profile.port === 15432
      );
      
      if (existingPg) {
        toast({
          title: "Connection Already Exists",
          description: "PostgreSQL Dev connection is already in your connection list.",
        });
        setIsLoadingDefaults(false);
        return;
      }
      
      // Create PostgreSQL Dev connection profile
      const pgProfile: ConnectionProfile = {
        id: "",
        name: "PostgreSQL Dev",
        db_type: DbType.PostgreSQL,
        host: "localhost",
        port: 15432,
        database: "todoapp",
        username: "devuser",
        password: "devpass123",
        ssl_mode: SslMode.Disable,
        options: {},
      };
      
      // Save to backend
      const id = await saveConnection(pgProfile);
      
      toast({
        title: "PostgreSQL Dev Added",
        description: "PostgreSQL development database connection has been added successfully.",
      });
      
      // Set as active connection for this window
      await setActiveConnection(id);
    } catch (error) {
      toast({
        title: "Error Loading Connection",
        description: "Failed to add PostgreSQL Dev connection. Make sure Docker is running: make docker-up",
        variant: "destructive",
      });
    } finally {
      setIsLoadingDefaults(false);
    }
  };

  // Debug: Log workspaces on demand
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div
        data-tauri-drag-region
        className="select-none h-5 w-full absolute top-0 left-0 cursor-grab z-50"
      ></div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - 1/3 width */}
        <div className="w-1/3 max-w-[380px] flex-shrink-0 bg-muted/40 flex flex-col select-none">
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-4">
            {/* Logo */}
            <div className="mb-4">
              <img
                src={logo}
                alt="DevDB Studio"
                className="h-20 w-20 rounded-2xl"
              />
            </div>

            {/* Welcome Message */}
            <h1 className="text-2xl font-bold mb-3 text-center">
              DevDB Studio
            </h1>

            {/* Version Badge */}
            <Badge variant="secondary" className="mb-6">
              Version 0.1.0
            </Badge>

            {/* CTA Actions */}
            <div className="w-full space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                size="default"
                onClick={() => {
                  // TODO: Open connection dialog
                }}
              >
                <Database className="mr-2 h-4 w-4" />
                Connect Database
              </Button>

              <Button
                variant="secondary"
                className="w-full justify-start"
                size="default"
                onClick={handleLoadPostgreSQLDev}
                disabled={isLoadingDefaults}
              >
                <Download className="mr-2 h-4 w-4" />
                {isLoadingDefaults ? "Loading..." : "Load PostgreSQL Dev"}
              </Button>

              <Button
                variant="destructive"
                className="w-full justify-start"
                size="default"
                onClick={async () => {
                  console.log("User confirmed clear all operation");
                  try {
                    console.log("Step 1: Clearing browser storage...");
                    // Clear all data including browser storage
                    localStorage.clear();
                    sessionStorage.clear();
                    console.log("✓ Browser storage cleared");

                    console.log(
                      "Step 2: Clearing all connections from backend...",
                    );
                    // Clear all connections one by one
                    for (const conn of connections) {
                      await deleteConnection(conn.profile.id);
                    }
                    console.log("✓ All connections deleted");

                    console.log("Step 3: Reloading connections list...");
                    // Reload connections to reflect the change
                    await fetchConnections();
                    console.log("✓ Connections reloaded");

                    console.log("=====================================");
                    console.log("Clear All operation completed successfully");
                    console.log("=====================================");

                    toast({
                      title: "All Data Cleared",
                      description:
                        "All connections and stored data have been removed.",
                    });
                  } catch (error) {
                    console.error("=====================================");
                    console.error("ERROR during clear all operation:", error);
                    console.error("=====================================");
                    toast({
                      title: "Error Clearing Data",
                      description:
                        error instanceof Error
                          ? error.message
                          : "Failed to clear all data. Please try again.",
                      variant: "destructive",
                    });
                  }
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Emergency Clear All
              </Button>
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="flex-1 justify-start"
                    size="sm"
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem onClick={() => {}}>
                    Settings coming soon...
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <ThemeToggle />
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Header */}
          <div className="px-4 py-3 sticky top-0 z-10 bg-background/30 backdrop-blur-sm backdrop-filter">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Search connections... (⌘F)"
                className="pl-9 h-8 text-sm"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                }}
              />
            </div>
          </div>


          {/* Connection List */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {connections.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Database className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No connections yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Click "Load PostgreSQL Dev" to add development connections,
                  <br />
                  or create a new connection to get started.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {connections
                  .filter(conn => 
                    searchQuery === "" || 
                    conn.profile.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    conn.profile.host.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((conn) => (
                    <div
                      key={conn.profile.id}
                      className="p-3 rounded-lg border bg-card hover:bg-accent cursor-pointer transition-colors"
                      onClick={async () => {
                        console.log("Connection clicked:", conn.profile.name, conn.profile.id);
                        
                        // Set as active connection for this window
                        await setActiveConnection(conn.profile.id);
                        
                        // Navigate to workspace with the connection ID
                        navigate(`/workspace/${conn.profile.id}`);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-blue-600" />
                          <span className="font-medium">{conn.profile.name}</span>
                        </div>
                        {conn.profile.id === activeConnectionId && (
                          <Badge variant="secondary" className="text-xs">Active</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {conn.profile.host}:{conn.profile.port}/{conn.profile.database}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
