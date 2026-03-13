import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { windowManager } from "@/services/windowManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  IconLayout2,
  IconPlus,
  IconDots,
  IconPlayerPlay,
  IconDownload,
  IconTrash,
  IconAlertTriangle,
  IconPencil,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import type { DeleteDialogState } from "../shared/types";

export function WorkspacesSection() {
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const loadSavedWorkspaces = useWorkspaceBundleStore(
    (s) => s.loadSavedWorkspaces,
  );
  const deleteWorkspace = useWorkspaceBundleStore((s) => s.deleteWorkspace);
  const createWorkspace = useWorkspaceBundleStore((s) => s.createWorkspace);

  const deleteConnection = useConnectionStore((s) => s.deleteConnection);

  const showWorkspaceDetail = useHomeScreenStore((s) => s.showWorkspaceDetail);
  const openWorkspaceForm = useHomeScreenStore((s) => s.openWorkspaceForm);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({
    isOpen: false,
    workspaceId: null,
    workspaceName: "",
    connectionCount: 0,
  });

  // Load workspaces on mount
  useEffect(() => {
    void loadSavedWorkspaces();
  }, [loadSavedWorkspaces]);

  const handleOpenWorkspace = async (workspaceId: string) => {
    try {
      const workspace = savedWorkspaces.find((ws) => ws.id === workspaceId);
      if (!workspace) {
        toast.error("Workspace not found");
        return;
      }

      await windowManager.openNamedWorkspace(workspaceId, workspace.name, {
        icon: workspace.icon,
      });
    } catch (error: unknown) {
      toast.error("Failed to open workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const openDeleteDialog = (workspace: (typeof savedWorkspaces)[0]) => {
    setDeleteDialog({
      isOpen: true,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      connectionCount: workspace.connectionIds.length,
    });
  };

  const closeDeleteDialog = () => {
    setDeleteDialog({
      isOpen: false,
      workspaceId: null,
      workspaceName: "",
      connectionCount: 0,
    });
  };

  const handleDeleteWorkspaceOnly = async () => {
    if (!deleteDialog.workspaceId) return;
    setIsDeleting(true);
    try {
      await deleteWorkspace(deleteDialog.workspaceId);
      toast.success(`Deleted workspace "${deleteDialog.workspaceName}"`);
      closeDeleteDialog();
    } catch (error) {
      toast.error("Failed to delete workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteWithConnections = async () => {
    if (!deleteDialog.workspaceId) return;
    setIsDeleting(true);
    try {
      const workspace = savedWorkspaces.find(
        (ws) => ws.id === deleteDialog.workspaceId,
      );
      if (workspace) {
        for (const connId of workspace.connectionIds) {
          await deleteConnection(connId);
        }
      }
      await deleteWorkspace(deleteDialog.workspaceId);
      toast.success(
        `Deleted workspace "${deleteDialog.workspaceName}" and ${deleteDialog.connectionCount} connection(s)`,
      );
      closeDeleteDialog();
    } catch (error) {
      toast.error("Failed to delete", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Filter out auto-created workspaces and sort by lastOpenedAt
  const sortedWorkspaces = [...savedWorkspaces]
    .filter((ws) => !ws.autoCreated)
    .sort((a, b) => {
      const aTime = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0;
      const bTime = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0;
      return bTime - aTime;
    });

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) {
      toast.error("Please enter a workspace name");
      return;
    }
    setIsCreating(true);
    try {
      await createWorkspace(newWorkspaceName.trim(), []);
      toast.success(`Created workspace "${newWorkspaceName}"`);
      setNewWorkspaceName("");
      setIsCreateDialogOpen(false);
    } catch (error) {
      toast.error("Failed to create workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <IconLayout2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Workspaces</h2>
            <p className="text-sm text-muted-foreground">
              Manage your saved workspaces
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            openWorkspaceForm("create");
          }}
        >
          <IconPlus className="w-4 h-4 mr-2" />
          Create Workspace
        </Button>
      </div>

      {/* Workspace Grid */}
      {sortedWorkspaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <IconLayout2 className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-medium mb-2">No Workspaces Yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            Create a workspace to bundle multiple connections together for easy
            access.
          </p>
          <Button
            onClick={() => {
              openWorkspaceForm("create");
            }}
          >
            <IconPlus className="w-4 h-4 mr-2" />
            Create Your First Workspace
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedWorkspaces.map((ws) => (
            <div
              key={ws.id}
              className={cn(
                "group relative p-4 rounded-lg border bg-card",
                "hover:border-primary/50 hover:shadow-sm transition-all",
                "cursor-pointer",
              )}
              onClick={() => {
                showWorkspaceDetail(ws.id);
              }}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{ws.icon || "📦"}</span>
                  <h3 className="font-medium truncate">{ws.name}</h3>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center rounded-md hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <IconDots className="w-4 h-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleOpenWorkspace(ws.id);
                      }}
                    >
                      <IconPlayerPlay className="w-4 h-4 mr-2" />
                      Open
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        openWorkspaceForm("edit", ws.id);
                      }}
                    >
                      <IconPencil className="w-4 h-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <IconDownload className="w-4 h-4 mr-2" />
                      Export
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDeleteDialog(ws);
                      }}
                    >
                      <IconTrash className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Connection count */}
              <div className="text-sm text-muted-foreground mb-3">
                {ws.connectionIds.length} connection
                {ws.connectionIds.length !== 1 ? "s" : ""}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {ws.lastOpenedAt
                    ? `Last opened ${formatDistanceToNow(
                        new Date(ws.lastOpenedAt),
                        { addSuffix: true },
                      )}`
                    : "Never opened"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleOpenWorkspace(ws.id);
                  }}
                >
                  <IconPlayerPlay className="w-3 h-3 mr-1" />
                  Open
                </Button>
              </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Workspace name"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleCreateWorkspace();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreateWorkspace()}
              disabled={isCreating || !newWorkspaceName.trim()}
            >
              {isCreating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialog.isOpen} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconAlertTriangle className="w-5 h-5 text-destructive" />
              Delete Workspace
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteDialog.workspaceName}"?
              {deleteDialog.connectionCount > 0 && (
                <span className="block mt-2 text-foreground">
                  This workspace contains {deleteDialog.connectionCount} connection
                  {deleteDialog.connectionCount !== 1 ? "s" : ""}.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <button
              type="button"
              onClick={() => void handleDeleteWorkspaceOnly()}
              disabled={isDeleting}
              className="w-full text-left p-3 rounded-lg border hover:bg-accent transition-colors disabled:opacity-50"
            >
              <div className="font-medium text-sm">Keep connections</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Only remove the workspace. Connections will remain available.
              </div>
            </button>
            {deleteDialog.connectionCount > 0 && (
              <button
                type="button"
                onClick={() => void handleDeleteWithConnections()}
                disabled={isDeleting}
                className="w-full text-left p-3 rounded-lg border border-destructive/30 hover:bg-destructive/5 transition-colors disabled:opacity-50"
              >
                <div className="font-medium text-sm text-destructive">Delete everything</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Permanently delete workspace and all {deleteDialog.connectionCount} connection
                  {deleteDialog.connectionCount !== 1 ? "s" : ""}.
                </div>
              </button>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDeleteDialog} disabled={isDeleting}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
