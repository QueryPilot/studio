import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import { Database, Settings, Search } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.png";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useConnectionSync } from "@/hooks/useConnectionSync";
import packageJson from "../../../package.json";

import { ConnectionDialog } from "@/components/ConnectionDialog";
import { ConnectionList } from "@/components/ConnectionList";

export function MainScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { fetchConnections } = useConnectionStore();

  // Enable cross-window sync
  useConnectionSync();

  // Load connections from backend on startup
  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  const handleConnectToDatabase = async (connectionId: string) => {
    try {
      // Navigate to workspace with the new connection
      await navigate(`/workspace/${connectionId}`);
    } catch (error) {
      console.error("Failed to connect to database:", error);
      toast.error("Connection Error", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to connect to database",
      });
    }
  };
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div
        data-tauri-drag-region
        className="select-none h-7 w-full absolute top-0 left-0 cursor-grab z-50"
      ></div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - 1/3 width */}
        <div
          className="w-1/3 max-w-[380px] flex-shrink-0 bg-secondary flex flex-col select-none"
          onContextMenu={(e) => {
            e.preventDefault();
          }}
        >
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-4">
            {/* Logo */}
            <div className="mb-4">
              <img
                src={logo}
                alt="Query Pilot"
                className="h-20 w-20 rounded-2xl"
              />
            </div>

            {/* Welcome Message */}
            <h1 className="text-2xl font-bold mb-3 text-center">
              Query Pilot
            </h1>

            {/* Version Badge */}
            <Badge variant="secondary" className="mb-6">
              v{packageJson.version}
            </Badge>

            {/* CTA Actions */}
            <div className="w-full space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                size="default"
                onClick={() => {
                  setConnectionDialogOpen(true);
                }}
              >
                <Database className="mr-2 h-4 w-4" />
                Connect Database
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
        <div className="flex-1 flex flex-col overflow-hidden bg-secondary relative p-1.5">
          {/* Header */}
          <div className="bg-background rounded-xl h-full">
            <div className="px-4 py-3 sticky top-0 z-10">
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
            <ConnectionList
              searchQuery={searchQuery}
              onAddConnection={() => {
                setConnectionDialogOpen(true);
              }}
            />
          </div>
        </div>
      </div>

      {/* Connection Dialog */}
      <ConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={setConnectionDialogOpen}
        onConnect={handleConnectToDatabase}
      />
    </div>
  );
}
