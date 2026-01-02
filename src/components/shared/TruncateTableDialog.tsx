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

interface TruncateTableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tables: Array<{ schema: string; name: string }>;
  onConfirm: (options: { restartIdentity: boolean; cascade: boolean }) => void;
}

export function TruncateTableDialog({
  open,
  onOpenChange,
  tables,
  onConfirm,
}: TruncateTableDialogProps) {
  const [restartIdentity, setRestartIdentity] = useState(true);
  const [cascade, setCascade] = useState(false);

  const handleConfirm = () => {
    onConfirm({ restartIdentity, cascade });
    onOpenChange(false);
  };

  const tableCount = tables.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconAlertTriangle className="h-5 w-5 text-destructive" />
            Truncate {tableCount === 1 ? "table" : `${tableCount} tables`}
          </DialogTitle>
          <DialogDescription>
            This will remove all rows from the selected {tableCount === 1 ? "table" : "tables"}.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Table list */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              {tableCount === 1 ? "Table:" : "Tables:"}
            </div>
            <div className="text-xs font-mono bg-muted p-2 rounded max-h-32 overflow-y-auto">
              {tables.map((t, idx) => (
                <div key={idx}>{t.schema}.{t.name}</div>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <div className="text-xs font-medium">Options</div>
            
            <label className="flex items-start gap-3 cursor-pointer group">
              <Checkbox
                checked={restartIdentity}
                onCheckedChange={(checked) => setRestartIdentity(checked === true)}
              />
              <div className="flex-1 space-y-1">
                <div className="text-xs font-medium leading-none group-hover:text-foreground">
                  Restart identity
                </div>
                <div className="text-xs text-muted-foreground leading-snug">
                  Reset auto-increment sequences to their starting value
                </div>
              </div>
            </label>

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
                  Automatically truncate tables with foreign key references to this table
                </div>
              </div>
            </label>
          </div>
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
            Truncate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

