import React, { useState, useRef, useCallback } from "react";
import {
  v1 as uuidv1,
  v3 as uuidv3,
  v4 as uuidv4,
  v5 as uuidv5,
  v7 as uuidv7,
} from "uuid";
import type { UuidCustomCell } from "./types";
import { isValidUuid } from "./utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconX, IconRefresh, IconKey } from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

interface UuidCellEditorProps {
  value: UuidCustomCell;
  onFinishedEditing: (
    newValue?: UuidCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

type UuidVersion = "1" | "3" | "4" | "5" | "7";

interface UuidVersionOption {
  value: UuidVersion;
  label: string;
}

const UUID_VERSIONS: UuidVersionOption[] = [
  { value: "4", label: "v4" },
  { value: "5", label: "v5" },
  { value: "7", label: "v7" },
  { value: "3", label: "v3" },
  { value: "1", label: "v1" },
];

export const UuidCellEditor: React.FC<UuidCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = value.data.value || "";
  const [selectedVersion, setSelectedVersion] = useState<UuidVersion>("4");
  const [isValid, setIsValid] = useState<boolean>(
    !initialValue || isValidUuid(initialValue),
  );
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const originalValueRef = useRef(value.data.value);

  // Extract column metadata for header
  const { columnName, isPrimaryKey, dbType } = value.data;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;
    originalValueRef.current = newText;
    setIsValid(!newText || isValidUuid(newText));
  };

  const generateUuid = (version?: UuidVersion) => {
    const versionToUse = version || selectedVersion;
    let newUuid: string;

    switch (versionToUse) {
      case "1":
        newUuid = uuidv1();
        break;
      case "3":
        // v3 requires namespace and name - using DNS namespace with timestamp-based name
        newUuid = uuidv3(`debdb-uuid-${Date.now()}`, uuidv3.DNS);
        break;
      case "7":
        newUuid = uuidv7();
        break;
      case "5":
        // v5 requires namespace and name - using DNS namespace with timestamp-based name
        newUuid = uuidv5(`debdb-uuid-${Date.now()}`, uuidv5.DNS);
        break;
      case "4":
      default:
        newUuid = uuidv4();
        break;
    }

    if (inputRef.current) {
      inputRef.current.value = newUuid;
    }
    originalValueRef.current = newUuid;
    setIsValid(true);
    setSelectedVersion(versionToUse);
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

  const commitCurrentText = useCallback(() => {
    // Use originalValueRef instead of inputRef to avoid reading null during unmount
    const text = originalValueRef.current ?? "";

    // Check if value actually changed (compare with original value)
    const hasChanged = text !== (value.data.value ?? "");

    // If no changes were made, cancel the edit
    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    // Commit the changed value
    const trimmed = text.trim();
    if (!trimmed && value.data.nullable) {
      commit(null);
    } else if (isValid) {
      commit(trimmed);
    }
  }, [
    commit,
    isValid,
    value.data.nullable,
    value.data.value,
    onFinishedEditing,
  ]);

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
      commitCurrentText();
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      finishedRef.current = true;

      // Commit the current text value before moving (use originalValueRef for consistency)
      const text = originalValueRef.current ?? "";
      const trimmed = text.trim();
      const committedValue: string | null =
        !trimmed && value.data.nullable ? null : isValid ? trimmed : null;

      const newCell: UuidCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: committedValue,
          isValid: committedValue ? isValidUuid(committedValue) : true,
        },
        copyData: committedValue ?? "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell, movement);
    }
  };

  const handleClear = () => {
    if (value.data.nullable) {
      commit(null);
    }
  };

  useCommitOnUnmount(finishedRef, commitCurrentText);

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        {isPrimaryKey && (
          <IconKey className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
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

      {/* UUID input and controls */}
      <div
        className={cn("flex-1 flex items-center gap-1 px-2", {
          "min-w-[330px]": value.data.nullable,
          "min-w-[310px]": !value.data.nullable,
        })}
      >
        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          ref={inputRef}
          type="text"
          defaultValue={initialValue}
          autoFocus
          onFocus={(e) => {
            e.target.select();
          }}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex-1 h-full bg-transparent text-xs font-mono outline-none",
            !isValid ? "text-destructive" : "",
            !value.data.value ? "italic text-muted-foreground" : "",
          )}
          placeholder={
            value.data.nullable
              ? "NULL"
              : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
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
              <IconX className="h-3 w-3" />
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="h-6 px-2 text-[11px] font-mono gap-1 hover:bg-muted"
                  title={`Generate UUID v${selectedVersion}`}
                >
                  <IconRefresh className="h-3 w-3" />
                </Button>
              }
            />
            <DropdownMenuContent
              className="w-auto click-outside-ignore z-50"
              align="end"
            >
              {UUID_VERSIONS.map((version) => (
                <DropdownMenuItem
                  key={version.value}
                  className="text-xs font-mono"
                  onClick={() => {
                    generateUuid(version.value);
                  }}
                >
                  Generate v{version.value}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
};

export const UuidCellEditorWithProps = Object.assign(UuidCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
