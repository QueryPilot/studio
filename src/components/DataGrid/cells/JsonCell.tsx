import { memo } from "react";

interface JsonCellProps {
  value: unknown;
}

export const JsonCell = memo(function JsonCell({ value }: JsonCellProps) {
  const preview = typeof value === "string" ? value : JSON.stringify(value);
  return (
    <pre 
      className="text-xs text-foreground/80 dark:text-foreground/65 bg-muted/50 px-1 py-0.5 rounded font-mono truncate block" 
      title={preview}
    >
      {preview}
    </pre>
  );
});