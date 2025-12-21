import { memo, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { IconAlertTriangle, IconX, IconCheck } from "@tabler/icons-react";
import type { PasteValidationError } from "../utils/pasteUtils";

interface PasteValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errors: PasteValidationError[];
  /** Called when user chooses to apply valid cells only */
  onApplyValid: () => void;
  /** Called when user chooses to apply all including errors */
  onApplyAll: () => void;
  /** Called when user cancels the paste operation */
  onCancel: () => void;
  /** Total number of cells being pasted */
  totalCells?: number;
}

interface GroupedError {
  row: number;
  columns: Array<{ column: number; value: unknown; error: string }>;
}

export const PasteValidationDialog = memo(function PasteValidationDialog({
  open,
  onOpenChange,
  errors,
  onApplyValid,
  onApplyAll,
  onCancel,
  totalCells = 0,
}: PasteValidationDialogProps) {
  // Group errors by row for better display
  const groupedErrors = useMemo<GroupedError[]>(() => {
    const rowMap = new Map<number, GroupedError>();

    for (const error of errors) {
      let group = rowMap.get(error.row);
      if (!group) {
        group = { row: error.row, columns: [] };
        rowMap.set(error.row, group);
      }
      group.columns.push({
        column: error.column,
        value: error.value,
        error: error.error,
      });
    }

    return Array.from(rowMap.values()).sort((a, b) => a.row - b.row);
  }, [errors]);

  const validCellCount = totalCells - errors.length;
  const hasValidCells = validCellCount > 0;

  const handleCancel = () => {
    onCancel();
    onOpenChange(false);
  };

  const handleApplyValid = () => {
    onApplyValid();
    onOpenChange(false);
  };

  const handleApplyAll = () => {
    onApplyAll();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col p-4">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <IconAlertTriangle className="h-4 w-4 text-amber-500" />
            Paste Validation Errors
          </DialogTitle>
          <DialogDescription className="text-xs">
            {errors.length} validation{" "}
            {errors.length === 1 ? "error" : "errors"} found in pasted data.
          </DialogDescription>
        </DialogHeader>

        <Alert variant="default" className="bg-amber-500/10 border-amber-500/30">
          <IconAlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-xs font-medium">Type Mismatch</AlertTitle>
          <AlertDescription className="text-xs">
            Some pasted values don't match the expected column types.
          </AlertDescription>
        </Alert>

        <ScrollArea className="flex-1 -mx-4 px-4 min-h-[100px] max-h-[40vh]">
          <div className="space-y-2">
            {groupedErrors.map((group) => (
              <div
                key={group.row}
                className="rounded-lg border bg-card p-3"
              >
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  Row {group.row + 1}
                </div>
                <div className="space-y-1">
                  {group.columns.map((col, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-xs"
                    >
                      <span className="text-muted-foreground shrink-0">
                        Col {col.column + 1}:
                      </span>
                      <span className="font-mono text-destructive truncate max-w-[150px]">
                        {formatValue(col.value)}
                      </span>
                      <span className="text-muted-foreground">—</span>
                      <span className="text-destructive">{col.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="text-xs text-muted-foreground mt-2">
          {hasValidCells ? (
            <>
              <span className="text-green-600 font-medium">{validCellCount}</span> valid cells,{" "}
              <span className="text-destructive font-medium">{errors.length}</span> with errors
            </>
          ) : (
            <span className="text-destructive">All cells have validation errors</span>
          )}
        </div>

        <DialogFooter className="flex justify-end gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
          >
            <IconX className="h-3.5 w-3.5 mr-1.5" />
            Cancel
          </Button>
          {hasValidCells && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleApplyValid}
            >
              <IconCheck className="h-3.5 w-3.5 mr-1.5" />
              Apply Valid Only ({validCellCount})
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={handleApplyAll}
          >
            Apply All (Ignore Errors)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

function formatValue(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    if (value.length > 20) {
      return `"${value.slice(0, 17)}..."`;
    }
    return `"${value}"`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value).slice(0, 20);
  }
  return String(value);
}

export default PasteValidationDialog;
