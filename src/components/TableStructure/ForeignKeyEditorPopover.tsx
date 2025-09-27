import { memo, useState, useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { databaseService } from "@/services/databaseService";
import { ArrowRight, Edit2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ForeignKeyRef {
  table: string;
  column: string;
  onUpdate?: string;
  onDelete?: string;
}

interface ForeignKeyEditorPopoverProps {
  value?: ForeignKeyRef | null;
  onChange: (value: ForeignKeyRef | null) => void;
  connectionId?: string;
  database?: string;
  schema?: string;
  currentTable?: string;
  currentColumn?: string;
  columnName: string;
  disabled?: boolean;
}

interface TableColumn {
  table: string;
  column: string;
  type: string;
}

const CASCADE_OPTIONS = [
  { value: "NO ACTION", label: "NO ACTION" },
  { value: "CASCADE", label: "CASCADE" },
  { value: "SET NULL", label: "SET NULL" },
  { value: "SET DEFAULT", label: "SET DEFAULT" },
  { value: "RESTRICT", label: "RESTRICT" },
];

export const ForeignKeyEditorPopover = memo(function ForeignKeyEditorPopover({
  value,
  onChange,
  connectionId,
  database = "public",
  schema = "public",
  currentTable,
  columnName,
  disabled = false,
}: ForeignKeyEditorPopoverProps) {
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState<ForeignKeyRef>({
    table: value?.table || "",
    column: value?.column || "",
    onUpdate: value?.onUpdate?.toUpperCase() || "NO ACTION",
    onDelete: value?.onDelete?.toUpperCase() || "NO ACTION",
  });

  const [availableTables, setAvailableTables] = useState<string[]>([]);
  const [availableColumns, setAvailableColumns] = useState<TableColumn[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Reset local value when popover opens
  useEffect(() => {
    if (open) {
      setLocalValue({
        table: value?.table || "",
        column: value?.column || "",
        onUpdate: value?.onUpdate?.toUpperCase() || "NO ACTION",
        onDelete: value?.onDelete?.toUpperCase() || "NO ACTION",
      });
    }
  }, [open, value]);

  // Load available tables and columns
  useEffect(() => {
    if (connectionId && open && !isLoading) {
      setIsLoading(true);

      databaseService
        .getForeignKeyTargets(connectionId, database, schema)
        .then((targets) => {
          // Only use actual data from backend
          if (targets.length === 0) {
            setAvailableTables([]);
            setAvailableColumns([]);
            return;
          }

          // Get unique tables
          const tables = Array.from(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            new Set(targets.map((t) => t.table)),
          ).filter((t) => t !== currentTable);
          setAvailableTables(tables);

          // Store all columns for later filtering
          setAvailableColumns(targets);
        })
        .catch((err: unknown) => {
          console.error("Failed to load foreign key targets:", err);
          setAvailableTables([]);
          setAvailableColumns([]);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [connectionId, open, currentTable, isLoading, database, schema]);

  const getColumnsForTable = (tableName: string) => {
    return availableColumns
      .filter((col) => col.table === tableName)
      .map((col) => col.column);
  };

  const handleSave = () => {
    if (localValue.table && localValue.column) {
      onChange(localValue);
    } else {
      onChange(null);
    }
    setOpen(false);
  };

  const handleDelete = () => {
    onChange(null);
    setOpen(false);
  };

  const triggerContent = value ? (
    <span className="truncate text-ellipsis">
      {value.table}.{value.column}
    </span>
  ) : (
    <span>-</span>
  );

  return (
    <div className="flex items-center justify-between w-full">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className={cn(
              "justify-start text-xs font-mono px-2 h-7 flex-1",
              "hover:bg-transparent focus:bg-transparent",
              disabled && "opacity-60 cursor-not-allowed",
              !value && "text-muted-foreground",
            )}
          >
            {triggerContent}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[320px] p-2"
          align="start"
          sideOffset={8}
          alignOffset={-100}
        >
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-foreground/80 pb-1">
              Foreign Key Configuration
            </h4>

            {/* Source Column (Read-only) */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right text-xs text-muted-foreground">
                Column
              </Label>
              <Input
                value={columnName}
                disabled
                className="col-span-2 h-7 text-xs bg-muted font-mono"
              />
            </div>

            {/* Referenced Table */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right text-xs text-muted-foreground">
                Ref. Table
              </Label>
              <Select
                key="table-select"
                value={localValue.table}
                onValueChange={(val) => {
                  setLocalValue((prev) => ({
                    ...prev,
                    table: val,
                    column: "",
                  }));
                }}
              >
                <SelectTrigger className="col-span-2 !h-7 !text-xs font-mono w-full">
                  <SelectValue placeholder="Select table" />
                </SelectTrigger>
                <SelectContent className="w-full max-w-[280px]">
                  {availableTables.map((table) => (
                    <SelectItem key={table} value={table} className="!text-xs">
                      {table}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Referenced Column */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right text-xs text-muted-foreground">
                Ref. Column
              </Label>
              <Select
                key="column-select"
                value={localValue.column}
                onValueChange={(val) => {
                  setLocalValue((prev) => ({ ...prev, column: val }));
                }}
                disabled={!localValue.table}
              >
                <SelectTrigger className="col-span-2 !h-7 !text-xs font-mono w-full">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent className="w-full max-w-[280px]">
                  {localValue.table &&
                    getColumnsForTable(localValue.table).map((column) => (
                      <SelectItem
                        key={column}
                        value={column}
                        className="!text-xs"
                      >
                        {column}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* On Update Action */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right text-xs text-muted-foreground">
                On Update
              </Label>
              <Select
                key="onUpdate-select"
                value={localValue.onUpdate?.toUpperCase() || "NO ACTION"}
                onValueChange={(val) => {
                  setLocalValue((prev) => ({ ...prev, onUpdate: val }));
                }}
              >
                <SelectTrigger className="col-span-2 !h-7 !text-xs w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="w-full max-w-[280px]">
                  {CASCADE_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="!text-xs"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* On Delete Action */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right text-xs text-muted-foreground">
                On Delete
              </Label>
              <Select
                key="onDelete-select"
                value={localValue.onDelete?.toUpperCase() || "NO ACTION"}
                onValueChange={(val) => {
                  setLocalValue((prev) => ({
                    ...prev,
                    onDelete: val,
                  }));
                }}
              >
                <SelectTrigger className="col-span-2 !h-7 !text-xs w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="w-full max-w-[280px]">
                  {CASCADE_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="!text-xs"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-0.5">
              <div className="flex-1">
                {value && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    className="h-7 text-xs"
                  >
                    Delete
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                  }}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} className="h-7 text-xs">
                  OK
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        size="icon"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
        className="h-4 w-4 !p-1.5 hover:bg-muted mr-2 relative"
      >
        {!disabled && (
          <Edit2 className="!h-3.5 !w-3.5 group-hover:opacity-100 opacity-0 absolute left-1/2 -translate-x-1/2" />
        )}
        {value && (
          <ArrowRight className="!h-3.5 !w-3.5 group-hover:opacity-0 opacity-100 absolute left-1/2 -translate-x-1/2" />
        )}
      </Button>
    </div>
  );
});
