import React, { useCallback, useEffect, useRef, useState } from "react";
import { GridCellKind, type CustomCell } from "@glideapps/glide-data-grid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BooleanCustomCell } from "./BooleanCellRenderer";

interface BooleanCellEditorProps {
  value: BooleanCustomCell;
  onChange: (newValue: BooleanCustomCell) => void;
  onFinishedEditing: (
    newValue?: BooleanCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
  isHighlighted: boolean;
}

export const BooleanCellEditor: React.FC<BooleanCellEditorProps> = ({
  value,
  onChange,
  onFinishedEditing,
  isHighlighted,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLButtonElement>(null);
  const hasOpenedRef = useRef(false);

  // Extract the actual boolean value from our custom cell
  const booleanValue = value.data.value;

  // Convert boolean data to string for select component
  const currentValue = booleanValue == null ? "null" : booleanValue.toString();

  useEffect(() => {
    // Auto-focus and open dropdown when editor mounts (only once)
    if (!hasOpenedRef.current && selectRef.current && isHighlighted) {
      hasOpenedRef.current = true;
      selectRef.current.focus();
      // Delay opening to avoid conflicts with React's render cycle
      setTimeout(() => {
        setIsOpen(true);
        selectRef.current?.click();
      }, 50);
    }
  }, [isHighlighted]);

  const handleValueChange = useCallback(
    (newValue: string) => {
      let boolValue: boolean | null;

      switch (newValue) {
        case "true":
          boolValue = true;
          break;
        case "false":
          boolValue = false;
          break;
        case "null":
        default:
          boolValue = null;
          break;
      }

      // Create the custom cell with the new value
      const newCell: BooleanCustomCell = {
        kind: GridCellKind.Custom,
        data: {
          kind: "boolean-cell",
          value: boolValue,
        },
        copyData: boolValue == null ? "NULL" : String(boolValue),
        readonly: false,
      };

      onChange(newCell);
      // onFinishedEditing will handle closing the editor
      onFinishedEditing(newCell, [0, 0]);
    },
    [onChange, onFinishedEditing],
  );

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    // Don't call onFinishedEditing here - it's already handled in handleValueChange
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onFinishedEditing(undefined, [0, 0]); // Cancel edit
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      onFinishedEditing(value, movement);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onFinishedEditing(value, [0, 1]);
    }
  };

  return (
    <div
      className="flex items-center justify-center w-full h-full bg-transparent"
      onKeyDown={handleKeyDown}
    >
      <Select
        value={currentValue}
        onValueChange={handleValueChange}
        open={isOpen}
        onOpenChange={handleOpenChange}
      >
        <SelectTrigger
          ref={selectRef}
          className="h-6 text-xs border-0 focus:ring-0 focus:ring-offset-0 bg-transparent w-full"
          style={{
            boxShadow: "none",
          }}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="min-w-[100px]" align="start" sideOffset={2}>
          <SelectItem value="null" className="text-xs">
            <span className="text-muted-foreground italic">NULL</span>
          </SelectItem>
          <SelectItem value="true" className="text-xs">
            <span className="text-green-600 dark:text-green-400 font-medium">
              TRUE
            </span>
          </SelectItem>
          <SelectItem value="false" className="text-xs">
            <span className="text-red-600 dark:text-red-400 font-medium">
              FALSE
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};

// Extend the component with static properties
export const BooleanCellEditorWithProps = Object.assign(BooleanCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
