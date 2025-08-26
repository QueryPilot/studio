import { memo } from "react";

interface UuidCellProps {
  value: string;
}

export const UuidCell = memo(function UuidCell({ value }: UuidCellProps) {
  const text = String(value);
  return (
    <span 
      className="text-xs text-foreground/80 dark:text-foreground/65 font-mono truncate block" 
      title={text}
    >
      {text}
    </span>
  );
});