import { memo } from "react";
import { formatBytes } from "./formatters";

interface BinaryCellProps {
  size: number;
}

export const BinaryCell = memo(function BinaryCell({ size }: BinaryCellProps) {
  return (
    <span className="text-xs text-muted-foreground font-mono">
      Binary ({formatBytes(size)})
    </span>
  );
});