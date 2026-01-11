import { useState, useEffect } from "react";
import {
  IconFolder,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { windowManager } from "@/services/windowManager";
import { toast } from "sonner";

export function SidebarWorkspaces() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const loadSavedWorkspaces = useWorkspaceBundleStore(
    (s) => s.loadSavedWorkspaces,
  );
  const showWorkspaceForm = useHomeScreenStore((s) => s.showWorkspaceForm);

  // Load workspaces on mount
  useEffect(() => {
    void loadSavedWorkspaces();
  }, [loadSavedWorkspaces]);

  // Sort by lastOpenedAt, most recent first, limit to 5
  const recentWorkspaces = [...savedWorkspaces]
    .sort((a, b) => {
      const aTime = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0;
      const bTime = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 5);

  const handleOpenWorkspace = async (workspaceId: string) => {
    try {
      // Find workspace to get name and icon
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

  const handleCreateWorkspace = () => {
    showWorkspaceForm("create");
  };

  if (savedWorkspaces.length === 0) {
    return (
      <div className="px-2 py-1">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-2">
          <IconFolder className="h-3 w-3" />
          <span>Workspaces</span>
        </div>
        <button
          type="button"
          onClick={handleCreateWorkspace}
          className={cn(
            "flex items-center gap-2.5 h-8 w-full px-2.5 rounded-lg",
            "text-muted-foreground hover:text-foreground",
            "hover:bg-foreground/6",
            "transition-all duration-150 ease-out",
          )}
        >
          <IconPlus className="h-4 w-4 shrink-0" />
          <span className="text-xs">Create Workspace</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 py-1">
      <button
        type="button"
        onClick={() => { setIsCollapsed(!isCollapsed); }}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md",
          "text-xs font-medium text-muted-foreground",
          "hover:text-foreground hover:bg-sidebar-accent/50",
          "transition-colors duration-150",
        )}
      >
        {isCollapsed ? (
          <IconChevronRight className="h-3 w-3" />
        ) : (
          <IconChevronDown className="h-3 w-3" />
        )}
        <IconFolder className="h-3 w-3" />
        <span>Workspaces</span>
        <span className="ml-auto text-[10px] opacity-60">
          {savedWorkspaces.length}
        </span>
      </button>

      {!isCollapsed && (
        <div className="mt-1 space-y-0.5">
          {recentWorkspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => void handleOpenWorkspace(ws.id)}
              className={cn(
                "flex items-center gap-2.5 h-8 w-full px-2.5 rounded-lg",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-foreground/6",
                "transition-all duration-150 ease-out",
              )}
            >
              <span className="text-sm shrink-0">{ws.icon || "📦"}</span>
              <span className="text-xs truncate flex-1">{ws.name}</span>
              <span className="text-[10px] opacity-50">
                {ws.connectionIds.length}
              </span>
            </button>
          ))}

          {/* Create new workspace */}
          <button
            type="button"
            onClick={handleCreateWorkspace}
            className={cn(
              "flex items-center gap-2.5 h-8 w-full px-2.5 rounded-lg",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-foreground/6 border border-dashed border-transparent hover:border-border",
              "transition-all duration-150 ease-out",
            )}
          >
            <IconPlus className="h-4 w-4 shrink-0" />
            <span className="text-xs">New Workspace</span>
          </button>
        </div>
      )}
    </div>
  );
}
