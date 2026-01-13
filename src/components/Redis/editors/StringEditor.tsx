/**
 * Redis String Editor
 */

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IconCheck, IconX } from "@tabler/icons-react";
import { toast } from "sonner";

interface StringEditorProps {
  connectionId: string;
  keyName: string;
  value: string;
  onUpdate: () => void;
}

export function StringEditor({
  connectionId,
  keyName,
  value,
  onUpdate,
}: StringEditorProps) {
  const [editValue, setEditValue] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await invoke("redis_set", {
        connId: connectionId,
        key: keyName,
        value: editValue,
      });
      toast.success("Value updated");
      setIsEditing(false);
      onUpdate();
    } catch (err) {
      toast.error(`Save failed: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  if (!isEditing) {
    return (
      <div
        className="p-3 bg-muted/30 rounded border font-mono text-sm cursor-pointer hover:bg-muted/50"
        onClick={() => setIsEditing(true)}
      >
        <pre className="whitespace-pre-wrap break-all">{value}</pre>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        className="font-mono text-sm min-h-[200px]"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={handleCancel} disabled={isSaving}>
          <IconX className="h-4 w-4 mr-1" />
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={isSaving}>
          <IconCheck className="h-4 w-4 mr-1" />
          Save
        </Button>
      </div>
    </div>
  );
}
