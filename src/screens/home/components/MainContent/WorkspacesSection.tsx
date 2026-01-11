/**
 * WorkspacesSection - Full workspace management view in MainContent
 */

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { windowManager } from "@/services/windowManager";
import { Button } from "@/components/ui/button";
import {
  IconFolder,
  IconPlus,
  IconDots,
  IconPlayerPlay,
  IconPencil,
  IconDownload,
  IconTrash,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export function WorkspacesSection() {
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const loadSavedWorkspaces = useWorkspaceBundleStore(
    (s) => s.loadSavedWorkspaces,
  );
  const deleteWorkspace = useWorkspaceBundleStore((s) => s.deleteWorkspace);

  const showWorkspaceForm = useHomeScreenStore((s) => s.showWorkspaceForm);
  const showWorkspaceDetail = useHomeScreenStore((s) => s.showWorkspaceDetail);

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
      
      // Use windowManager to open (handles multi-window prevention)
      await windowManager.openNamedWorkspace(workspaceId, workspace.name, {
        icon: workspace.icon,
      });
    } catch (error: unknown) {
      toast.error("Failed to open workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleDeleteWorkspace = async (workspaceId: string, name: string) => {
    try {
      await deleteWorkspace(workspaceId);
      toast.success(`Deleted workspace "${name}"`);
    } catch (error) {
      toast.error("Failed to delete workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  // Sort by lastOpenedAt
  const sortedWorkspaces = [...savedWorkspaces].sort((a, b) => {
    const aTime = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0;
    const bTime = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <IconFolder className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Workspaces</h2>
            <p className="text-sm text-muted-foreground">
              Manage your saved workspaces
            </p>
          </div>
        </div>
        <Button onClick={() => { showWorkspaceForm("create"); }}>
          <IconPlus className="w-4 h-4 mr-2" />
          Create Workspace
        </Button>
      </div>

      {/* Workspace Grid */}
      {sortedWorkspaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <IconFolder className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-medium mb-2">No Workspaces Yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm">
            Create a workspace to bundle multiple connections together for easy
            access.
          </p>
          <Button onClick={() => { showWorkspaceForm("create"); }}>
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
              onClick={() => { showWorkspaceDetail(ws.id); }}
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
                    onClick={(e) => { e.stopPropagation(); }}
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
                        showWorkspaceForm("edit", ws.id);
                      }}
                    >
                      <IconPencil className="w-4 h-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); }}>
                      <IconDownload className="w-4 h-4 mr-2" />
                      Export
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteWorkspace(ws.id, ws.name);
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
                    ? `Last opened ${formatDistanceToNow(new Date(ws.lastOpenedAt), { addSuffix: true })}`
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
  );
}
