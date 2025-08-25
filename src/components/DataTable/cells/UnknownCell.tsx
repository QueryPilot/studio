import { memo } from "react";
import { cn } from "@/lib/utils";
import { HelpCircle } from "lucide-react";
import type { CellRendererProps } from "../types";

export const UnknownCell = memo(function UnknownCell({
  value,
  isSelected,
  isHovered,
}: CellRendererProps) {
  const displayValue =
    value?.value !== null && value?.value !== undefined
      ? String(value.value)
      : "";

  const truncatedDisplay =
    displayValue.length > 100
      ? displayValue.substring(0, 100) + "..."
      : displayValue;

  return (
    <div
      className={cn(
        "px-2 py-1 text-sm flex items-center gap-1 cursor-default truncate",
        isSelected && "bg-accent/50",
        isHovered && !isSelected && "bg-muted/50",
      )}
      title={`Unknown type: ${
        value?.value_type || "undefined"
      }\nValue: ${displayValue}`}
    >
      {value?.value !== null && value?.value !== undefined ? (
        <>
          <HelpCircle className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="text-xs truncate">{truncatedDisplay}</span>
        </>
      ) : (
        <span className="text-muted-foreground">NULL</span>
      )}
    </div>
  );
});
