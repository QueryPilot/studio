import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Plus, Check } from "lucide-react";
import { ZSetMember } from "@/adapters/types/redis";

interface ZSetEditorProps {
  connectionId: string;
  database: number;
  keyName: string;
  onUpdate: () => void;
}

export const ZSetEditor = ({
  connectionId,
  database,
  keyName,
  onUpdate,
}: ZSetEditorProps) => {
  const [members, setMembers] = useState<ZSetMember[]>([]);
  const [newMember, setNewMember] = useState("");
  const [newScore, setNewScore] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, [keyName]);

  const fetchMembers = async () => {
    try {
      const result = await invoke<ZSetMember[]>("keyvalue_execute", {
        connectionId,
        command: "zset_range",
        args: [database.toString(), keyName, "0", "-1", "withscores"],
      });
      setMembers(result || []);
    } catch (error) {
      toast.error(`Failed to fetch ZSet: ${error}`);
      setMembers([]);
    }
  };

  const handleAdd = async () => {
    if (!newMember || !newScore) return;

    try {
      setIsLoading(true);
      await invoke("keyvalue_execute", {
        connectionId,
        command: "zset_add",
        args: [database.toString(), keyName, newMember, newScore],
      });
      setNewMember("");
      setNewScore("");
      fetchMembers();
      onUpdate();
      toast.success("Member added");
    } catch (error) {
      toast.error(`Failed to add member: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Input
          placeholder="Member"
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          className="flex-1"
        />
        <Input
          type="number"
          placeholder="Score"
          value={newScore}
          onChange={(e) => setNewScore(e.target.value)}
          className="w-32"
        />
        <Button onClick={handleAdd} disabled={isLoading || !newMember || !newScore}>
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 text-left font-medium">Member</th>
              <th className="p-2 text-right font-medium">Score</th>
              <th className="p-2 text-right font-medium w-[100px]">Action</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-4 text-center text-muted-foreground">
                  No members
                </td>
              </tr>
            ) : (
              members.map(({ member, score }) => (
                <tr key={member} className="border-t">
                  <td className="p-2 font-mono text-xs">{member}</td>
                  <td className="p-2 text-right font-mono text-xs">{score}</td>
                  <td className="p-2 text-right">
                    {/* Actions can be added later */}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
