import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconAlertCircle } from "@tabler/icons-react";
import { usePreferencesStore } from "@/stores/preferencesStore";

interface QueryLimitControlProps {
  appliedLimit?: number;
  onFocusEditor?: () => void;
}

export function QueryLimitControl({
  appliedLimit,
  onFocusEditor,
}: QueryLimitControlProps) {
  const { smartQueryLimit, setSmartQueryLimit } = usePreferencesStore();
  const limits = [
    100, 1000, 5000, 10000, 50000, 100000, 250000, 500000, 1000000,
  ];

  return (
    <div className="flex items-center gap-2">
      {appliedLimit ? (
        <>
          <IconAlertCircle className="h-3.5 w-3.5 text-yellow-600" />
          <span className="text-xs text-yellow-700 dark:text-yellow-300">
            Auto limited
          </span>
        </>
      ) : null}
      <Select
        value={smartQueryLimit?.toString() ?? "null"}
        onValueChange={(value) => {
          if (value === "null") {
            setSmartQueryLimit(null);
          } else {
            setSmartQueryLimit(Number(value));
          }
          // Focus editor after selection
          onFocusEditor?.();
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="text-xs">
          <SelectItem value="null" className="text-xs">
            No limit
          </SelectItem>
          {limits.map((limit) => (
            <SelectItem
              key={limit}
              value={limit.toString()}
              className="text-xs"
            >
              {limit.toLocaleString()} rows
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
