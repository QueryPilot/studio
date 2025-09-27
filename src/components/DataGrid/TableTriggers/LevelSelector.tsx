import { memo } from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LevelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

const TRIGGER_LEVELS = [
  { value: "ROW", label: "ROW" },
  { value: "STATEMENT", label: "STATEMENT" },
];

export const LevelSelector = memo(function LevelSelector({
  value,
  onChange,
  disabled = false,
  className,
}: LevelSelectorProps) {
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
        {TRIGGER_LEVELS.map((level) => (
          <SelectItem key={level.value} value={level.value} className="text-xs">
            {level.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});
