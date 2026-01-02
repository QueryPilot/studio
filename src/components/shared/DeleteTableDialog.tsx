import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconAlertTriangle } from "@tabler/icons-react";

interface DeleteTableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: Array<{ type: string; schema: string; name: string }>;
  onConfirm: (options: { cascade: boolean }) => void;
}

export function DeleteTableDialog({
  open,
  onOpenChange,
  items,
  onConfirm,
}: DeleteTableDialogProps) {
  const [cascade, setCascade] = useState(false);

  const handleConfirm = () => {
    onConfirm({ cascade });
    onOpenChange(false);
  };

  const itemCount = items.length;
  const typeCounts = items.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const getTypeName = (type: string, count: number) => {
    const base = type === "table" ? "table" : type === "view" ? "view" : "function";
    return count > 1 ? `${base}s` : base;
  };

  const typeDescription = Object.entries(typeCounts)
    .map(([type, count]) => `${count} ${getTypeName(type, count)}`)
    .join(", ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconAlertTriangle className="h-5 w-5 text-destructive" />
            Delete {itemCount === 1 ? items[0]?.type : typeDescription}
          </DialogTitle>
          <DialogDescription>
            This will permanently delete the selected {itemCount === 1 ? "item" : "items"}.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Items list */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              {itemCount === 1 ? "Item:" : "Items:"}
            </div>
            <div className="text-xs font-mono bg-muted p-2 rounded max-h-32 overflow-y-auto">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-muted-foreground">({item.type})</span>
                  <span>{item.schema}.{item.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Options - only show for tables */}
          {items.some(item => item.type === "table") && (
            <div className="space-y-3">
              <div className="text-xs font-medium">Options</div>
              
              <label className="flex items-start gap-3 cursor-pointer group">
                <Checkbox
                  checked={cascade}
                  onCheckedChange={(checked) => setCascade(checked === true)}
                />
                <div className="flex-1 space-y-1">
                  <div className="text-xs font-medium leading-none group-hover:text-foreground">
                    Cascade
                  </div>
                  <div className="text-xs text-muted-foreground leading-snug">
                    Automatically drop objects that depend on the table (e.g., views, foreign keys)
                  </div>
                </div>
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

