/**
 * WorkspaceDetailView - View and manage a single workspace
 */

import { cn } from "@/lib/utils";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { windowManager } from "@/services/windowManager";
import { Button } from "@/components/ui/button";
import {
  IconArrowLeft,
  IconPlayerPlay,
  IconPencil,
  IconDownload,
  IconTrash,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { toast } from "sonner";
import { format } from "date-fns";

export function WorkspaceDetailView() {
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const updateWorkspace = useWorkspaceBundleStore((s) => s.updateWorkspace);
  const deleteWorkspace = useWorkspaceBundleStore((s) => s.deleteWorkspace);

  const connections = useConnectionStore((s) => s.connections);

  const selectedWorkspaceId = useHomeScreenStore((s) => s.selectedWorkspaceId);
  const setContentMode = useHomeScreenStore((s) => s.setContentMode);
  const showWorkspaceForm = useHomeScreenStore((s) => s.showWorkspaceForm);

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
      // Use windowManager to open (handles multi-window prevention)
      await windowManager.openNamedWorkspace(workspace.id, workspace.name, {
        icon: workspace.icon,
      });
    } catch (error: unknown) {
      toast.error("Failed to open workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteWorkspace(workspace.id);
      toast.success(`Deleted workspace "${workspace.name}"`);
      setContentMode("workspace-list");
    } catch (error) {
      toast.error("Failed to delete workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleRemoveConnection = async (connectionId: string) => {
    const newConnectionIds = workspace.connectionIds.filter(
      (id) => id !== connectionId,
    );
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
        <Button
          variant="outline"
          onClick={() => { showWorkspaceForm("edit", workspace.id); }}
        >
          <IconPencil className="w-4 h-4 mr-2" />
          Edit
        </Button>
        <Button variant="outline">
          <IconDownload className="w-4 h-4 mr-2" />
          Export
        </Button>
        <Button
          variant="outline"
          className="text-red-500 hover:text-red-600"
          onClick={() => void handleDelete()}
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
            onClick={() => { showWorkspaceForm("edit", workspace.id); }}
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
              onClick={() => { showWorkspaceForm("edit", workspace.id); }}
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
                    onClick={() => void handleRemoveConnection(conn.profile.id)}
                  >
                    <IconX className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
