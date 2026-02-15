import { useState } from "react";
import { cn } from "@/lib/utils";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { windowManager } from "@/services/windowManager";
import { Button } from "@/components/ui/button";
import {
  IconArrowLeft,
  IconPlayerPlay,
  IconDownload,
  IconTrash,
  IconPlus,
  IconX,
  IconAlertTriangle,
} from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { toast } from "sonner";
import { format } from "date-fns";

export function WorkspaceDetailView() {
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const updateWorkspace = useWorkspaceBundleStore((s) => s.updateWorkspace);
  const deleteWorkspace = useWorkspaceBundleStore((s) => s.deleteWorkspace);

  const connections = useConnectionStore((s) => s.connections);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);

  const selectedWorkspaceId = useHomeScreenStore((s) => s.selectedWorkspaceId);
  const setContentMode = useHomeScreenStore((s) => s.setContentMode);
  const openConnectionForm = useHomeScreenStore((s) => s.openConnectionForm);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const workspace = savedWorkspaces.find((ws) => ws.id === selectedWorkspaceId);

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <p className="text-muted-foreground">Workspace not found</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => { setContentMode("workspace-list"); }}
        >
          Back to Workspaces
        </Button>
      </div>
    );
  }

  const workspaceConnections = workspace.connectionIds
    .map((id) => connections.find((c) => c.profile.id === id))
    .filter(Boolean);

  const handleBack = () => {
    setContentMode("workspace-list");
  };

  const handleOpen = async () => {
    try {
      await windowManager.openNamedWorkspace(workspace.id, workspace.name, {
        icon: workspace.icon,
      });
    } catch (error: unknown) {
      toast.error("Failed to open workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleDeleteWorkspaceOnly = async () => {
    setIsDeleting(true);
    try {
      await deleteWorkspace(workspace.id);
      toast.success(`Deleted workspace "${workspace.name}"`);
      setContentMode("workspace-list");
    } catch (error) {
      toast.error("Failed to delete workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
    }
  };

  const handleDeleteWithConnections = async () => {
    setIsDeleting(true);
    try {
      for (const connId of workspace.connectionIds) {
        await deleteConnection(connId);
      }
      await deleteWorkspace(workspace.id);
      toast.success(
        `Deleted workspace "${workspace.name}" and ${workspace.connectionIds.length} connection(s)`,
      );
      setContentMode("workspace-list");
    } catch (error) {
      toast.error("Failed to delete", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <IconArrowLeft className="w-5 h-5" />
        </Button>
        <span className="text-2xl">{workspace.icon || "📦"}</span>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{workspace.name}</h2>
          <p className="text-sm text-muted-foreground">
            Created {format(new Date(workspace.createdAt), "MMM d, yyyy")}
            {workspace.lastOpenedAt && (
              <>
                {" · Last opened "}
                {format(new Date(workspace.lastOpenedAt), "MMM d, yyyy")}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-6">
        <Button onClick={() => void handleOpen()}>
          <IconPlayerPlay className="w-4 h-4 mr-2" />
          Open Workspace
        </Button>
        <Button variant="outline">
          <IconDownload className="w-4 h-4 mr-2" />
          Export
        </Button>
        <Button
          variant="outline"
          className="text-red-500 hover:text-red-600"
          onClick={() => setIsDeleteDialogOpen(true)}
        >
          <IconTrash className="w-4 h-4 mr-2" />
          Delete
        </Button>
      </div>

      {/* Connections */}
      <div className="border rounded-lg">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <h3 className="font-medium">
            Connections ({workspace.connectionIds.length})
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { openConnectionForm("create"); }}
          >
            <IconPlus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </div>

        {workspaceConnections.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            <p>No connections in this workspace</p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => { openConnectionForm("create"); }}
            >
              Add Connections
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {workspaceConnections.map((conn) => {
              if (!conn) return null;
              return (
                <div
                  key={conn.profile.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3",
                    "hover:bg-accent/30 transition-colors",
                  )}
                >
                  <img
                    src={getDatabaseLogo(conn.profile.db_type)}
                    alt=""
                    className="w-6 h-6 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {conn.profile.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {conn.profile.host}:{conn.profile.port} ·{" "}
                      {conn.profile.database}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-red-500"
                    onClick={() => {
                      const newConnectionIds = workspace.connectionIds.filter(
                        (id) => id !== conn.profile.id,
                      );
                      void (async () => {
                        try {
                          await updateWorkspace(workspace.id, {
                            connectionIds: newConnectionIds,
                          });
                          toast.success("Removed connection from workspace");
                        } catch (error) {
                          toast.error("Failed to remove connection", {
                            description: error instanceof Error ? error.message : "Unknown error",
                          });
                        }
                      })();
                    }}
                  >
                    <IconX className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconAlertTriangle className="w-5 h-5 text-destructive" />
              Delete Workspace
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{workspace.name}"?
              {workspace.connectionIds.length > 0 && (
                <span className="block mt-2 text-foreground">
                  This workspace contains {workspace.connectionIds.length} connection
                  {workspace.connectionIds.length !== 1 ? "s" : ""}.
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
            {workspace.connectionIds.length > 0 && (
              <button
                type="button"
                onClick={() => void handleDeleteWithConnections()}
                disabled={isDeleting}
                className="w-full text-left p-3 rounded-lg border border-destructive/30 hover:bg-destructive/5 transition-colors disabled:opacity-50"
              >
                <div className="font-medium text-sm text-destructive">Delete everything</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Permanently delete workspace and all {workspace.connectionIds.length} connection
                  {workspace.connectionIds.length !== 1 ? "s" : ""}.
                </div>
              </button>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDeleteDialogOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
