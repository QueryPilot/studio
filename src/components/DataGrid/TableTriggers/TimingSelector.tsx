import { memo } from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TimingSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

const TRIGGER_TIMINGS = [
  { value: "BEFORE", label: "BEFORE" },
  { value: "AFTER", label: "AFTER" },
  { value: "INSTEAD OF", label: "INSTEAD OF" },
];

export const TimingSelector = memo(function TimingSelector({
  value,
  onChange,
  disabled = false,
  className,
}: TimingSelectorProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className={cn(
          "!h-7 border-0 bg-transparent text-xs px-2 py-1",
          "focus:ring-1 focus:ring-primary",
          disabled && "opacity-60 cursor-not-allowed",
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TRIGGER_TIMINGS.map((timing) => (
          <SelectItem
            key={timing.value}
            value={timing.value}
            className="text-xs"
          >
            {timing.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});
