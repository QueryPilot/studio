import { memo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconPlus, IconCheck } from '@tabler/icons-react';

interface TableActionsToolbarProps {
  addButtonLabel: string;
  onAdd: () => void;
  onReviewChanges: () => void;
  pendingChangesCount: number;
  disabled?: boolean;
  /** Optional slot for batch actions (rendered between add button and commit/discard) */
  batchActions?: ReactNode;
}

export const TableActionsToolbar = memo(function TableActionsToolbar({
  addButtonLabel,
  onAdd,
  onReviewChanges,
  pendingChangesCount,
  disabled = false,
  batchActions,
}: TableActionsToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
      <Button
        size="sm"
        variant="outline"
        onClick={onAdd}
        disabled={disabled}
        className="h-6 text-xs px-2"
      >
        <IconPlus className="h-3 w-3 mr-1" />
        {addButtonLabel}
      </Button>

      {/* Batch actions slot */}
      {batchActions && (
        <>
          <div className="h-4 w-px bg-border" />
          {batchActions}
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Commit/Discard actions when there are pending changes */}
      {pendingChangesCount > 0 && (
        <>
          <div className="h-4 w-px bg-border" />
          <Button
            size="sm"
            variant="default"
            onClick={onReviewChanges}
            className="h-6 text-xs px-2"
          >
            <IconCheck className="h-3 w-3 mr-1" />
            Commit ({pendingChangesCount})
          </Button>
        </>
      )}
    </div>
  );
});
