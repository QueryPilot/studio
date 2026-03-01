import { useCallback, useState, type RefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  IconPlus,
  IconCheck,
  IconCopy,
  IconTrash,
} from "@tabler/icons-react";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";
import type { IndexGridRow } from "@/components/TableIndexes/types";

interface DesignerIndexContextMenuProps {
  children: React.ReactNode;
  hoveredRowRef: RefObject<IndexGridRow | null>;
  onAddIndex: () => void;
  onToggleUnique: (row: IndexGridRow) => void;
  onDeleteIndex: (row: IndexGridRow) => void;
}

export function DesignerIndexContextMenu({
  children,
  hoveredRowRef,
  onAddIndex,
  onToggleUnique,
  onDeleteIndex,
}: DesignerIndexContextMenuProps) {
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

  const handleCopyName = useCallback(() => {
    if (!row) return;
    void writeClipboardText(row.name).then(() => {
      toast.success("Copied index name");
    });
  }, [row]);

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

            {/* Toggle Unique */}
            <ContextMenuItem onClick={() => { onToggleUnique(row); }}>
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

            <ContextMenuSeparator />

            {/* Delete Index */}
            <ContextMenuItem
              variant="destructive"
              onClick={() => { onDeleteIndex(row); }}
            >
              <IconTrash />
              <span className="flex-1">Delete Index</span>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
