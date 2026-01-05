import { memo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconPlus, IconX, IconDeviceFloppy } from "@tabler/icons-react";

interface TableActionsToolbarProps {
  /** Label for the add button. If not provided, add button is hidden. */
  addButtonLabel?: string;
  /** Handler for add button click. Required if addButtonLabel is provided. */
  onAdd?: () => void;
  onReviewChanges: () => void;
  /** Handler for discard button click. */
  onDiscard?: () => void;
  pendingChangesCount: number;
  disabled?: boolean;
  /** Optional slot for batch actions (rendered between add button and commit/discard) */
  batchActions?: ReactNode;
  /** If true, renders without wrapper div (for embedding in parent toolbar) */
  inline?: boolean;
}

export const TableActionsToolbar = memo(function TableActionsToolbar({
  addButtonLabel,
  onAdd,
  onReviewChanges,
  onDiscard,
  pendingChangesCount,
  disabled = false,
  batchActions,
  inline = false,
}: TableActionsToolbarProps) {
  const content = (
    <>
      {addButtonLabel && onAdd && (
        <Button variant="outline" onClick={onAdd} disabled={disabled}>
          <IconPlus className="h-3 w-3 mr-1" />
          {addButtonLabel}
        </Button>
      )}

      {/* Batch actions slot */}
      {batchActions && (
        <>
          <div className="h-4 w-px bg-border" />
          {batchActions}
        </>
      )}

      {/* Spacer - only when not inline */}
      {!inline && <div className="flex-1" />}

      {/* Commit/Discard actions when there are pending changes */}
      {pendingChangesCount > 0 && (
        <>
          {onDiscard && (
            <Button variant="ghost" onClick={onDiscard}>
              <IconX className="size-3.5!" />
              Discard
            </Button>
          )}
          <Button variant="default" onClick={onReviewChanges}>
            <IconDeviceFloppy className="size-3.5!" />
            Commit
          </Button>
        </>
      )}
    </>
  );

  if (inline) {
    return <div className="flex items-center gap-2">{content}</div>;
  }

  return (
    <div className="flex items-center gap-2 px-0 pb-1.5 pt-0.5 bg-transparent">
      {content}
    </div>
  );
});
