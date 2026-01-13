/**
 * Redis Hash Editor
 */

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconPlus, IconCheck } from "@tabler/icons-react";
import { toast } from "sonner";

interface HashEditorProps {
  connectionId: string;
  keyName: string;
  value: Record<string, string>;
  onUpdate: () => void;
}

export function HashEditor({
  connectionId,
  keyName,
  value,
  onUpdate,
}: HashEditorProps) {
  const [newField, setNewField] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleAddField = async () => {
    if (!newField) {
      toast.error("Field name required");
      return;
    }

    try {
      await invoke("redis_hset", {
        connId: connectionId,
        key: keyName,
        field: newField,
        value: newValue,
      });
      toast.success("Field added");
      setNewField("");
      setNewValue("");
      onUpdate();
    } catch (err) {
      toast.error(`Add failed: ${err}`);
    }
  };

  const handleUpdateField = async (field: string) => {
    try {
      await invoke("redis_hset", {
        connId: connectionId,
        key: keyName,
        field,
        value: editValue,
      });
      toast.success("Field updated");
      setEditingField(null);
      onUpdate();
    } catch (err) {
      toast.error(`Update failed: ${err}`);
    }
  };

  const entries = Object.entries(value);

  return (
    <div className="space-y-3">
      {/* Existing Fields */}
      <div className="border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-2 text-left font-medium w-1/3">Field</th>
              <th className="p-2 text-left font-medium">Value</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([field, val]) => (
              <tr key={field} className="border-t">
                <td className="p-2 font-mono text-xs">{field}</td>
                <td className="p-2">
                  {editingField === field ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-7 text-xs font-mono"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdateField(field);
                          if (e.key === "Escape") setEditingField(null);
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => handleUpdateField(field)}
                      >
                        <IconCheck className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <span
                      className="font-mono text-xs cursor-pointer hover:bg-accent px-1 rounded"
                      onClick={() => {
                        setEditingField(field);
                        setEditValue(val);
                      }}
                    >
                      {val}
                    </span>
                  )}
                </td>
                <td className="p-2 text-right">
                  {/* Delete would require HDEL command */}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="p-4 text-center text-muted-foreground">
                  No fields
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add New Field */}
      <div className="flex items-center gap-2">
        <Input
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          placeholder="Field name"
          className="h-7 text-xs font-mono"
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value"
          className="h-7 text-xs font-mono flex-1"
        />
        <Button size="sm" onClick={handleAddField}>
          <IconPlus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {entries.length} field(s)
      </p>
    </div>
  );
}
