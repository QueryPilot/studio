/**
 * WorkspacePickerScreen - Minimal picker for /workspace route (no workspace ID)
 *
 * Displays recent workspaces and allows opening or creating new workspaces.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IconFolder, IconPlus, IconClock } from "@tabler/icons-react";

export function WorkspacePickerScreen() {
  const navigate = useNavigate();
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const loadSavedWorkspaces = useWorkspaceBundleStore(
    (s) => s.loadSavedWorkspaces,
  );
  const openWorkspace = useWorkspaceBundleStore((s) => s.openWorkspace);
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);

  // Load workspaces on mount
  useEffect(() => {
    void loadSavedWorkspaces();
  }, [loadSavedWorkspaces]);

  // Navigate when workspace is opened
  useEffect(() => {
    if (activeWorkspace) {
      // Navigate is synchronous but lint thinks it's async
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      navigate(`/workspace/${activeWorkspace.config.id}`);
    }
  }, [activeWorkspace, navigate]);

  // Sort by lastOpenedAt (most recent first)
  const recentWorkspaces = [...savedWorkspaces]
    .sort((a, b) => {
      const aTime = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0;
      const bTime = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 5);

  const handleOpenWorkspace = async (workspaceId: string) => {
    await openWorkspace(workspaceId);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-2">
            <IconFolder className="w-6 h-6 text-primary" />
          </div>
          <CardTitle>Select Workspace</CardTitle>
          <CardDescription>
            Choose a workspace to open or create a new one
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Recent Workspaces */}
          {recentWorkspaces.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconClock className="w-4 h-4" />
                <span>Recent</span>
              </div>
              <div className="space-y-1">
                {recentWorkspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => void handleOpenWorkspace(ws.id)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded-md",
                      "hover:bg-accent text-left transition-colors",
                    )}
                  >
                    <div>
                      <div className="font-medium">
                        {ws.icon} {ws.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {ws.connectionIds.length} connection
                        {ws.connectionIds.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm">
                      Open
                    </Button>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {savedWorkspaces.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <IconFolder className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No saved workspaces yet</p>
              <p className="text-sm">Create one from the home screen</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => navigate("/")}
            >
              View All Workspaces
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => navigate("/")}
            >
              <IconPlus className="w-4 h-4 mr-2" />
              Open Single Connection
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
