import React, { useState, useRef, useEffect, useCallback } from "react";
import { v1 as uuidv1, v4 as uuidv4 } from "uuid";
import type { UuidCustomCell } from "./UuidCellRenderer";
import { isValidUuid } from "./UuidCellRenderer";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { XIcon, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/cn";

interface UuidCellEditorProps {
  value: UuidCustomCell;
  onFinishedEditing: (
    newValue?: UuidCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const UuidCellEditor: React.FC<UuidCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value || "";
  const [text, setText] = useState<string>(initialValue);
  const [uuidVersion, setUuidVersion] = useState<string>("4");
  const [isValid, setIsValid] = useState<boolean>(
    !initialValue || isValidUuid(initialValue),
  );
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;
    setText(newText);
    setIsValid(!newText || isValidUuid(newText));
  };

  const generateUuid = () => {
    let newUuid: string;
    switch (uuidVersion) {
      case "1":
        newUuid = uuidv1();
        break;
      case "4":
      default:
        newUuid = uuidv4();
        break;
      // v3 and v5 require namespace and name parameters, so we'll just use v4 for now
      // Can be extended if needed
    }
    setText(newUuid);
    setIsValid(true);
  };

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const newCell: UuidCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextValue,
          isValid: nextValue ? isValidUuid(nextValue) : true,
        },
        copyData: nextValue ?? "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (finishedRef.current) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      onFinishedEditing(undefined);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const trimmed = text.trim();
      if (!trimmed && value.data.nullable) {
        commit(null);
      } else if (isValid) {
        commit(trimmed);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      finishedRef.current = true;
      onFinishedEditing(value, movement);
    }
  };

  const handleClear = () => {
    if (value.data.nullable) {
      commit(null);
    }
  };

  return (
    <div className="w-full h-full flex items-center gap-1 px-2 click-outside-ignore">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex-1 h-full bg-transparent text-xs font-mono outline-none",
          !isValid ? "text-destructive" : "",
          !value.data.value ? "italic text-muted-foreground" : "",
        )}
        placeholder={
          value.data.nullable ? "NULL" : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        }
      />
      <div className="flex items-center gap-0">
        {value.data.nullable && (
          <Button
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={handleClear}
            title="Clear (NULL)"
          >
            <XIcon className="h-3 w-3" />
          </Button>
        )}
        <Select value={uuidVersion} onValueChange={setUuidVersion}>
          <SelectTrigger className="h-6 w-12 text-[10px] border-0 shadow-none px-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="min-w-[80px] click-outside-ignore z-50">
            <SelectItem value="1" className="text-xs">
              v1
            </SelectItem>
            <SelectItem value="4" className="text-xs">
              v4
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={generateUuid}
          title={`Generate UUID v${uuidVersion}`}
        >
          <RefreshCcw className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};

export const UuidCellEditorWithProps = Object.assign(UuidCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
