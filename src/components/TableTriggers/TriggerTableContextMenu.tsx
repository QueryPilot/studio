import { useCallback, useState, type RefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  IconCheck,
  IconCopy,
  IconCode,
  IconTrash,
  IconArrowBackUp,
} from "@tabler/icons-react";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";
import type { TriggerGridRow } from "./types";

interface TriggerTableContextMenuProps {
  children: React.ReactNode;
  /** Ref tracking the currently hovered row (updated by onItemHovered) */
  hoveredRowRef: RefObject<TriggerGridRow | null>;
  onToggleEnabled: (row: TriggerGridRow) => void;
  onUndoDelete: (row: TriggerGridRow) => void;
  onShowDeleteConfirm: (row: TriggerGridRow) => void;
}

export function TriggerTableContextMenu({
  children,
  hoveredRowRef,
  onToggleEnabled,
  onUndoDelete,
  onShowDeleteConfirm,
}: TriggerTableContextMenuProps) {
  // Snapshot the hovered row when the menu opens — this prevents the row
  // from going null when the mouse moves to the context menu popup.
  const [row, setRow] = useState<TriggerGridRow | null>(null);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setRow(hoveredRowRef.current ?? null);
      } else {
        setRow(null);
      }
    },
    [hoveredRowRef],
  );

  const isPendingDelete = row?._isPendingDelete ?? false;

  const handleCopyName = useCallback(() => {
    if (!row) return;
    void writeClipboardText(row.name).then(() => {
      toast.success("Copied trigger name");
    });
  }, [row]);

  const handleCopyDefinition = useCallback(() => {
    if (!row) return;
    void writeClipboardText(row.definition || "").then(() => {
      toast.success("Copied trigger definition");
    });
  }, [row]);

  const handleDelete = useCallback(() => {
    if (!row) return;
    if (isPendingDelete) {
      onUndoDelete(row);
    } else {
      onShowDeleteConfirm(row);
    }
  }, [row, isPendingDelete, onUndoDelete, onShowDeleteConfirm]);

  const deleteLabel = isPendingDelete ? "Undo Delete" : "Delete Trigger";

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger className="h-full w-full block">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 text-xs p-1">
        {row && (
          <>
            {/* Toggle Enabled — disabled when pending delete */}
            <ContextMenuItem
              onClick={() => { onToggleEnabled(row); }}
              disabled={isPendingDelete}
            >
              <span className="flex-1">Enabled</span>
              {row.enabled === "YES" && (
                <IconCheck className="ml-auto text-foreground" />
              )}
            </ContextMenuItem>

            <ContextMenuSeparator />

            {/* Copy Trigger Name */}
            <ContextMenuItem onClick={handleCopyName}>
              <IconCopy className="text-foreground" />
              <span className="flex-1">Copy Trigger Name</span>
            </ContextMenuItem>

            {/* Copy Definition */}
            <ContextMenuItem
              onClick={handleCopyDefinition}
              disabled={!row.definition}
            >
              <IconCode className="text-foreground" />
              <span className="flex-1">Copy Definition</span>
            </ContextMenuItem>

            <ContextMenuSeparator />

            {/* Delete / Undo Delete */}
            {isPendingDelete ? (
              <ContextMenuItem onClick={handleDelete}>
                <IconArrowBackUp className="text-foreground" />
                <span className="flex-1">{deleteLabel}</span>
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                variant="destructive"
                onClick={handleDelete}
              >
                <IconTrash />
                <span className="flex-1">{deleteLabel}</span>
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
