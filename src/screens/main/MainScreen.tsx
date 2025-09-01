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
import { ConnectionList } from "@/components/ConnectionList";
import { Database, Settings, Search, Trash2, Download } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import logo from "@/assets/logo.png";
import { useConnectionStore } from "@/stores/connectionStore";

export function MainScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { loadConnections, clearAllConnections } =
    useConnectionStore();

  // Load connections from backend on startup
  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const handleLoadPostgreSQLDev = async () => {
    setIsLoadingDefaults(true);
    try {
      // First, check if Docker is running and PostgreSQL is available
      const { loadPostgreSQLDev } = useConnectionStore.getState();
      const result = await loadPostgreSQLDev();

      if (result.added > 0) {
        toast({
          title: "PostgreSQL Dev Added",
          description: "PostgreSQL development database connection has been added successfully.",
        });
      } else if (result.skipped > 0) {
        toast({
          title: "Connection Already Exists",
          description: "PostgreSQL Dev connection is already in your connection list.",
        });
      }
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
                    // Clear all connections from backend
                    await clearAllConnections();
                    console.log("✓ clearAllConnections() completed");

                    console.log("Step 3: Reloading connections list...");
                    // Reload connections to reflect the change
                    await loadConnections();
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
          <ConnectionList searchQuery={searchQuery} />
        </div>
      </div>
    </div>
  );
}
