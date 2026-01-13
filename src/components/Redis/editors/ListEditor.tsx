/**
 * Redis List Editor
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";

interface ListEditorProps {
  connectionId: string;
  keyName: string;
  value: string[];
  onUpdate: () => void;
}

export function ListEditor({
  connectionId: _connectionId,
  keyName: _keyName,
  value,
  onUpdate: _onUpdate,
}: ListEditorProps) {
  const [newItem, setNewItem] = useState("");

  const handleAddItem = (_side: "left" | "right") => {
    if (!newItem) {
      toast.error("Value required");
      return;
    }

    // Note: We'd need LPUSH/RPUSH commands which aren't exposed yet
    toast.info("List push operations coming soon");
    setNewItem("");
  };

  return (
    <div className="space-y-3">
      {/* List Items */}
      <div className="border rounded max-h-[400px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="p-2 text-left font-medium w-16">Index</th>
              <th className="p-2 text-left font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {value.map((item, idx) => (
              <tr key={idx} className="border-t">
                <td className="p-2 text-muted-foreground">{idx}</td>
                <td className="p-2 font-mono text-xs">{item}</td>
              </tr>
            ))}
            {value.length === 0 && (
              <tr>
                <td colSpan={2} className="p-4 text-center text-muted-foreground">
                  Empty list
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Item */}
      <div className="flex items-center gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="New item value"
          className="h-7 text-xs font-mono flex-1"
        />
        <Button size="sm" variant="outline" onClick={() => handleAddItem("left")}>
          <IconPlus className="h-4 w-4 mr-1" />
          LPUSH
        </Button>
        <Button size="sm" onClick={() => handleAddItem("right")}>
          <IconPlus className="h-4 w-4 mr-1" />
          RPUSH
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {value.length} item(s)
      </p>
    </div>
  );
}
