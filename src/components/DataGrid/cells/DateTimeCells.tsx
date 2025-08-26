import { memo } from "react";
import { formatDate, formatDateTime, formatTime } from "./formatters";

interface DateCellProps {
  value: string;
}

export const DateCell = memo(function DateCell({ value }: DateCellProps) {
  return <span className="text-xs text-foreground/80 dark:text-foreground/65 block truncate">{formatDate(value)}</span>;
});

interface DateTimeCellProps {
  value: string;
  timezone?: string;
}

export const DateTimeCell = memo(function DateTimeCell({ value, timezone }: DateTimeCellProps) {
  const formatted = formatDateTime(value);
  return (
    <span 
      className="text-xs text-foreground/80 dark:text-foreground/65 block truncate" 
      title={timezone ? `Timezone: ${timezone}` : formatted}
    >
      {formatted}
    </span>
  );
});

interface TimeCellProps {
  value: string;
}

export const TimeCell = memo(function TimeCell({ value }: TimeCellProps) {
  return <span className="text-xs text-foreground/80 dark:text-foreground/65 tabular-nums block truncate">{formatTime(value)}</span>;
});