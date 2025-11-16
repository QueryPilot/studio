import { memo } from "react";
import { Badge } from "@/components/ui/badge";

interface PendingChangesIndicatorProps {
  count: number;
  variant?: "default" | "secondary" | "destructive" | "outline";
}

export const PendingChangesIndicator = memo(
  function PendingChangesIndicator({
    count,
    variant = "secondary",
  }: PendingChangesIndicatorProps) {
    if (count === 0) {
      return null;
    }

    return (
      <Badge variant={variant} className="ml-2">
        {count} {count === 1 ? "change" : "changes"}
      </Badge>
    );
  },
);
