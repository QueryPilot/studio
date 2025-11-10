import React, { useState, useRef, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Key } from "lucide-react";
import type { EnumCustomCell } from "./types";
import { cn } from "@/lib/cn";

interface EnumCellEditorProps {
  value: EnumCustomCell;
  onFinishedEditing: (
    newValue?: EnumCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const EnumCellEditor: React.FC<EnumCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value;
  const allowedValues = value.data.allowedValues;

  // Add NULL as an option only if the column is nullable (propagated via cell data)
  const isNullable = (value.data as { nullable?: boolean }).nullable ?? true;
  const options = isNullable ? ["NULL", ...allowedValues] : [...allowedValues];

  const [open, setOpen] = useState(false);
  const finishedRef = useRef(false);

  // Extract column metadata for header
  const { columnName, isPrimaryKey, dbType } = value.data;

  // Auto-open the dropdown when editor mounts (double-click activated)
  useEffect(() => {
    const timer = setTimeout(() => {
      setOpen(true);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const handleValueChange = async (newValue: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    // Convert "NULL" string back to actual null
    const enumValue = newValue === "NULL" ? null : newValue;

    const newCell: EnumCustomCell = {
      kind: value.kind,
      data: {
        ...value.data,
        value: enumValue,
      },
      copyData: enumValue ?? "NULL",
      allowOverlay: value.allowOverlay,
      readonly: value.readonly,
    };

    // Close the dropdown
    setOpen(false);

    // Wait for next frame before finishing
    await new Promise((r) => window.requestAnimationFrame(r));
    onFinishedEditing(newCell);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);

    // If user closes the dropdown without selecting, cancel the edit
    if (!isOpen && !finishedRef.current) {
      setTimeout(() => {
        if (!finishedRef.current) {
          finishedRef.current = true;
          onFinishedEditing(value);
        }
      }, 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (finishedRef.current) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      setOpen(false);
      onFinishedEditing(undefined);
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      setOpen(false);
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      onFinishedEditing(value, movement);
    }
  };

  const currentValue = initialValue ?? "NULL";

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        {isPrimaryKey && (
          <Key className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
        )}
        <span className="text-[10px] font-medium text-foreground/80">
          {columnName}
        </span>
        {dbType && (
          <span className="text-[9px] text-muted-foreground ml-auto">
            {dbType}
          </span>
        )}
      </div>

      {/* Select dropdown */}
      <div
        className="flex items-center flex-1 px-2"
        onKeyDown={handleKeyDown}
      >
        <Select
          value={currentValue}
          onValueChange={handleValueChange}
          open={open}
          onOpenChange={handleOpenChange}
        >
          <SelectTrigger
            size="sm"
            className="!text-xs border-0 focus:ring-0 focus:ring-offset-0 bg-transparent w-full shadow-none"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[300px] click-outside-ignore z-50">
            {options.map((option) => (
              <SelectItem
                key={option}
                value={option}
                className={cn(
                  option === "NULL" ? "text-muted-foreground" : "",
                  "text-xs outline-none ring-0",
                )}
              >
                {option === "NULL" ? (
                  <span className="text-muted-foreground">NULL</span>
                ) : (
                  <span>{option}</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

// Extend the component with static properties
export const EnumCellEditorWithProps = Object.assign(EnumCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
