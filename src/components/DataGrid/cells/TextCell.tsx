import { memo } from "react";

interface TextCellProps {
  value: string;
}

export const TextCell = memo(function TextCell({ value }: TextCellProps) {
  const text = String(value);
  return (
    <span className="text-xs text-foreground/80 dark:text-foreground/65 block truncate" title={text}>
      {text}
    </span>
  );
});