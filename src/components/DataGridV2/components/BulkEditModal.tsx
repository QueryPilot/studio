import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { GridColumnV2, GridRowModel } from "../types";
import type { JsonValue } from "@/types/crud";

interface BulkEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRows: GridRowModel[];
  columns: GridColumnV2[];
  onBulkEdit: (column: string, newValue: JsonValue, rows: GridRowModel[]) => void;
}

export function BulkEditModal({
  open,
  onOpenChange,
  selectedRows,
  columns,
  onBulkEdit,
}: BulkEditModalProps) {
  const [selectedColumn, setSelectedColumn] = useState<string>("");
  const [newValue, setNewValue] = useState<string>("");

  // Filter out non-editable columns (e.g., primary keys, generated columns)
  const editableColumns = useMemo(() => {
    return columns.filter((col) => {
      // Skip primary key columns
      if (col.meta?.is_pk) return false;
      // Skip generated/computed columns (if we add this metadata later)
      return true;
    });
  }, [columns]);

  const selectedColumnMeta = useMemo(() => {
    return columns.find((col) => col.field === selectedColumn);
  }, [columns, selectedColumn]);

  const handleApply = () => {
    if (!selectedColumn) {
      toast.error("Please select a column");
      return;
    }

    if (selectedRows.length === 0) {
      toast.error("No rows selected");
      return;
    }

    // Convert the string value to the appropriate type
    let typedValue: JsonValue = newValue;

    // Type conversion based on column metadata
    const columnDbType = selectedColumnMeta?.meta?.db_type?.toLowerCase() || "";

    if (newValue === "" || newValue === "null") {
      typedValue = null;
    } else if (columnDbType.includes("bool")) {
      typedValue = newValue.toLowerCase() === "true" || newValue === "1";
    } else if (
      columnDbType.includes("int") ||
      columnDbType.includes("numeric") ||
      columnDbType.includes("decimal") ||
      columnDbType.includes("float") ||
      columnDbType.includes("double") ||
      columnDbType.includes("real")
    ) {
      const numValue = Number(newValue);
      if (isNaN(numValue)) {
        toast.error("Invalid number format");
        return;
      }
      typedValue = numValue;
    }

    // Call the bulk edit handler
    onBulkEdit(selectedColumn, typedValue, selectedRows);

    toast.success("Bulk edit applied", {
      description: `Updated ${selectedRows.length} rows`,
    });

    // Reset and close
    setSelectedColumn("");
    setNewValue("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Bulk Edit</DialogTitle>
          <DialogDescription>
            Update the same column value across {selectedRows.length} selected row
            {selectedRows.length === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="column">Column</Label>
            <Select value={selectedColumn} onValueChange={setSelectedColumn}>
              <SelectTrigger id="column">
                <SelectValue placeholder="Select a column to edit" />
              </SelectTrigger>
              <SelectContent>
                {editableColumns.map((col) => (
                  <SelectItem key={col.field} value={col.field}>
                    {col.title} ({col.meta?.db_type || "unknown"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="value">New Value</Label>
            <Input
              id="value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={
                selectedColumnMeta?.meta?.nullable
                  ? "Enter value (or 'null' for NULL)"
                  : "Enter value"
              }
              disabled={!selectedColumn}
            />
            {selectedColumnMeta && (
              <p className="text-xs text-muted-foreground">
                Type: {selectedColumnMeta.meta?.db_type}
                {selectedColumnMeta.meta?.precision &&
                  ` (${selectedColumnMeta.meta.precision}${
                    selectedColumnMeta.meta.scale
                      ? `,${selectedColumnMeta.meta.scale}`
                      : ""
                  })`}
                {selectedColumnMeta.meta?.nullable && " • Nullable"}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply}>
            Apply to {selectedRows.length} row{selectedRows.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
