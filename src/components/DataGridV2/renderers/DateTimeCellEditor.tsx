import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PopoverAnchor } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, X as ClearIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { type DateTimeCustomCell } from "./DateTimeCellRenderer";

const parseDate = (value: string | number | null | undefined) => {
  if (!value) return null;
  // Try ISO first; fall back to Date parsing for YYYY-MM-DD
  const iso = new Date(value);
  // Invalid date check
  return Number.isNaN(iso.getTime()) ? null : iso;
};

// Editor
interface DateTimeCellEditorProps {
  value: DateTimeCustomCell;
  onFinishedEditing: (
    newValue?: DateTimeCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const DateTimeCellEditor: React.FC<DateTimeCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const { kind, value: raw, nullable } = value.data;

  const [text, setText] = useState<string>(raw ?? "");
  const [open, setOpen] = useState(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setOpen(true);
    }, 0);
    return () => {
      clearTimeout(t);
    };
  }, []);

  const commit = useCallback(
    (nextRaw: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const newCell: DateTimeCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextRaw,
        },
        copyData: nextRaw ?? "NULL",
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };
      setOpen(false);
      void Promise.resolve().then(() => {
        onFinishedEditing(newCell);
      });
    },
    [onFinishedEditing, value],
  );

  const handleSelectDate = useCallback(
    (selected?: Date) => {
      if (!selected) return;
      let next: string;
      if (kind === "date-cell") {
        const y = selected.getFullYear();
        const m = String(selected.getMonth() + 1).padStart(2, "0");
        const d = String(selected.getDate()).padStart(2, "0");
        next = `${y}-${m}-${d}`;
      } else if (kind === "time-cell") {
        // Keep time-only unchanged by calendar; no-op
        return;
      } else {
        // datetime-cell: preserve any existing time portion if present
        const y = selected.getFullYear();
        const m = String(selected.getMonth() + 1).padStart(2, "0");
        const d = String(selected.getDate()).padStart(2, "0");
        const timePart = (text.match(
          /\d{2}:\d{2}(:\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
        ) || [""])[0];
        next = `${y}-${m}-${d}${timePart ? ` ${timePart}` : ""}`;
      }
      commit(next);
    },
    [commit, kind, text],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (finishedRef.current) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishedRef.current = true;
      setOpen(false);
      onFinishedEditing(undefined);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const trimmed = text.trim();
      if (!trimmed && nullable) {
        commit(null);
      } else {
        commit(trimmed);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const movement: readonly [-1 | 0 | 1, -1 | 0 | 1] = e.shiftKey
        ? [-1, 0]
        : [1, 0];
      finishedRef.current = true;
      setOpen(false);
      onFinishedEditing(value, movement);
    }
  };

  // Prefer the currently typed value; fall back to original cell value
  const selectedDate: Date | undefined = useMemo(() => {
    const fromText = parseDate(text || undefined);
    if (fromText) return fromText;
    const fromRaw = parseDate(raw ?? undefined);
    return fromRaw || undefined;
  }, [text, raw]);

  return (
    <div className="w-full h-full flex items-center gap-1 px-2 click-outside-ignore relative justify-between">
      <input
        className={cn(
          "h-[31px] w-[200px] bg-transparent z-50 text-xs leading-6 outline-none",
          !raw ? "italic text-muted-foreground" : "",
        )}
        placeholder={
          kind === "date-cell"
            ? "YYYY-MM-DD"
            : kind === "time-cell"
            ? "HH:mm[:ss]"
            : "YYYY-MM-DD HH:mm[:ss]"
        }
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="flex items-center gap-0">
        {nullable ? (
          <Button
            variant="ghost"
            className="h-6 w-6 p-0 z-50"
            title="Clear"
            onClick={() => {
              commit(null);
            }}
          >
            <ClearIcon className="h-3 w-3" />
          </Button>
        ) : null}
        {kind !== "time-cell" && (
          <Popover open={open} onOpenChange={setOpen}>
            {/* Anchor spans the input width to center content under it */}
            <PopoverAnchor asChild>
              <span className="absolute inset-x-0 top-0 h-6" />
            </PopoverAnchor>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                className="h-6 w-6 p-0 z-50"
                title="Pick date"
              >
                <CalendarIcon className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={12}
              className="p-0 w-full rounded-xl click-outside-ignore z-50"
            >
              <Calendar
                mode="single"
                month={selectedDate ?? new Date()}
                selected={selectedDate}
                defaultMonth={selectedDate ?? new Date()}
                onSelect={(d) => {
                  handleSelectDate(d ?? undefined);
                }}
                captionLayout="dropdown"
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
};

export const DateTimeCellEditorWithProps = Object.assign(DateTimeCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
