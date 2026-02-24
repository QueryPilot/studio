"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconLoader2, IconArrowLeft } from "@tabler/icons-react";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { toast } from "sonner";
import { IconPicker } from "@/components/IconPicker";
import { TagInput } from "@/components/TagInput";
import { ConnectionMultiSelect } from "../shared/ConnectionMultiSelect";

export function WorkspaceCreationForm() {
  const closeWorkspaceCreationForm = useHomeScreenStore((s) => s.closeWorkspaceCreationForm);
  const { createWorkspace, updateWorkspace } = useWorkspaceBundleStore();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🚀");
  const [tags, setTags] = useState<string[]>([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Error", { description: "Please provide a workspace name" });
      return;
    }

    setIsSaving(true);
    try {
      const workspaceId = await createWorkspace(name.trim(), selectedConnectionIds);
      await updateWorkspace(workspaceId, { icon, tags });
      
      toast.success("Success", {
        description: "Workspace created successfully",
      });

      closeWorkspaceCreationForm();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create workspace";
      toast.error("Error", { description: errorMessage });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border/40">
        <Button
          variant="ghost"
          size="sm"
          onClick={closeWorkspaceCreationForm}
          className="h-8 w-8 p-0"
        >
          <IconArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-base font-semibold">New Workspace</h2>
          <p className="text-xs text-muted-foreground">
            Create a workspace to group multiple connections
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl space-y-6">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace Name</Label>
            <Input
              id="workspace-name"
              placeholder="e.g., Production Stack, Backend Services"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagInput
              value={tags}
              onChange={setTags}
              placeholder="Type a tag and press Enter..."
            />
          </div>

          <div className="space-y-2">
            <Label>Connections</Label>
            <p className="text-xs text-muted-foreground">
              Select connections to include in this workspace
            </p>
            <ConnectionMultiSelect
              value={selectedConnectionIds}
              onChange={setSelectedConnectionIds}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/40">
        <Button variant="outline" onClick={closeWorkspaceCreationForm}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            "Create Workspace"
          )}
        </Button>
      </div>
    </div>
  );
}
