/**
 * Redis ZSet Editor
 */

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconPlus, IconCheck } from "@tabler/icons-react";
import { toast } from "sonner";

interface ZSetMember {
  member: string;
  score: number;
}

interface ZSetEditorProps {
  connectionId: string;
  keyName: string;
  value: ZSetMember[];
  onUpdate: () => void;
}

export function ZSetEditor({
  connectionId,
  keyName,
  value,
  onUpdate,
}: ZSetEditorProps) {
  const [newMember, setNewMember] = useState("");
  const [newScore, setNewScore] = useState("0");
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [editScore, setEditScore] = useState("");

  const handleAddMember = async () => {
    if (!newMember) {
      toast.error("Member value required");
      return;
    }

    const score = parseFloat(newScore);
    if (isNaN(score)) {
      toast.error("Score must be a number");
      return;
    }

    try {
      await invoke("redis_zadd", {
        connId: connectionId,
        key: keyName,
        member: newMember,
        score,
      });
      toast.success("Member added");
      setNewMember("");
      setNewScore("0");
      onUpdate();
    } catch (err) {
      toast.error(`Add failed: ${err}`);
    }
  };

  const handleUpdateScore = async (member: string) => {
    const score = parseFloat(editScore);
    if (isNaN(score)) {
      toast.error("Score must be a number");
      return;
    }

    try {
      await invoke("redis_zadd", {
        connId: connectionId,
        key: keyName,
        member,
        score,
      });
      toast.success("Score updated");
      setEditingMember(null);
      onUpdate();
    } catch (err) {
      toast.error(`Update failed: ${err}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="border rounded">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-2 text-left font-medium">Member</th>
              <th className="p-2 text-left font-medium w-32">Score</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {value.map(({ member, score }) => (
              <tr key={member} className="border-t">
                <td className="p-2 font-mono text-xs">{member}</td>
                <td className="p-2">
                  {editingMember === member ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editScore}
                        onChange={(e) => { setEditScore(e.target.value); }}
                        className="h-7 text-xs font-mono w-24"
                        type="number"
                        step="any"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleUpdateScore(member);
                          if (e.key === "Escape") setEditingMember(null);
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => { void handleUpdateScore(member); }}
                      >
                        <IconCheck className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <span
                      className="font-mono text-xs cursor-pointer hover:bg-accent px-1 rounded"
                      onClick={() => {
                        setEditingMember(member);
                        setEditScore(String(score));
                      }}
                    >
                      {score}
                    </span>
                  )}
                </td>
                <td className="p-2 text-right"></td>
              </tr>
            ))}
            {value.length === 0 && (
              <tr>
                <td colSpan={3} className="p-4 text-center text-muted-foreground">
                  No members
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={newMember}
          onChange={(e) => { setNewMember(e.target.value); }}
          placeholder="Member"
          className="h-7 text-xs font-mono flex-1"
        />
        <Input
          value={newScore}
          onChange={(e) => { setNewScore(e.target.value); }}
          placeholder="Score"
          className="h-7 text-xs font-mono w-24"
          type="number"
          step="any"
        />
        <Button size="sm" onClick={handleAddMember}>
          <IconPlus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {value.length} member(s)
      </p>
    </div>
  );
}
