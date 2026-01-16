import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { StreamEntry } from "@/adapters/types/redis";

interface StreamEditorProps {
  connectionId: string;
  database: number;
  keyName: string;
  onUpdate: () => void;
}

export const StreamEditor = ({
  connectionId,
  database,
  keyName,
  onUpdate,
}: StreamEditorProps) => {
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [newField, setNewField] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchEntries();
  }, [keyName]);

  const fetchEntries = async () => {
    try {
      const result = await invoke<StreamEntry[]>("keyvalue_execute", {
        connectionId,
        command: "stream_range",
        args: [database.toString(), keyName, "-", "+", "20"], // Latest 20 entries
      });
      setEntries(result || []);
    } catch (error) {
      toast.error(`Failed to fetch Stream: ${error}`);
      setEntries([]);
    }
  };

  const handleAdd = async () => {
    if (!newField || !newValue) return;

    try {
      setIsLoading(true);
      await invoke("keyvalue_execute", {
        connectionId,
        command: "stream_add",
        args: [database.toString(), keyName, "*", newField, newValue],
      });
      setNewField("");
      setNewValue("");
      fetchEntries();
      onUpdate();
      toast.success("Entry added");
    } catch (error) {
      toast.error(`Failed to add entry: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Input
          placeholder="Field"
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          className="flex-1"
        />
        <Input
          placeholder="Value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="flex-1"
        />
        <Button onClick={handleAdd} disabled={isLoading || !newField || !newValue}>
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 text-left font-medium w-[150px]">ID</th>
              <th className="p-2 text-left font-medium">Fields</th>
              <th className="p-2 text-right font-medium w-[100px]">Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-4 text-center text-muted-foreground">
                  No entries found (showing latest 20)
                </td>
              </tr>
            ) : (
              entries.map(({ id, fields }) => (
                <tr key={id} className="border-t">
                  <td className="p-2 font-mono text-xs align-top">{id}</td>
                  <td className="p-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(fields).map(([k, v]) => (
                        <span
                          key={k}
                          className="inline-flex items-center rounded-sm border px-1 text-xs"
                        >
                          <span className="font-medium text-muted-foreground mr-1">
                            {k}:
                          </span>
                          <span className="font-mono">{v}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-2 text-right align-top">
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
