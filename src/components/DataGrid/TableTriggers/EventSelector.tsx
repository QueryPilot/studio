import { memo } from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EventSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

const TRIGGER_EVENTS = [
  {
    value: "INSERT",
    label: "INSERT",
    color: "text-green-600 dark:text-green-400",
  },
  {
    value: "UPDATE",
    label: "UPDATE",
    color: "text-blue-600 dark:text-blue-400",
  },
  { value: "DELETE", label: "DELETE", color: "text-red-600 dark:text-red-400" },
  {
    value: "TRUNCATE",
    label: "TRUNCATE",
    color: "text-orange-600 dark:text-orange-400",
  },
];

export const EventSelector = memo(function EventSelector({
  value,
  onChange,
  disabled = false,
  className,
}: EventSelectorProps) {
  const selectedEvent = TRIGGER_EVENTS.find((e) => e.value === value);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className={cn(
          "!h-7 border-0 bg-transparent text-xs px-2 py-1",
          "focus:ring-1 focus:ring-primary",
          selectedEvent?.color,
          disabled && "opacity-60 cursor-not-allowed",
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TRIGGER_EVENTS.map((event) => (
          <SelectItem
            key={event.value}
            value={event.value}
            className={cn("text-xs", event.color)}
          >
            <span
              className={cn(
                "inline-flex px-1.5 py-0 rounded text-xs",
                event.value === "INSERT" &&
                  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                event.value === "UPDATE" &&
                  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                event.value === "DELETE" &&
                  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                event.value === "TRUNCATE" &&
                  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
              )}
            >
              {event.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});
