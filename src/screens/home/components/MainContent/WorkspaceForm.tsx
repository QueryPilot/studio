/**
 * WorkspaceForm - Create or edit workspace configuration
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { IconFolder, IconArrowLeft, IconCheck } from "@tabler/icons-react";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { toast } from "sonner";

const WORKSPACE_ICONS = ["📦", "🚀", "💼", "🔧", "📊", "🌐", "⚡", "🔒"];

export function WorkspaceForm() {
  const connections = useConnectionStore((s) => s.connections);

  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const createWorkspace = useWorkspaceBundleStore((s) => s.createWorkspace);
  const updateWorkspace = useWorkspaceBundleStore((s) => s.updateWorkspace);

  const workspaceFormMode = useHomeScreenStore((s) => s.workspaceFormMode);
  const editingWorkspaceId = useHomeScreenStore((s) => s.editingWorkspaceId);
  const setContentMode = useHomeScreenStore((s) => s.setContentMode);

  const isEditing = workspaceFormMode === "edit" && editingWorkspaceId;
  const existingWorkspace = isEditing
    ? savedWorkspaces.find((ws) => ws.id === editingWorkspaceId)
    : null;

  // Form state
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📦");
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<
    Set<string>
  >(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Populate form when editing
  useEffect(() => {
    if (existingWorkspace) {
      setName(existingWorkspace.name);
      setIcon(existingWorkspace.icon || "📦");
      setSelectedConnectionIds(new Set(existingWorkspace.connectionIds));
    }
  }, [existingWorkspace]);

  const handleBack = () => {
    setContentMode("workspace-list");
  };

  const handleToggleConnection = (connectionId: string) => {
    const newSet = new Set(selectedConnectionIds);
    if (newSet.has(connectionId)) {
      newSet.delete(connectionId);
    } else {
      newSet.add(connectionId);
    }
    setSelectedConnectionIds(newSet);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Please enter a workspace name");
      return;
    }

    if (selectedConnectionIds.size === 0) {
      toast.error("Please select at least one connection");
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditing && editingWorkspaceId) {
        await updateWorkspace(editingWorkspaceId, {
          name: name.trim(),
          icon,
          connectionIds: Array.from(selectedConnectionIds),
        });
        toast.success(`Updated workspace "${name}"`);
      } else {
        await createWorkspace(name.trim(), Array.from(selectedConnectionIds));
        toast.success(`Created workspace "${name}"`);
      }
      setContentMode("workspace-list");
    } catch (error) {
      toast.error(isEditing ? "Failed to update workspace" : "Failed to create workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <IconArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <IconFolder className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">
              {isEditing ? "Edit Workspace" : "Create Workspace"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isEditing
                ? "Update workspace configuration"
                : "Bundle connections into a workspace"}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            placeholder="Production Stack"
            autoFocus
          />
        </div>

        {/* Icon */}
        <div className="space-y-2">
          <Label>Icon</Label>
          <div className="flex gap-2">
            {WORKSPACE_ICONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => { setIcon(emoji); }}
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center text-xl",
                  "border transition-colors",
                  icon === emoji
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50",
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Connections */}
        <div className="space-y-2">
          <Label>Select Connections ({selectedConnectionIds.size})</Label>
          <div className="border rounded-lg max-h-64 overflow-y-auto">
            {connections.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No connections available
              </div>
            ) : (
              <div className="divide-y">
                {connections.map((conn) => (
                  <label
                    key={conn.profile.id}
                    className={cn(
                      "flex items-center gap-3 p-3 cursor-pointer",
                      "hover:bg-accent/50 transition-colors",
                      selectedConnectionIds.has(conn.profile.id) && "bg-accent/30",
                    )}
                  >
                    <Checkbox
                      checked={selectedConnectionIds.has(conn.profile.id)}
                      onCheckedChange={() => {
                        handleToggleConnection(conn.profile.id);
                      }}
                    />
                    <img
                      src={getDatabaseLogo(conn.profile.db_type)}
                      alt=""
                      className="w-5 h-5 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {conn.profile.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {conn.profile.host}:{conn.profile.port}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <Button type="button" variant="outline" onClick={handleBack}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            <IconCheck className="w-4 h-4 mr-2" />
            {isSubmitting
              ? "Saving..."
              : isEditing
                ? "Update Workspace"
                : "Create Workspace"}
          </Button>
        </div>
      </form>
    </div>
  );
}
