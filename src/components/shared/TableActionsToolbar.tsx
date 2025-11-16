import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Eye, CheckCircle2 } from "lucide-react";
import { PendingChangesIndicator } from "./PendingChangesIndicator";

interface TableActionsToolbarProps {
  addButtonLabel: string;
  onAdd: () => void;
  onReviewChanges: () => void;
  pendingChangesCount: number;
  disabled?: boolean;
}

export const TableActionsToolbar = memo(function TableActionsToolbar({
  addButtonLabel,
  onAdd,
  onReviewChanges,
  pendingChangesCount,
  disabled = false,
}: TableActionsToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
      <Button
        size="sm"
        variant="outline"
        onClick={onAdd}
        disabled={disabled}
        className="h-7 text-xs"
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        {addButtonLabel}
      </Button>

      {pendingChangesCount > 0 && (
        <>
          <div className="flex-1" />
          <PendingChangesIndicator count={pendingChangesCount} />
          <Button
            size="sm"
            variant="outline"
            onClick={onReviewChanges}
            className="h-7 text-xs"
          >
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            Review
          </Button>
        </>
      )}
    </div>
  );
});
