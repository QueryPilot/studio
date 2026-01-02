import { useState, useEffect } from "react";
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
import { Input } from "@/components/ui/input";
import { IconCopy } from "@tabler/icons-react";

interface DuplicateTableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceTable: { schema: string; name: string };
  onConfirm: (options: {
    newName: string;
    includeData: boolean;
    includeIndexes: boolean;
    includeConstraints: boolean;
    includeTriggers: boolean;
  }) => void;
}

export function DuplicateTableDialog({
  open,
  onOpenChange,
  sourceTable,
  onConfirm,
}: DuplicateTableDialogProps) {
  const [newName, setNewName] = useState("");
  const [includeData, setIncludeData] = useState(true);
  const [includeIndexes, setIncludeIndexes] = useState(true);
  const [includeConstraints, setIncludeConstraints] = useState(true);
  const [includeTriggers, setIncludeTriggers] = useState(true);

  // Initialize with default name when dialog opens
  useEffect(() => {
    if (open) {
      setNewName(`${sourceTable.name}_copy`);
    }
  }, [open, sourceTable.name]);

  const handleConfirm = () => {
    if (!newName.trim()) return;
    
    onConfirm({
      newName: newName.trim(),
      includeData,
      includeIndexes,
      includeConstraints,
      includeTriggers,
    });
    onOpenChange(false);
  };

  const isValid = newName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconCopy className="h-5 w-5" />
            Duplicate table
          </DialogTitle>
          <DialogDescription>
            Create a copy of the table with the selected options.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Source table */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              Source table:
            </div>
            <div className="text-xs font-mono bg-muted p-2 rounded">
              {sourceTable.schema}.{sourceTable.name}
            </div>
          </div>

          {/* New table name */}
          <div className="space-y-2">
            <label htmlFor="new-table-name" className="text-xs font-medium">
              New table name
            </label>
            <Input
              id="new-table-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter new table name"
              className="text-xs font-mono"
              autoFocus
            />
          </div>

          {/* Options */}
          <div className="space-y-3">
            <div className="text-xs font-medium">Include</div>
            
            <label className="flex items-start gap-3 cursor-pointer group">
              <Checkbox
                checked={includeData}
                onCheckedChange={(checked) => setIncludeData(checked === true)}
              />
              <div className="flex-1 space-y-1">
                <div className="text-xs font-medium leading-none group-hover:text-foreground">
                  Data
                </div>
                <div className="text-xs text-muted-foreground leading-snug">
                  Copy all rows from the source table
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <Checkbox
                checked={includeIndexes}
                onCheckedChange={(checked) => setIncludeIndexes(checked === true)}
              />
              <div className="flex-1 space-y-1">
                <div className="text-xs font-medium leading-none group-hover:text-foreground">
                  Indexes
                </div>
                <div className="text-xs text-muted-foreground leading-snug">
                  Copy all indexes (including unique indexes)
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <Checkbox
                checked={includeConstraints}
                onCheckedChange={(checked) => setIncludeConstraints(checked === true)}
              />
              <div className="flex-1 space-y-1">
                <div className="text-xs font-medium leading-none group-hover:text-foreground">
                  Constraints
                </div>
                <div className="text-xs text-muted-foreground leading-snug">
                  Copy foreign keys, check constraints, and unique constraints
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <Checkbox
                checked={includeTriggers}
                onCheckedChange={(checked) => setIncludeTriggers(checked === true)}
              />
              <div className="flex-1 space-y-1">
                <div className="text-xs font-medium leading-none group-hover:text-foreground">
                  Triggers
                </div>
                <div className="text-xs text-muted-foreground leading-snug">
                  Copy all triggers attached to the table
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
            onClick={handleConfirm}
            disabled={!isValid}
          >
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

