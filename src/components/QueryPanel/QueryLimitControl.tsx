import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferencesStore";

interface QueryLimitControlProps {
  appliedLimit?: number;
}

export function QueryLimitControl({ appliedLimit }: QueryLimitControlProps) {
  const { smartQueryLimit, setSmartQueryLimit } = usePreferencesStore();
  const limits = [100, 1000, 5000, 10000, 50000, 100000];

  return (
    <div className="flex items-center gap-2">
      {appliedLimit ? (
        <>
          <AlertCircle className="h-3.5 w-3.5 text-yellow-600" />
          <span className="text-xs text-yellow-700 dark:text-yellow-300">
            Limited to {appliedLimit.toLocaleString()} rows
          </span>
          <span className="text-xs text-muted-foreground">•</span>
        </>
      ) : null}
      <span className="text-xs text-muted-foreground">Auto limit:</span>
      <Select
        value={smartQueryLimit?.toString() ?? "null"}
        onValueChange={(value) => {
          if (value === "null") {
            setSmartQueryLimit(null);
          } else {
            setSmartQueryLimit(Number(value));
          }
        }}
      >
        <SelectTrigger size="sm" className="h-7 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="text-xs">
          {limits.map((limit) => (
            <SelectItem
              key={limit}
              value={limit.toString()}
              className="text-xs"
            >
              {limit.toLocaleString()} rows
            </SelectItem>
          ))}
          <SelectItem value="null" className="text-xs">
            No limit
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
