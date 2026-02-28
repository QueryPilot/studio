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
  IconTrash,
  IconCopy,
  IconCode,
  IconCheck,
  IconArrowBackUp,
} from "@tabler/icons-react";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";
import type { IndexGridRow } from "./types";

interface IndexTableContextMenuProps {
  children: React.ReactNode;
  /** Ref tracking the currently hovered row (updated by onItemHovered) */
  hoveredRowRef: RefObject<IndexGridRow | null>;
  tableName: string;
  schemaName?: string;
  availableIndexTypes: string[];
  onAddIndex: () => void;
  onDeleteIndex: (row: IndexGridRow) => void;
  onUndoDelete: (row: IndexGridRow) => void;
  onChangeType: (row: IndexGridRow, newType: string) => void;
  onToggleUnique: (row: IndexGridRow) => void;
  onShowDeleteConfirm: (row: IndexGridRow) => void;
}

function buildIndexDDL(
  row: IndexGridRow,
  tableName: string,
  schemaName?: string,
): string {
  const parts: string[] = ["CREATE"];

  if (row.unique === "YES") {
    parts.push("UNIQUE");
  }

  parts.push("INDEX");
  parts.push(row.name);
  parts.push("ON");

  if (schemaName) {
    parts.push(`${schemaName}.${tableName}`);
  } else {
    parts.push(tableName);
  }

  if (row.index_type) {
    parts.push(`USING ${row.index_type}`);
  }

  parts.push(`(${row.columns_array.join(", ")})`);

  let ddl = parts.join(" ");

  if (row.condition) {
    ddl += `\nWHERE ${row.condition}`;
  }

  ddl += ";";

  return ddl;
}

export function IndexTableContextMenu({
  children,
  hoveredRowRef,
  tableName,
  schemaName,
  availableIndexTypes,
  onAddIndex,
  onDeleteIndex,
  onUndoDelete,
  onChangeType,
  onToggleUnique,
  onShowDeleteConfirm,
}: IndexTableContextMenuProps) {
  // Snapshot the hovered row when the menu opens — this prevents the row
  // from going null when the mouse moves to the context menu popup.
  const [row, setRow] = useState<IndexGridRow | null>(null);

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

  const isLocked = row?.name_meta.primary ?? false;
  const isPendingDelete = row?._isPendingDelete ?? false;
  const isPending = row?._isPending ?? false;
  const isEditDisabled = isLocked || isPendingDelete;

  const handleCopyName = useCallback(() => {
    if (!row) return;
    void writeClipboardText(row.name).then(() => {
      toast.success("Copied index name");
    });
  }, [row]);

  const handleCopyDDL = useCallback(() => {
    if (!row) return;
    const ddl = buildIndexDDL(row, tableName, schemaName);
    void writeClipboardText(ddl).then(() => {
      toast.success("Copied index DDL");
    });
  }, [row, tableName, schemaName]);

  const handleDelete = useCallback(() => {
    if (!row) return;
    if (isPendingDelete) {
      onUndoDelete(row);
    } else if (isPending) {
      onDeleteIndex(row);
    } else {
      onShowDeleteConfirm(row);
    }
  }, [row, isPendingDelete, isPending, onUndoDelete, onDeleteIndex, onShowDeleteConfirm]);

  const deleteLabel = isPendingDelete
    ? "Undo Delete"
    : isPending
      ? "Discard"
      : "Delete Index";

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger className="h-full w-full block">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 text-xs p-1">
        {/* Add Index - always available */}
        <ContextMenuItem onClick={onAddIndex}>
          <IconPlus className="text-foreground" />
          <span className="flex-1">Add Index</span>
        </ContextMenuItem>

        {row && (
          <>
            <ContextMenuSeparator />

            {/* Change Type submenu */}
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={isEditDisabled}>
                <span className="flex-1">Change Type</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="text-xs p-1">
                {availableIndexTypes.map((type) => (
                  <ContextMenuItem
                    key={type}
                    onClick={() => { onChangeType(row, type); }}
                  >
                    <span className="flex-1">{type}</span>
                    {row.index_type === type && (
                      <IconCheck className="ml-auto text-foreground" />
                    )}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            {/* Toggle Unique */}
            <ContextMenuItem
              onClick={() => { onToggleUnique(row); }}
              disabled={isEditDisabled}
            >
              <span className="flex-1">Unique</span>
              {row.unique === "YES" && (
                <IconCheck className="ml-auto text-foreground" />
              )}
            </ContextMenuItem>

            <ContextMenuSeparator />

            {/* Copy Index Name */}
            <ContextMenuItem onClick={handleCopyName}>
              <IconCopy className="text-foreground" />
              <span className="flex-1">Copy Index Name</span>
            </ContextMenuItem>

            {/* Copy DDL */}
            <ContextMenuItem onClick={handleCopyDDL}>
              <IconCode className="text-foreground" />
              <span className="flex-1">Copy DDL</span>
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
                disabled={isLocked}
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
