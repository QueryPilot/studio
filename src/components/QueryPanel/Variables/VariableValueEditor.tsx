import { memo, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconCalendar } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { VariableType } from "@/lib/queryVariables/types";

const TYPE_OPTIONS: Array<{ value: VariableType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Datetime" },
  { value: "boolean", label: "Boolean" },
];

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDatetime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${formatDate(date)} ${h}:${min}:${s}`;
}

function parseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

interface VariableValueEditorProps {
  name: string;
  value: string;
  type: VariableType;
  onValueChange: (value: string) => void;
  onTypeChange: (type: VariableType) => void;
  compact?: boolean;
}

export const VariableValueEditor = memo(function VariableValueEditor({
  name,
  value,
  type,
  onValueChange,
  onTypeChange,
  compact = false,
}: VariableValueEditorProps) {
  const handleBooleanChange = useCallback(
    (val: string | null) => {
      if (val !== null) {
        onValueChange(val);
      }
    },
    [onValueChange],
  );

  const handleDateSelect = useCallback(
    (date: Date | undefined) => {
      if (date) {
        onValueChange(formatDate(date));
      }
    },
    [onValueChange],
  );

  const handleDatetimeSelect = useCallback(
    (date: Date | undefined) => {
      if (date) {
        const existing = parseDate(value);
        const combined = new Date(date);
        if (existing) {
          combined.setHours(existing.getHours(), existing.getMinutes(), existing.getSeconds());
        }
        onValueChange(formatDatetime(combined));
      }
    },
    [onValueChange, value],
  );

  const selectedDate = useMemo(() => parseDate(value), [value]);

  const inputId = `var-${name}`;

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={inputId}
          className="text-xs font-mono text-muted-foreground truncate"
          title={name}
        >
          {name}
        </Label>
        <Select value={type} onValueChange={(v) => { if (v) { onTypeChange(v as VariableType); } }}>
          <SelectTrigger className="!h-5 w-auto min-w-[70px] text-[10px] border-none bg-muted/50 !px-1.5 gap-0.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {type === "boolean" ? (
        <Select value={value || "true"} onValueChange={handleBooleanChange}>
          <SelectTrigger className="!h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true" className="text-xs">TRUE</SelectItem>
            <SelectItem value="false" className="text-xs">FALSE</SelectItem>
          </SelectContent>
        </Select>
      ) : type === "date" ? (
        <Popover>
          <PopoverTrigger
            className={cn(
              "flex items-center gap-2 w-full rounded-md border border-input bg-background px-2 text-xs font-mono !h-7",
              !value && "text-muted-foreground",
            )}
          >
            <IconCalendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{value || "Pick a date..."}</span>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
            />
          </PopoverContent>
        </Popover>
      ) : type === "datetime" ? (
        <div className="space-y-1">
          <Popover>
            <PopoverTrigger
              className={cn(
                "flex items-center gap-2 w-full rounded-md border border-input bg-background px-2 text-xs font-mono !h-7",
                !value && "text-muted-foreground",
              )}
            >
              <IconCalendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{value || "Pick date & time..."}</span>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 space-y-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={handleDatetimeSelect}
              />
              <div className="border-t px-3 py-2">
                <Label className="text-[10px] text-muted-foreground">Time</Label>
                <Input
                  type="time"
                  step="1"
                  value={value ? value.split(" ").at(1) ?? "" : ""}
                  onChange={(e) => {
                    const datePart = value ? value.split(" ").at(0) ?? formatDate(new Date()) : formatDate(new Date());
                    onValueChange(`${datePart} ${e.target.value}`);
                  }}
                  className="!h-7 text-xs font-mono mt-1"
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      ) : (
        <Input
          id={inputId}
          type={type === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => { onValueChange(e.target.value); }}
          placeholder={type === "number" ? "0" : `Enter ${name}...`}
          className="!h-7 text-xs font-mono"
        />
      )}
    </div>
  );
});
