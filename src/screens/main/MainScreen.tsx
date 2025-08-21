import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Database,
  Plus,
  Settings,
  ChevronRight,
  Clock,
  Server,
  HardDrive,
  Search,
  Folder,
  Edit,
  Trash2,
  MoreHorizontal,
  ExternalLink,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { windowManager } from "@/services/windowManager";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useConnectionStore } from "@/stores";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { StorageCleaner, getStorageStats } from "@/utils/clearStorage";
import { emergencyClearAllConnections } from "@/utils/clearConnections";
import { toast } from "sonner";
import logo from "@/assets/logo.png";

function getDatabaseIcon(type: string) {
  switch (type) {
    case "postgresql":
      return <Database className="h-4 w-4 text-blue-500" />;
    case "mysql":
      return <Server className="h-4 w-4 text-orange-500" />;
    case "sqlite":
      return <HardDrive className="h-4 w-4 text-green-500" />;
    case "mongodb":
      return <Database className="h-4 w-4 text-emerald-500" />;
    default:
      return <Database className="h-4 w-4" />;
  }
}

export function MainScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [selectedWorkspaceForConnection, setSelectedWorkspaceForConnection] =
    useState<string | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null,
  );
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(
    null,
  );
  const [editingWorkspaceName, setEditingWorkspaceName] = useState("");
  const [deleteConfirmWorkspaceId, setDeleteConfirmWorkspaceId] = useState<
    string | null
  >(null);
  const [deleteConfirmConnectionId, setDeleteConfirmConnectionId] = useState<
    string | null
  >(null);
  const [clearStorageDialogOpen, setClearStorageDialogOpen] = useState(false);
  const [emergencyClearDialogOpen, setEmergencyClearDialogOpen] =
    useState(false);
  const [storageStats, setStorageStats] = useState<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const {
    workspaces,
    ensureUncategorizedWorkspace,
    addWorkspace,
    updateWorkspace,
    removeWorkspace,
  } = useWorkspaceStore();
  const { connections, removeConnection } = useConnectionStore();

  useEffect(() => {
    // Ensure uncategorized workspace exists
    ensureUncategorizedWorkspace();

    // Note: Connections are loaded by useSecureStorageMigration hook in App.tsx
    // No need to load them here to avoid duplicates
  }, []); // Empty dependency array - run only once on mount

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + F for search
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      // Cmd/Ctrl + Shift + Delete for clearing storage
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        getStorageStats().then((stats) => {
          setStorageStats(stats);
          setClearStorageDialogOpen(true);
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const getWorkspaceConnections = (workspaceId: string) => {
    const workspace = workspaces.get(workspaceId);
    if (!workspace) return [];

    return workspace.connectionIds
      .map((id) => connections.get(id))
      .filter((conn) => conn !== undefined);
  };

  const formatLastOpened = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  const filteredWorkspaces = Array.from(workspaces.values()).filter(
    (workspace) => {
      const matchesName = workspace.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const workspaceConnections = getWorkspaceConnections(workspace.id);
      const matchesConnection = workspaceConnections.some(
        (conn) =>
          conn.config.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (conn.config.database &&
            conn.config.database
              .toLowerCase()
              .includes(searchQuery.toLowerCase())),
      );
      return matchesName || matchesConnection;
    },
  );

  // Debug: Log workspaces on demand
  useEffect(() => {
    if (filteredWorkspaces.length > 0) {
      console.log(
        "Workspaces available:",
        filteredWorkspaces.length,
        filteredWorkspaces.map((w) => ({ id: w.id, name: w.name })),
      );
    }
  }, [filteredWorkspaces]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <div
        data-tauri-drag-region
        className="select-none h-5 w-full absolute top-0 left-0 cursor-grab z-50"
      ></div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - 1/3 width */}
        <div className="w-1/3 max-w-[380px] flex-shrink-0 bg-muted/30 flex flex-col select-none">
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
                className="w-full justify-start"
                size="default"
                onClick={() => {
                  addWorkspace({
                    name: "Untitled",
                    path: "~/untitled",
                    lastOpened: new Date(),
                    connectionIds: [],
                    activeConnectionId: null,
                    activeTabId: null,
                    settings: {
                      defaultPageSize: 100,
                      autoSave: true,
                      confirmOnClose: false,
                      theme: "system",
                      maxTabsOpen: 10,
                    },
                  });
                }}
              >
                <Folder className="mr-2 h-4 w-4" />
                New Workspace
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start"
                size="default"
                onClick={() => {
                  setSelectedWorkspaceForConnection(null);
                  setConnectionDialogOpen(true);
                }}
              >
                <Database className="mr-2 h-4 w-4" />
                Connect Database
              </Button>

              <Button
                variant="destructive"
                className="w-full justify-start"
                size="default"
                onClick={() => {
                  setEmergencyClearDialogOpen(true);
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
                  <DropdownMenuItem
                    onClick={async () => {
                      const stats = await getStorageStats();
                      setStorageStats(stats);
                      setClearStorageDialogOpen(true);
                    }}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    <div className="flex items-center justify-between w-full">
                      <span>Clear All Data</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ⌘⇧⌫
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setEmergencyClearDialogOpen(true);
                    }}
                    className="text-red-600"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Emergency Clear Connections
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
          <div className="px-6 py-4 sticky top-0 z-10 bg-background/30 backdrop-blur-sm backdrop-filter">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Search workspaces... (⌘F)"
                className="pl-10"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                }}
              />
            </div>
          </div>

          {/* Workspaces List */}
          <div className="flex-1 overflow-auto">
            <div className="p-6 pt-2">
              <div className="space-y-3">
                {filteredWorkspaces.map((workspace) => (
                  <Card
                    key={workspace.id}
                    className="p-4 bg-muted/30 hover:bg-muted/70 transition-colors cursor-pointer group border-0 shadow-none hover:shadow-sm"
                    onClick={() => {
                      console.log("Card clicked for workspace:", workspace.id);
                      windowManager.openWorkspace(workspace.id).catch((err) => {
                        console.error("Failed to open workspace:", err);
                        alert(
                          `Failed to open workspace: ${err.message || err}`,
                        );
                      });
                    }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        {editingWorkspaceId === workspace.id ? (
                          <input
                            value={editingWorkspaceName}
                            onChange={(e) => {
                              setEditingWorkspaceName(e.target.value);
                            }}
                            onBlur={() => {
                              if (editingWorkspaceName.trim()) {
                                updateWorkspace(workspace.id, {
                                  name: editingWorkspaceName.trim(),
                                });
                              }
                              setEditingWorkspaceId(null);
                              setEditingWorkspaceName("");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                if (editingWorkspaceName.trim()) {
                                  updateWorkspace(workspace.id, {
                                    name: editingWorkspaceName.trim(),
                                  });
                                }
                                setEditingWorkspaceId(null);
                                setEditingWorkspaceName("");
                              }
                              if (e.key === "Escape") {
                                setEditingWorkspaceId(null);
                                setEditingWorkspaceName("");
                              }
                            }}
                            autoFocus
                            className="text-base font-semibold bg-transparent border border-primary rounded px-2 py-1 -mx-2 -my-1 w-full min-w-0 resize-none overflow-hidden focus:outline-none focus:ring-1 focus:ring-primary"
                            style={{ lineHeight: "1.25rem" }}
                          />
                        ) : (
                          <h3
                            className="text-base font-semibold flex items-center cursor-pointer hover:text-foreground/80 px-2 py-1 -mx-2 -my-1 rounded hover:bg-accent/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingWorkspaceId(workspace.id);
                              setEditingWorkspaceName(workspace.name);
                            }}
                          >
                            {workspace.name}
                            <ChevronRight className="ml-2 h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </h3>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {workspace.id !== "uncategorized" && (
                          <div className="flex items-center text-xs text-muted-foreground">
                            <Clock className="mr-1 h-3 w-3" />
                            {formatLastOpened(workspace.lastOpened)}
                          </div>
                        )}
                        {workspace.id !== "uncategorized" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                }}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingWorkspaceId(workspace.id);
                                  setEditingWorkspaceName(workspace.name);
                                }}
                              >
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirmWorkspaceId(workspace.id);
                                }}
                                className="text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>

                    {/* Databases */}
                    <div className="space-y-2">
                      {getWorkspaceConnections(workspace.id).map(
                        (connection) => (
                          <div
                            key={connection.config.id}
                            className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/90 hover:bg-muted transition-colors cursor-pointer group border-0 shadow-none relative"
                            onClick={(e) => {
                              e.stopPropagation();
                              console.log(
                                "Opening workspace with connection:",
                                workspace.id,
                                connection.config.id,
                              );
                              windowManager
                                .openWorkspace(
                                  workspace.id,
                                  connection.config.id,
                                )
                                .catch((err) => {
                                  console.error(
                                    "Failed to open workspace:",
                                    err,
                                  );
                                  alert(
                                    `Failed to open workspace: ${
                                      err.message || err
                                    }`,
                                  );
                                });
                            }}
                          >
                            <div className="flex items-center gap-2 flex-1">
                              {getDatabaseIcon(connection.config.type)}
                              <span className="text-sm font-medium select-none">
                                {connection.config.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {connection.status === "connected" && (
                                <div className="h-2 w-2 rounded-full bg-green-500" />
                              )}
                              <Badge
                                variant="outline"
                                className="text-xs select-none"
                              >
                                {connection.config.type}
                              </Badge>
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingConnectionId(
                                      connection.config.id,
                                    );
                                    setConnectionDialogOpen(true);
                                  }}
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteConfirmConnectionId(
                                      connection.config.id,
                                    );
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ),
                      )}

                      {/* Action Buttons */}
                      <div className="flex gap-1 mt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 justify-start h-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            console.log("Opening workspace:", workspace.id);
                            windowManager
                              .openWorkspace(workspace.id)
                              .catch((err) => {
                                console.error("Failed to open workspace:", err);
                                alert(
                                  `Failed to open workspace: ${
                                    err.message || err
                                  }`,
                                );
                              });
                          }}
                        >
                          <ExternalLink className="mr-2 h-3 w-3" />
                          Open Workspace
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 justify-start h-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedWorkspaceForConnection(workspace.id);
                            setConnectionDialogOpen(true);
                          }}
                        >
                          <Plus className="mr-2 h-3 w-3" />
                          Add Database
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Empty State */}
              {filteredWorkspaces.length === 0 && (
                <div className="flex flex-col items-center justify-center h-[400px] text-center">
                  <Database className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    No workspaces found
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {searchQuery
                      ? "Try adjusting your search terms"
                      : "Create your first workspace to get started"}
                  </p>
                  {!searchQuery && (
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Workspace
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Connection Dialog */}
      <ConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={(open) => {
          setConnectionDialogOpen(open);
          if (!open) {
            setEditingConnectionId(null);
            setSelectedWorkspaceForConnection(null);
          }
        }}
        preSelectedWorkspaceId={selectedWorkspaceForConnection}
        editingConnectionId={editingConnectionId}
      />

      {/* Delete Workspace Confirmation */}
      <AlertDialog
        open={deleteConfirmWorkspaceId !== null}
        onOpenChange={() => {
          setDeleteConfirmWorkspaceId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workspace</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "
              {deleteConfirmWorkspaceId
                ? workspaces.get(deleteConfirmWorkspaceId)?.name
                : ""}
              "? This will also remove all database connections in this
              workspace. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteConfirmWorkspaceId) {
                  // Remove all connections in this workspace
                  const workspaceConnections = getWorkspaceConnections(
                    deleteConfirmWorkspaceId,
                  );
                  workspaceConnections.forEach((conn) =>
                    removeConnection(conn.config.id),
                  );
                  // Remove workspace
                  removeWorkspace(deleteConfirmWorkspaceId);
                }
                setDeleteConfirmWorkspaceId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Connection Confirmation */}
      <AlertDialog
        open={deleteConfirmConnectionId !== null}
        onOpenChange={() => {
          setDeleteConfirmConnectionId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Connection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this database connection? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteConfirmConnectionId) {
                  removeConnection(deleteConfirmConnectionId);
                }
                setDeleteConfirmConnectionId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear Storage Confirmation */}
      <AlertDialog
        open={clearStorageDialogOpen}
        onOpenChange={setClearStorageDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Application Data</AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <div>
                This will permanently delete ALL application data including:
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>All database connections and credentials</li>
                  <li>All workspaces and configurations</li>
                  <li>Query history and saved queries</li>
                  <li>Application settings and preferences</li>
                </ul>
              </div>

              {storageStats && (
                <div className="bg-muted rounded-md p-3 space-y-1 text-sm">
                  <div>Storage Usage:</div>
                  <div className="text-muted-foreground">
                    • localStorage: {storageStats.localStorage.items} items (
                    {(storageStats.localStorage.size / 1024).toFixed(2)} KB)
                  </div>
                  <div className="text-muted-foreground">
                    • sessionStorage: {storageStats.sessionStorage.items} items
                    ({(storageStats.sessionStorage.size / 1024).toFixed(2)} KB)
                  </div>
                  <div className="text-muted-foreground">
                    • Total: {(storageStats.total / 1024).toFixed(2)} KB
                  </div>
                </div>
              )}

              <div className="font-semibold text-destructive">
                ⚠️ This action cannot be undone. The application will reload
                after clearing.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  // Clear all storage
                  await StorageCleaner.clearAll();
                  console.log("✅ All storage cleared successfully");

                  // Close dialog
                  setClearStorageDialogOpen(false);

                  // Reload the application after a brief delay
                  setTimeout(() => {
                    window.location.reload();
                  }, 500);
                } catch (error) {
                  console.error("Failed to clear storage:", error);
                  alert("Failed to clear storage. Please try again.");
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear All Data & Reload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Emergency Clear Connections Dialog */}
      <AlertDialog
        open={emergencyClearDialogOpen}
        onOpenChange={setEmergencyClearDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              ⚠️ Emergency Clear All Connections
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <div>
                This will <strong>FORCEFULLY DELETE</strong> all database
                connections and completely reset the application.
              </div>

              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 space-y-2">
                <div className="font-semibold">This action will:</div>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Delete ALL connections from secure storage</li>
                  <li>Clear all local storage data</li>
                  <li>Reset all application state</li>
                  <li>Automatically reload the application</li>
                </ul>
              </div>

              <div className="font-semibold text-destructive">
                ⚠️ This action cannot be undone. The application will reload
                immediately after clearing.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  toast.info("Emergency clearing all connections...");
                  await emergencyClearAllConnections();
                } catch (error) {
                  console.error(
                    "Failed to emergency clear connections:",
                    error,
                  );
                  toast.error(
                    "Failed to clear connections - manual reload may be needed",
                  );
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Force Clear & Reload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
