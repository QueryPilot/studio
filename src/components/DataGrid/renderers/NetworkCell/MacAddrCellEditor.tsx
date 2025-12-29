import React, {
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { IconTrash, IconKey } from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import type { MacAddrCustomCell } from "./types";
import { isValidMacAddr, autoFormatMacInput, formatMacAddr } from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";

interface MacAddrCellEditorProps {
  value: MacAddrCustomCell;
  onFinishedEditing: (
    newValue?: MacAddrCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const MacAddrCellEditor: React.FC<MacAddrCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = useMemo(
    () => formatMacAddr(value.data.value ?? ""),
    [value.data.value],
  );

  const [macValue, setMacValue] = useState(initialValue);
  const [isValid, setIsValid] = useState(() => {
    if (!initialValue) return true;
    return isValidMacAddr(initialValue);
  });
  const deferredIsValid = useDeferredValue(isValid);

  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousValueRef = useRef(initialValue);

  const nullable = Boolean(value.data.nullable);
  const { columnName, isPrimaryKey, dbType } = value.data;

  // Detect if this is MACADDR8 (8 octets)
  const isMacAddr8 = dbType?.toLowerCase().includes("macaddr8");
  const expectedLength = isMacAddr8 ? 23 : 17; // XX:XX:XX:XX:XX:XX:XX:XX or XX:XX:XX:XX:XX:XX

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const copyData = nextValue == null ? "NULL" : nextValue;

      const newCell: MacAddrCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextValue,
        },
        copyData,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const commitCurrentValue = useCallback(() => {
    const currentValue = macValue.trim() || null;
    const hasChanged = currentValue !== initialValue;

    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    if (currentValue && !isValidMacAddr(currentValue)) {
      // Don't commit invalid values
      return;
    }

    commit(currentValue);
  }, [commit, macValue, initialValue, onFinishedEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (finishedRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        onFinishedEditing(undefined);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commitCurrentValue();
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
          ? [-1, 0]
          : [1, 0];
        finishedRef.current = true;

        const currentValue = macValue.trim() || null;
        if (currentValue && !isValidMacAddr(currentValue)) {
          onFinishedEditing(undefined, movement);
          return;
        }

        const newCell: MacAddrCustomCell = {
          kind: value.kind,
          data: {
            ...value.data,
            value: currentValue,
          },
          copyData: currentValue == null ? "NULL" : currentValue,
          allowOverlay: value.allowOverlay,
          readonly: value.readonly,
        };

        onFinishedEditing(newCell, movement);
      }
    },
    [commitCurrentValue, onFinishedEditing, value, macValue],
  );

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const formatted = autoFormatMacInput(rawValue, previousValueRef.current);
    previousValueRef.current = formatted;
    setMacValue(formatted);

    // Update the input value to the formatted version
    if (inputRef.current) {
      inputRef.current.value = formatted;
    }

    // Validate
    setIsValid(formatted === "" || isValidMacAddr(formatted));
  };

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50 min-w-[220px]">
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

      {/* Input field */}
      <div className="flex items-center gap-2 flex-1 relative px-2 py-1.5">
        <input
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          ref={inputRef}
          className={cn(
            "h-full flex-1 bg-transparent text-xs font-mono outline-none uppercase",
            !deferredIsValid
              ? "border-b border-destructive focus:border-destructive"
              : "",
          )}
          defaultValue={initialValue}
          autoFocus
          onFocus={(e) => {
            e.target.select();
          }}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isMacAddr8 ? "00:00:00:00:00:00:00:00" : "00:00:00:00:00:00"
          }
          maxLength={expectedLength}
          aria-invalid={!deferredIsValid}
        />

        {nullable && (
          <Button
            variant="ghost"
            className="h-5 w-5 p-0"
            title="Clear (NULL)"
            onClick={handleClear}
          >
            <IconTrash className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Validation hint */}
      {!deferredIsValid && (
        <div className="px-2 pb-1 text-[10px] text-destructive leading-tight">
          Invalid MAC address format
        </div>
      )}

      {/* Format hint */}
      <div className="px-2 pb-1 text-[10px] text-muted-foreground leading-tight">
        {isMacAddr8
          ? "Format: XX:XX:XX:XX:XX:XX:XX:XX (8 octets)"
          : "Format: XX:XX:XX:XX:XX:XX (6 octets)"}
      </div>
    </div>
  );
};

export const MacAddrCellEditorWithProps = Object.assign(MacAddrCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
