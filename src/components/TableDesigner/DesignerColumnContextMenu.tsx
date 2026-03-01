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
  IconKey,
} from "@tabler/icons-react";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";
import { quoteIdentifier } from "@/adapters/formatting";
import { DbType } from "@/types/connection";
import type { DesignerGridRow } from "./utils";

interface DesignerColumnContextMenuProps {
  children: React.ReactNode;
  hoveredRowRef: RefObject<DesignerGridRow | null>;
  dbType?: DbType;
  onAddColumn: () => void;
  onDuplicate: (row: DesignerGridRow) => void;
  onTogglePrimaryKey: (row: DesignerGridRow) => void;
  onSetNullable: (row: DesignerGridRow, value: "YES" | "NO") => void;
  onDeleteColumn: (row: DesignerGridRow) => void;
}

function buildColumnDDL(row: DesignerGridRow, dbType: DbType = DbType.PostgreSQL): string {
  const parts: string[] = [quoteIdentifier(row.column_name, dbType), row.db_type];

  if (row.column_meta.is_pk) {
    parts.push("PRIMARY KEY");
  }

  if (row.nullable === "NO") {
    parts.push("NOT NULL");
  }

  if (row.default) {
    parts.push(`DEFAULT ${row.default}`);
  }

  if (row.check_constraint) {
    parts.push(`CHECK (${row.check_constraint})`);
  }

  return parts.join(" ");
}

export function DesignerColumnContextMenu({
  children,
  hoveredRowRef,
  dbType,
  onAddColumn,
  onDuplicate,
  onTogglePrimaryKey,
  onSetNullable,
  onDeleteColumn,
}: DesignerColumnContextMenuProps) {
  const [row, setRow] = useState<DesignerGridRow | null>(null);

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
    void writeClipboardText(row.column_name).then(() => {
      toast.success("Copied column name");
    });
  }, [row]);

  const handleCopyDDL = useCallback(() => {
    if (!row) return;
    const ddl = buildColumnDDL(row, dbType);
    void writeClipboardText(ddl).then(() => {
      toast.success("Copied column DDL");
    });
  }, [row, dbType]);

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
            <ContextMenuItem onClick={() => { onDuplicate(row); }}>
              <IconCopyPlus className="text-foreground" />
              <span className="flex-1">Duplicate Column</span>
            </ContextMenuItem>

            {/* Primary Key toggle */}
            <ContextMenuItem onClick={() => { onTogglePrimaryKey(row); }}>
              <IconKey className="text-foreground" />
              <span className="flex-1">Primary Key</span>
              {row.column_meta.is_pk && (
                <IconCheck className="ml-auto text-foreground" />
              )}
            </ContextMenuItem>

            {/* Nullable submenu */}
            <ContextMenuSub>
              <ContextMenuSubTrigger>
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

            {/* Delete Column */}
            <ContextMenuItem
              variant="destructive"
              onClick={() => { onDeleteColumn(row); }}
            >
              <IconTrash />
              <span className="flex-1">Delete Column</span>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
