import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import { IconCalendar, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { VariableType } from "@/lib/queryVariables/types";

const TYPE_OPTIONS: Array<{ value: VariableType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Datetime" },
  { value: "boolean", label: "Boolean" },
  { value: "list", label: "List" },
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

function TagInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const tags = useMemo(
    () => value.split(",").map((s) => s.trim()).filter(Boolean),
    [value],
  );

  const commitTag = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const next = [...tags, trimmed];
      onChange(next.join(", "));
      setDraft("");
    },
    [tags, onChange],
  );

  const removeTag = useCallback(
    (index: number) => {
      const next = tags.filter((_, i) => i !== index);
      onChange(next.join(", "));
    },
    [tags, onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
        if (draft.trim()) {
          e.preventDefault();
          commitTag(draft);
        }
      } else if (e.key === "Backspace" && !draft && tags.length > 0) {
        removeTag(tags.length - 1);
      }
    },
    [draft, tags, commitTag, removeTag],
  );

  const handleBlur = useCallback(() => {
    if (draft.trim()) {
      commitTag(draft);
    }
  }, [draft, commitTag]);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-md border border-input bg-input/20 dark:bg-input/30 px-1.5 py-1 min-h-[28px]",
        "focus-within:border-ring focus-within:ring-ring/30 focus-within:ring-[2px]",
        "transition-[border-color,box-shadow] duration-150 cursor-text",
      )}
      onClick={() => { inputRef.current?.focus(); }}
    >
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-0.5 rounded bg-primary/15 text-primary text-[11px] font-mono px-1.5 py-0.5 leading-tight"
        >
          {tag}
          <button
            type="button"
            className="text-primary/60 hover:text-primary ml-0.5 shrink-0"
            onClick={(e) => { e.stopPropagation(); removeTag(i); }}
            tabIndex={-1}
          >
            <IconX className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={tags.length === 0 ? "Type value, press Enter" : ""}
        className="flex-1 min-w-[60px] bg-transparent text-xs font-mono outline-none placeholder:text-muted-foreground py-0.5"
      />
    </div>
  );
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
          <SelectTrigger className="!h-5 w-auto min-w-[70px] text-[11px] border-none bg-muted/50 !px-1.5 gap-0.5">
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
        <div className="space-y-1">
          <Input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => { onValueChange(e.target.value); }}
            placeholder="e.g. 2026-04-04"
            className="!h-7 text-xs font-mono"
          />
          <Popover>
            <PopoverTrigger
              className={cn(
                "flex items-center gap-2 w-full rounded-md border border-input bg-background px-2 text-xs font-mono !h-7",
                !value && "text-muted-foreground",
              )}
            >
              <IconCalendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{value || "Or pick from calendar..."}</span>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={handleDateSelect}
              />
            </PopoverContent>
          </Popover>
        </div>
      ) : type === "datetime" ? (
        <div className="space-y-1">
          <Input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => { onValueChange(e.target.value); }}
            placeholder="e.g. 2026-04-04 14:30:00"
            className="!h-7 text-xs font-mono"
          />
          <Popover>
            <PopoverTrigger
              className={cn(
                "flex items-center gap-2 w-full rounded-md border border-input bg-background px-2 text-xs font-mono !h-7",
                !value && "text-muted-foreground",
              )}
            >
              <IconCalendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{value || "Or pick from calendar..."}</span>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 space-y-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={handleDatetimeSelect}
              />
              <div className="border-t px-3 py-2">
                <Label className="text-[11px] text-muted-foreground">Time</Label>
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
      ) : type === "list" ? (
        <TagInput
          id={inputId}
          value={value}
          onChange={onValueChange}
        />
      ) : (
        <Input
          id={inputId}
          type={type === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => { onValueChange(e.target.value); }}
          placeholder={type === "number" ? "e.g. 42" : "e.g. value"}
          className="!h-7 text-xs font-mono"
        />
      )}
    </div>
  );
});
