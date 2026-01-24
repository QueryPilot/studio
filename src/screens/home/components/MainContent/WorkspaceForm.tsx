import { logger } from "@/lib/logger";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { IconLoader2, IconArrowLeft, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { toast } from "sonner";
import { getDatabaseLogo } from "@/utils/databaseLogos";

// Common emojis for workspaces
const WORKSPACE_EMOJIS = [
  "🚀",
  "💼",
  "🏢",
  "🔧",
  "⚡",
  "🌟",
  "🎯",
  "📊",
  "🔥",
  "💻",
  "🌈",
  "🎨",
  "🔬",
  "🏗️",
  "📱",
  "🌐",
  "⚙️",
  "🎭",
  "🎪",
  "🎬",
  "🎮",
  "🎲",
  "🎯",
  "🎪",
];

export function WorkspaceForm() {
  const workspaceFormMode = useHomeScreenStore((s) => s.workspaceFormMode);
  const workspaceFormId = useHomeScreenStore((s) => s.workspaceFormId);
  const closeWorkspaceForm = useHomeScreenStore((s) => s.closeWorkspaceForm);

  const connections = useConnectionStore((s) => s.connections);
  const {
    createWorkspace,
    updateWorkspace,
    savedWorkspaces,
    loadSavedWorkspaces,
  } = useWorkspaceBundleStore();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState(WORKSPACE_EMOJIS[0]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>(
    [],
  );
  const [isSaving, setIsSaving] = useState(false);

  const isEditMode = workspaceFormMode === "edit";

  // Load workspaces on mount
  useEffect(() => {
    void loadSavedWorkspaces();
  }, [loadSavedWorkspaces]);

  // Load existing workspace data for edit mode
  useEffect(() => {
    if (isEditMode && workspaceFormId) {
      const workspace = savedWorkspaces.find((ws) => ws.id === workspaceFormId);
      if (workspace) {
        setName(workspace.name);
        setIcon(workspace.icon || WORKSPACE_EMOJIS[0]);
        setSelectedConnectionIds(workspace.connectionIds);
      }
    } else {
      // Reset for create mode
      setName("");
      setIcon(WORKSPACE_EMOJIS[0]);
      setSelectedConnectionIds([]);
    }
  }, [isEditMode, workspaceFormId, savedWorkspaces]);

  const handleConnectionToggle = (connectionId: string) => {
    setSelectedConnectionIds((prev) => {
      if (prev.includes(connectionId)) {
        return prev.filter((id) => id !== connectionId);
      }
      return [...prev, connectionId];
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Error", { description: "Please provide a workspace name" });
      return;
    }

    if (selectedConnectionIds.length === 0) {
      toast.error("Error", {
        description: "Please select at least one connection",
      });
      return;
    }

    setIsSaving(true);
    try {
      if (isEditMode && workspaceFormId) {
        await updateWorkspace(workspaceFormId, {
          name: name.trim(),
          icon,
          connectionIds: selectedConnectionIds,
        });
        toast.success("Success", {
          description: "Workspace updated successfully",
        });
      } else {
        const workspaceId = await createWorkspace(
          name.trim(),
          selectedConnectionIds,
        );
        // Update the workspace config with the icon
        await updateWorkspace(workspaceId, { icon });
        toast.success("Success", {
          description: "Workspace created successfully",
        });
      }

      closeWorkspaceForm();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save workspace";
      toast.error("Error", { description: errorMessage });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/40">
        <Button
          variant="ghost"
          size="sm"
          onClick={closeWorkspaceForm}
          className="h-8 w-8 p-0"
        >
          <IconArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-base font-semibold">
            {isEditMode ? "Edit Workspace" : "New Workspace"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isEditMode
              ? "Update workspace details and connections"
              : "Create a new workspace with multiple connections"}
          </p>
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl space-y-6">
          {/* Workspace Name */}
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace Name</Label>
            <Input
              id="workspace-name"
              placeholder="e.g., Production Stack, Local Development"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9"
            />
          </div>

          {/* Icon Picker */}
          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex items-center gap-2">
              <div className="text-3xl">{icon}</div>
              <div className="flex flex-wrap gap-1">
                {WORKSPACE_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setIcon(emoji)}
                    className={cn(
                      "text-2xl w-10 h-10 rounded-md hover:bg-accent transition-colors",
                      icon === emoji && "bg-accent ring-2 ring-primary",
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Connection Selection */}
          <div className="space-y-3">
            <div>
              <Label>Connections</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Select connections to include in this workspace
              </p>
            </div>

            {connections.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No connections available. Create a connection first.
              </div>
            ) : (
              <div className="space-y-1 border border-border/40 rounded-lg p-3 max-h-[400px] overflow-y-auto">
                {connections.map((connection) => {
                  const isSelected = selectedConnectionIds.includes(
                    connection.profile.id,
                  );
                  const logo = getDatabaseLogo(connection.profile.db_type);

                  return (
                    <div
                      key={connection.profile.id}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-md hover:bg-accent/50 transition-colors cursor-pointer",
                        isSelected && "bg-accent",
                      )}
                      onClick={() =>
                        handleConnectionToggle(connection.profile.id)
                      }
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() =>
                          handleConnectionToggle(connection.profile.id)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="w-6 h-6 shrink-0">{logo}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {connection.profile.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {connection.profile.host}:{connection.profile.port} /{" "}
                          {connection.profile.database}
                        </div>
                      </div>
                      {isSelected && (
                        <IconCheck className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {selectedConnectionIds.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {selectedConnectionIds.length} connection
                {selectedConnectionIds.length !== 1 ? "s" : ""} selected
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/40">
        <Button variant="outline" onClick={closeWorkspaceForm}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>{isEditMode ? "Update Workspace" : "Create Workspace"}</>
          )}
        </Button>
      </div>
    </div>
  );
}
