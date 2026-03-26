import { useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface DuckDbScratchpadOption {
  id: string;
  name: string;
  path: string;
}

interface SnapshotToDuckDbDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scratchpads: DuckDbScratchpadOption[];
  defaultTargetName: string;
  sourceLabel: string;
  isSubmitting?: boolean;
  onConfirm: (targetConnectionId: string, targetName: string) => Promise<void> | void;
}

export function SnapshotToDuckDbDialog({
  open,
  onOpenChange,
  scratchpads,
  defaultTargetName,
  sourceLabel,
  isSubmitting = false,
  onConfirm,
}: SnapshotToDuckDbDialogProps) {
  const firstScratchpadId = scratchpads[0]?.id ?? "";
  const [targetConnectionId, setTargetConnectionId] = useState<string | null>(
    firstScratchpadId || null,
  );
  const [targetName, setTargetName] = useState(defaultTargetName);

  const selectedScratchpad = useMemo(
    () => scratchpads.find((scratchpad) => scratchpad.id === targetConnectionId) ?? null,
    [scratchpads, targetConnectionId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Snapshot to DuckDB</DialogTitle>
          <DialogDescription>
            Materialize {sourceLabel} into a DuckDB scratchpad as a refreshable
            managed table.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="duckdb-scratchpad-target">Scratchpad</Label>
            <Select
              value={targetConnectionId ?? ""}
              onValueChange={(value) => {
                setTargetConnectionId(value);
              }}
            >
              <SelectTrigger id="duckdb-scratchpad-target" className="w-full">
                <SelectValue placeholder="Select a scratchpad" />
              </SelectTrigger>
              <SelectContent>
                {scratchpads.map((scratchpad) => (
                  <SelectItem key={scratchpad.id} value={scratchpad.id}>
                    {scratchpad.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedScratchpad && (
              <p className="text-[11px] text-muted-foreground font-mono truncate">
                {selectedScratchpad.path}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="duckdb-target-object-name">Target table</Label>
            <Input
              id="duckdb-target-object-name"
              value={targetName}
              onChange={(event) => {
                setTargetName(event.target.value);
              }}
              placeholder="snapshot_table"
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
            onClick={() => {
              if (!targetConnectionId) return;
              void onConfirm(targetConnectionId, targetName);
            }}
            disabled={isSubmitting || !targetConnectionId || !targetName.trim()}
          >
            {isSubmitting ? "Snapshotting..." : "Create Snapshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
