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
import type { InetCustomCell } from "./types";
import { isValidInet, parseCidr, getIpVersion } from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface InetCellEditorProps {
  value: InetCustomCell;
  onFinishedEditing: (
    newValue?: InetCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const InetCellEditor: React.FC<InetCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = useMemo(
    () => value.data.value ?? "",
    [value.data.value],
  );
  const parsed = useMemo(() => parseCidr(initialValue), [initialValue]);

  const [ipValue, setIpValue] = useState(parsed.ip);
  const [prefix, setPrefix] = useState<number | null>(parsed.prefix);
  const [isValid, setIsValid] = useState(() => {
    if (!initialValue) return true;
    return isValidInet(initialValue);
  });
  const deferredIsValid = useDeferredValue(isValid);

  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const nullable = Boolean(value.data.nullable);
  const isCidr = value.data.kind === "cidr-cell";
  const { columnName, isPrimaryKey, dbType } = value.data;

  // Determine max prefix based on IP version
  const maxPrefix = useMemo(() => {
    const version = getIpVersion(ipValue);
    return version === 4 ? 32 : 128;
  }, [ipValue]);

  // Generate prefix options
  const prefixOptions = useMemo(() => {
    const options: number[] = [];
    for (let i = 0; i <= maxPrefix; i++) {
      options.push(i);
    }
    return options;
  }, [maxPrefix]);

  const getCurrentValue = useCallback(() => {
    if (!ipValue.trim()) return null;
    if (prefix !== null && isCidr) {
      return `${ipValue.trim()}/${prefix}`;
    }
    return ipValue.trim();
  }, [ipValue, prefix, isCidr]);

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const copyData = nextValue == null ? "NULL" : nextValue;

      const newCell: InetCustomCell = {
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
    const currentValue = getCurrentValue();
    const hasChanged = currentValue !== initialValue;

    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    if (currentValue && !isValidInet(currentValue)) {
      // Don't commit invalid values - stay in editor
      return;
    }

    commit(currentValue);
  }, [commit, getCurrentValue, initialValue, onFinishedEditing]);

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

        const currentValue = getCurrentValue();
        if (currentValue && !isValidInet(currentValue)) {
          onFinishedEditing(undefined, movement);
          return;
        }

        const newCell: InetCustomCell = {
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
    [commitCurrentValue, onFinishedEditing, value, getCurrentValue],
  );

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  const handleIpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setIpValue(newValue);

    // Validate the full address
    const fullValue =
      prefix !== null && isCidr ? `${newValue}/${prefix}` : newValue;
    setIsValid(newValue.trim() === "" || isValidInet(fullValue));
  };

  const handlePrefixChange = (newPrefix: string) => {
    const prefixNum = newPrefix === "none" ? null : parseInt(newPrefix, 10);
    setPrefix(prefixNum);

    // Validate with new prefix
    const fullValue = prefixNum !== null ? `${ipValue}/${prefixNum}` : ipValue;
    setIsValid(ipValue.trim() === "" || isValidInet(fullValue));
  };

  return (
    <div className="w-full h-full flex flex-col relative click-outside-ignore z-50 min-w-[280px]">
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
            "h-full flex-1 bg-transparent text-xs font-mono outline-none",
            !deferredIsValid
              ? "border-b border-destructive focus:border-destructive"
              : "",
          )}
          defaultValue={ipValue}
          autoFocus
          onFocus={(e) => {
            e.target.select();
          }}
          onChange={handleIpChange}
          onKeyDown={handleKeyDown}
          placeholder={isCidr ? "192.168.1.0" : "192.168.1.1"}
          aria-invalid={!deferredIsValid}
        />

        {/* CIDR prefix selector */}
        {isCidr && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">/</span>
            <Select
              value={prefix?.toString() ?? "none"}
              onValueChange={(value) => {
                if (value) {
                  handlePrefixChange(value);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                <SelectItem value="none">-</SelectItem>
                {prefixOptions.map((p) => (
                  <SelectItem key={p} value={p.toString()}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

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
          Invalid {isCidr ? "CIDR" : "IP"} address format
        </div>
      )}

      {/* Format hint */}
      <div className="px-2 pb-1 text-[10px] text-muted-foreground leading-tight">
        {isCidr
          ? "Format: IPv4 (x.x.x.x/0-32) or IPv6 (::1/0-128)"
          : "Format: IPv4 (x.x.x.x) or IPv6 (::1)"}
      </div>
    </div>
  );
};

export const InetCellEditorWithProps = Object.assign(InetCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
