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
  console.log("🔵 BooleanCellEditor instantiated:", { value, isHighlighted });

  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState(() => {
    const booleanValue = value.data.value;
    return booleanValue == null ? "null" : booleanValue.toString();
  });

  const selectRef = useRef<HTMLButtonElement>(null);
  const hasOpenedRef = useRef(false);
  const isFinishedRef = useRef(false);

  console.log("🔵 BooleanCellEditor setup:", {
    booleanValue: value.data.value,
    selectedValue
  });

  useEffect(() => {
    // Auto-focus and open dropdown when editor mounts (only once)
    if (!hasOpenedRef.current && selectRef.current && isHighlighted) {
      console.log("🔵 Auto-opening boolean dropdown");
      hasOpenedRef.current = true;
      selectRef.current.focus();
      // Delay opening to avoid conflicts with React's render cycle
      setTimeout(() => {
        if (!isFinishedRef.current) {
          console.log("🔵 Attempting to trigger dropdown by clicking trigger");
          selectRef.current?.click();
        }
      }, 50);
    }
  }, [isHighlighted]);

  const handleValueChange = useCallback(
    (newValue: string) => {
      console.log("🔵 Boolean cell editor value changed:", { newValue });

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
        copyData: boolValue === null ? "NULL" : String(boolValue),
        readonly: false,
        allowOverlay: true,
      };

      console.log("🔵 Boolean cell editor finishing with:", {
        newValue,
        boolValue,
        newCell,
      });

      // Mark as finished to prevent further actions
      isFinishedRef.current = true;

      // Update local state for immediate feedback
      setSelectedValue(newValue);

      // Close dropdown and finish editing
      setIsOpen(false);

      // Call onFinishedEditing to commit the change immediately
      onFinishedEditing(newCell, [0, 0]);
    },
    [onFinishedEditing],
  );

  const handleOpenChange = useCallback((open: boolean) => {
    console.log("🔵 Boolean dropdown open state changed:", { open, isFinished: isFinishedRef.current });

    if (isFinishedRef.current) return;

    setIsOpen(open);

    // If dropdown closes without a value selection, cancel the edit
    // But only if it wasn't closed by a value selection
    if (!open && !isFinishedRef.current) {
      console.log("🔵 Boolean dropdown closed without selection, canceling edit");
      isFinishedRef.current = true;
      onFinishedEditing(undefined, [0, 0]);
    }
  }, [onFinishedEditing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isFinishedRef.current) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      isFinishedRef.current = true;
      onFinishedEditing(undefined, [0, 0]); // Cancel edit
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      isFinishedRef.current = true;
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      onFinishedEditing(value, movement);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      isFinishedRef.current = true;
      onFinishedEditing(value, [0, 1]);
    }
  }, [onFinishedEditing, value]);

  // Prevent further actions once finished
  if (isFinishedRef.current) {
    return null;
  }

  return (
    <div
      className="flex items-center justify-center w-full h-full bg-transparent"
      onKeyDown={handleKeyDown}
    >
      <Select
        value={selectedValue}
        onValueChange={handleValueChange}
        onOpenChange={handleOpenChange}
        open={isOpen}
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