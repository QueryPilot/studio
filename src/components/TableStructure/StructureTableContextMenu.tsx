import { useCallback, useState, type RefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  IconPlus,
  IconCopyPlus,
  IconCheck,
  IconCopy,
  IconCode,
  IconTrash,
  IconArrowBackUp,
} from "@tabler/icons-react";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";
import type { StructureGridRow } from "./types";

interface StructureTableContextMenuProps {
  children: React.ReactNode;
  /** Ref tracking the currently hovered row (updated by onItemHovered) */
  hoveredRowRef: RefObject<StructureGridRow | null>;
  onAddColumn: () => void;
  onDuplicate: (row: StructureGridRow) => void;
  onSetNullable: (row: StructureGridRow, value: "YES" | "NO") => void;
  onDeleteColumn: (row: StructureGridRow) => void;
  onUndoDelete: (row: StructureGridRow) => void;
  onShowDeleteConfirm: (row: StructureGridRow) => void;
}

/**
 * Build a column DDL fragment like: column_name VARCHAR(255) NOT NULL DEFAULT ''
 */
function buildColumnDDL(row: StructureGridRow): string {
  const parts: string[] = [row.column_name, row.db_type];

  if (row.nullable === "NO") {
    parts.push("NOT NULL");
  }

  if (row.default != null && row.default !== "") {
    parts.push(`DEFAULT ${row.default}`);
  }

  if (row.check_constraint) {
    parts.push(`CHECK (${row.check_constraint})`);
  }

  return parts.join(" ");
}

export function StructureTableContextMenu({
  children,
  hoveredRowRef,
  onAddColumn,
  onDuplicate,
  onSetNullable,
  onDeleteColumn,
  onUndoDelete,
  onShowDeleteConfirm,
}: StructureTableContextMenuProps) {
  // Snapshot the hovered row when the menu opens — this prevents the row
  // from going null when the mouse moves to the context menu popup.
  const [row, setRow] = useState<StructureGridRow | null>(null);

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
  const isPending = row?._isPending ?? false;
  const isEditDisabled = isPendingDelete;

  const handleCopyName = useCallback(() => {
    if (!row) return;
    void writeClipboardText(row.column_name).then(() => {
      toast.success("Copied column name");
    });
  }, [row]);

  const handleCopyDDL = useCallback(() => {
    if (!row) return;
    const ddl = buildColumnDDL(row);
    void writeClipboardText(ddl).then(() => {
      toast.success("Copied column DDL");
    });
  }, [row]);

  const handleDelete = useCallback(() => {
    if (!row) return;
    if (isPendingDelete) {
      onUndoDelete(row);
    } else if (isPending) {
      onDeleteColumn(row);
    } else {
      onShowDeleteConfirm(row);
    }
  }, [row, isPendingDelete, isPending, onUndoDelete, onDeleteColumn, onShowDeleteConfirm]);

  const deleteLabel = isPendingDelete
    ? "Undo Delete"
    : isPending
      ? "Discard"
      : "Delete Column";

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger className="h-full w-full block">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 text-xs p-1">
        {/* Add Column - always available */}
        <ContextMenuItem onClick={onAddColumn}>
          <IconPlus className="text-foreground" />
          <span className="flex-1">Add Column</span>
        </ContextMenuItem>

        {row && (
          <>
            <ContextMenuSeparator />

            {/* Duplicate Column */}
            <ContextMenuItem
              onClick={() => { onDuplicate(row); }}
              disabled={isEditDisabled}
            >
              <IconCopyPlus className="text-foreground" />
              <span className="flex-1">Duplicate Column</span>
            </ContextMenuItem>

            {/* Nullable submenu */}
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={isEditDisabled}>
                <span className="flex-1">Nullable</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="text-xs p-1">
                <ContextMenuItem
                  onClick={() => { onSetNullable(row, "YES"); }}
                >
                  <span className="flex-1">YES</span>
                  {row.nullable === "YES" && (
                    <IconCheck className="ml-auto text-foreground" />
                  )}
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => { onSetNullable(row, "NO"); }}
                >
                  <span className="flex-1">NO</span>
                  {row.nullable === "NO" && (
                    <IconCheck className="ml-auto text-foreground" />
                  )}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />

            {/* Copy Column Name */}
            <ContextMenuItem onClick={handleCopyName}>
              <IconCopy className="text-foreground" />
              <span className="flex-1">Copy Column Name</span>
            </ContextMenuItem>

            {/* Copy Column DDL */}
            <ContextMenuItem onClick={handleCopyDDL}>
              <IconCode className="text-foreground" />
              <span className="flex-1">Copy Column DDL</span>
            </ContextMenuItem>

            <ContextMenuSeparator />

            {/* Delete / Discard / Undo Delete */}
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
