import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconPlus, IconSortAscending, IconSortDescending } from "@tabler/icons-react";
import { toast } from "sonner";

export interface ZSetMember {
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
  const [newScore, setNewScore] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const sortedValue = [...value].sort((a, b) => {
    return sortOrder === "asc" ? a.score - b.score : b.score - a.score;
  });

  const handleAddMember = async () => {
    if (!newMember || !newScore) {
      toast.error("Member and score required");
      return;
    }

    try {
      await invoke("redis_zadd", {
        connId: connectionId,
        key: keyName,
        member: newMember,
        score: parseFloat(newScore),
      });
      toast.success("Member added/updated");
      setNewMember("");
      setNewScore("");
      onUpdate();
    } catch (err) {
      toast.error(`Add failed: ${err}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="border rounded max-h-[400px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="p-2 text-left font-medium">Member</th>
              <th className="p-2 text-left font-medium w-32 cursor-pointer hover:bg-muted" onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}>
                <div className="flex items-center gap-1">
                  Score
                  {sortOrder === "asc" ? <IconSortAscending className="h-4 w-4" /> : <IconSortDescending className="h-4 w-4" />}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedValue.map((item, idx) => (
              <tr key={`${item.member}-${idx}`} className="border-t">
                <td className="p-2 font-mono text-xs">{item.member}</td>
                <td className="p-2 font-mono text-xs">{item.score}</td>
              </tr>
            ))}
            {value.length === 0 && (
              <tr>
                <td colSpan={2} className="p-4 text-center text-muted-foreground">
                  Empty sorted set
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          placeholder="Member"
          className="h-7 text-xs font-mono flex-1"
        />
        <Input
          value={newScore}
          onChange={(e) => setNewScore(e.target.value)}
          placeholder="Score"
          type="number"
          className="h-7 text-xs font-mono w-24"
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
