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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DuckDbAddFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string | null;
  defaultTargetName: string;
  isSubmitting?: boolean;
  onConfirm: (targetName: string) => Promise<void> | void;
}

export function DuckDbAddFileDialog({
  open,
  onOpenChange,
  filePath,
  defaultTargetName,
  isSubmitting = false,
  onConfirm,
}: DuckDbAddFileDialogProps) {
  const [targetName, setTargetName] = useState(defaultTargetName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add File to Scratchpad</DialogTitle>
          <DialogDescription>
            Import the selected file into the DuckDB scratchpad as a managed
            table.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="duckdb-file-path">Selected file</Label>
            <Input
              id="duckdb-file-path"
              value={filePath ?? ""}
              readOnly
              className="font-mono text-[11px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="duckdb-target-name">Target table</Label>
            <Input
              id="duckdb-target-name"
              value={targetName}
              onChange={(event) => {
                setTargetName(event.target.value);
              }}
              placeholder="imported_data"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void onConfirm(targetName)}
            disabled={isSubmitting || !filePath || !targetName.trim()}
          >
            {isSubmitting ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
