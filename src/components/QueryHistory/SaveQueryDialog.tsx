/**
 * Save Query Dialog
 *
 * Dialog for saving the current query to the saved queries collection.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQueryHistoryStore } from "@/stores/queryHistoryStore";
import { toast } from "sonner";

interface SaveQueryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  profileId?: string;
  database?: string;
  schema?: string;
}

export function SaveQueryDialog({
  open,
  onOpenChange,
  query,
  profileId,
  database,
  schema,
}: SaveQueryDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const saveCurrentQuery = useQueryHistoryStore((s) => s.saveCurrentQuery);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Please enter a name for the query");
      return;
    }

    setIsSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      await saveCurrentQuery({
        name: name.trim(),
        query,
        description: description.trim() || undefined,
        tags,
        profileId,
        database,
        schema,
      });

      toast.success("Query saved");
      onOpenChange(false);

      // Reset form
      setName("");
      setDescription("");
      setTagsInput("");
    } catch (error) {
      toast.error("Failed to save query");
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      void handleSave();
    }
  };

  // Generate a default name from the query
  const generateDefaultName = () => {
    const firstLine = query.split("\n")[0]?.trim() || "";
    const words = firstLine.split(/\s+/).slice(0, 4).join(" ");
    return words.length > 30 ? words.slice(0, 30) + "..." : words;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Save Query</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              placeholder={generateDefaultName() || "My Query"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Optional description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              placeholder="Comma-separated tags (e.g., reports, users)"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Query Preview</Label>
            <pre className="text-xs bg-muted p-2 rounded max-h-24 overflow-auto font-mono">
              {query.slice(0, 200)}
              {query.length > 200 && "..."}
            </pre>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Query"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
