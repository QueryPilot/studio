/**
 * Redis Set Editor
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";

interface SetEditorProps {
  connectionId: string;
  keyName: string;
  value: string[];
  onUpdate: () => void;
}

export function SetEditor({
  connectionId: _connectionId,
  keyName: _keyName,
  value,
  onUpdate: _onUpdate,
}: SetEditorProps) {
  const [newMember, setNewMember] = useState("");

  const handleAddMember = () => {
    if (!newMember) {
      toast.error("Value required");
      return;
    }

    // Note: We'd need SADD command which isn't exposed yet
    toast.info("Set add operations coming soon");
    setNewMember("");
  };

  return (
    <div className="space-y-3">
      {/* Set Members */}
      <div className="border rounded max-h-[400px] overflow-auto">
        <div className="p-2 flex flex-wrap gap-2">
          {value.map((member, idx) => (
            <span
              key={idx}
              className="px-2 py-1 bg-muted rounded text-xs font-mono"
            >
              {member}
            </span>
          ))}
          {value.length === 0 && (
            <span className="text-muted-foreground text-sm p-2">Empty set</span>
          )}
        </div>
      </div>

      {/* Add Member */}
      <div className="flex items-center gap-2">
        <Input
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          placeholder="New member value"
          className="h-7 text-xs font-mono flex-1"
        />
        <Button size="sm" onClick={handleAddMember}>
          <IconPlus className="h-4 w-4 mr-1" />
          SADD
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {value.length} member(s)
      </p>
    </div>
  );
}
