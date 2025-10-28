import React, { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type BooleanCustomCell } from "./types";

interface BooleanCellEditorProps {
  value: BooleanCustomCell;
  onFinishedEditing: (
    newValue?: BooleanCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const BooleanCellEditor: React.FC<BooleanCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value;
  const initialStringValue =
    initialValue == null ? "null" : initialValue.toString();

  const [open, setOpen] = useState(false);
  const finishedRef = useRef(false);

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

    let boolValue: boolean | null;
    switch (newValue) {
      case "true":
        boolValue = true;
        break;
      case "false":
        boolValue = false;
        break;
      default:
        boolValue = null;
    }

    const newCell: BooleanCustomCell = {
      kind: value.kind,
      data: {
        ...value.data,
        value: boolValue,
      },
      copyData: boolValue === null ? "NULL" : String(boolValue),
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

  return (
    <div
      className="w-full h-full flex items-center click-outside-ignore"
      onKeyDown={handleKeyDown}
    >
      <Select
        value={initialStringValue}
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
        <SelectContent className="min-w-[100px] click-outside-ignore z-50">
          <SelectItem value="null" className="text-xs ring-0 outline-none">
            <span className="text-muted-foreground">NULL</span>
          </SelectItem>
          <SelectItem value="true" className="text-xs ring-0 outline-none">
            <span className="text-green-600 dark:text-green-400 font-medium">
              TRUE
            </span>
          </SelectItem>
          <SelectItem value="false" className="text-xs ring-0 outline-none">
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
