import { useState } from "react";
import {
  IconTrash,
  IconFolderPlus,
  IconDownload,
  IconX,
  IconCheck,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { vaultStorage } from "@/services/vaultStorage";
import { toast } from "sonner";
import type { WorkspaceConfig } from "@/types/workspace";

interface BulkActionsBarProps {
  selectedCount: number;
  selectedIds: Set<string>;
  onClearSelection: () => void;
}

export function BulkActionsBar({
  selectedCount,
  selectedIds,
  onClearSelection,
}: BulkActionsBarProps) {
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const connections = useConnectionStore((s) => s.connections);
  const fetchConnections = useConnectionStore((s) => s.fetchConnections);
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const loadSavedWorkspaces = useWorkspaceBundleStore(
    (s) => s.loadSavedWorkspaces
  );
  const addConnectionToSavedWorkspace = useWorkspaceBundleStore(
    (s) => s.addConnectionToSavedWorkspace
  );
  const removeConnectionFromSavedWorkspace = useWorkspaceBundleStore(
    (s) => s.removeConnectionFromSavedWorkspace
  );

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      let deleted = 0;
      for (const id of selectedIds) {
        try {
          await deleteConnection(id);
          deleted++;
        } catch (error) {
          console.error(`Failed to delete connection ${id}:`, error);
        }
      }
      toast.success(`Deleted ${deleted} connection${deleted !== 1 ? "s" : ""}`);
      onClearSelection();
      setDeleteDialogOpen(false);
    } catch (error) {
      toast.error("Failed to delete connections", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMoveToWorkspace = async (workspace: WorkspaceConfig | null) => {
    setIsMoving(true);
    try {
      const targetWorkspaceIds = workspace ? [workspace.id] : [];

      for (const connectionId of selectedIds) {
        const conn = await vaultStorage.getConnection(connectionId);
        if (conn) {
          // Remove from previous workspaces (workspace.connectionIds side)
          const previousWorkspaceIds = conn.metadata.workspace_ids || [];
          for (const wsId of previousWorkspaceIds) {
            if (wsId !== workspace?.id) {
              await removeConnectionFromSavedWorkspace(wsId, connectionId);
            }
          }

          // Add to target workspace (workspace.connectionIds side)
          if (workspace) {
            await addConnectionToSavedWorkspace(workspace.id, connectionId);
          }

          // Update connection metadata side
          conn.metadata.workspace_ids = targetWorkspaceIds;
          await vaultStorage.updateMetadata(connectionId, conn.metadata);
        }
      }

      await fetchConnections();
      await loadSavedWorkspaces();

      const targetName = workspace?.name ?? "Uncategorized";
      toast.success(
        `Moved ${selectedIds.size} connection${selectedIds.size !== 1 ? "s" : ""} to ${targetName}`
      );
      onClearSelection();
    } catch (error) {
      toast.error("Failed to move connections", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsMoving(false);
    }
  };

  const handleExport = () => {
    try {
      const selectedConnections = connections.filter((c) =>
        selectedIds.has(c.profile.id)
      );

      const exportData = selectedConnections.map((c) => ({
        name: c.profile.name,
        db_type: c.profile.db_type,
        host: c.profile.host,
        port: c.profile.port,
        database: c.profile.database,
        username: c.profile.username,
        // Exclude password for security
        tags: c.metadata.tags,
      }));

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `connections-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(
        `Exported ${selectedIds.size} connection${selectedIds.size !== 1 ? "s" : ""}`
      );
      onClearSelection();
    } catch (error) {
      toast.error("Failed to export connections", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  if (selectedCount === 0) return null;

  return (
    <>
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 p-1 bg-card border rounded-lg shadow-lg">
        <div className="flex items-center gap-2 pr-3 border-r">
          <IconCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            {selectedCount} selected
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" disabled={isMoving}>
                <IconFolderPlus className="h-4 w-4 mr-1" />
                Move to
              </Button>
            }
          />
          <DropdownMenuContent align="center">
            <DropdownMenuItem onClick={() => handleMoveToWorkspace(null)}>
              Uncategorized
            </DropdownMenuItem>
            {savedWorkspaces.map((ws) => (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => handleMoveToWorkspace(ws)}
              >
                {ws.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" onClick={handleExport}>
          <IconDownload className="h-4 w-4 mr-1" />
          Export
        </Button>

        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => { setDeleteDialogOpen(true); }}
        >
          <IconTrash className="h-4 w-4 mr-1" />
          Delete
        </Button>

        <div className="pl-2 border-l">
          <Button
            variant="ghost"
            onClick={onClearSelection}
          >
            <IconX className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedCount} connections?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The selected connections will be
              permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => { setDeleteDialogOpen(false); }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
