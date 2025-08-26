import { memo } from "react";
import { cn } from "@/lib/utils";

interface BooleanCellProps {
  value: boolean;
}

export const BooleanCell = memo(function BooleanCell({ value }: BooleanCellProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        value
          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
          : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
      )}
    >
      {value ? "TRUE" : "FALSE"}
    </span>
  );
});