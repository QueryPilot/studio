import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuCheckboxItem,
  ContextMenuLabel,
  ContextMenuGroup,
} from "@/components/ui/context-menu";
import {
  IconArrowsUpDown,
  IconSortAscendingSmallBig,
  IconSortDescendingSmallBig,
  IconEyeOff,
  IconPin,
  IconPinnedOff,
  IconCopy,
  IconFilter,
  IconColumns,
  IconEye,
} from "@tabler/icons-react";
import type { GridColumnV2 } from "../types";
import { FKEmbedSubmenu } from "./FKEmbedSubmenu";

export interface ColumnHeaderContextMenuItemsProps {
  column: GridColumnV2;
  sortDirection: "asc" | "desc" | null;
  isPinned: boolean;
  allColumns: GridColumnV2[];
  columnVisibility: Record<string, boolean>;
  onSortAsc: () => void;
  onSortDesc: () => void;
  onClearSort: () => void;
  onHide: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onCopyColumnName: () => void;
  onFilterByColumn?: () => void;
  onToggleColumnVisibility: (columnId: string) => void;
  onShowAllColumns: () => void;
  connectionId?: string;
  schema?: string;
  tableName?: string;
  referencedTableColumns?: Array<{ name: string; db_type: string }>;
}

export function ColumnHeaderContextMenuItems({
  column,
  sortDirection,
  isPinned,
  allColumns,
  columnVisibility,
  onSortAsc,
  onSortDesc,
  onClearSort,
  onHide,
  onPin,
  onUnpin,
  onCopyColumnName,
  onFilterByColumn,
  onToggleColumnVisibility,
  onShowAllColumns,
  connectionId,
  schema,
  tableName,
  referencedTableColumns,
}: ColumnHeaderContextMenuItemsProps) {
  const isFKColumn = column.meta?.is_fk ?? false;
  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger className="py-1.5 px-2 flex items-center">
          <IconArrowsUpDown className="mr-2 h-4 w-4 shrink-0" />
          <span>Sort</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-48 !text-xs p-1.5">
          <ContextMenuItem onClick={onSortAsc} className="py-1.5 px-2 flex items-center">
            <IconSortAscendingSmallBig className="mr-2 h-4 w-4 shrink-0" />
            <span className="flex-1">Sort Ascending</span>
            {sortDirection === "asc" && (
              <span className="ml-auto text-muted-foreground">✓</span>
            )}
          </ContextMenuItem>
          <ContextMenuItem onClick={onSortDesc} className="py-1.5 px-2 flex items-center">
            <IconSortDescendingSmallBig className="mr-2 h-4 w-4 shrink-0" />
            <span className="flex-1">Sort Descending</span>
            {sortDirection === "desc" && (
              <span className="ml-auto text-muted-foreground">✓</span>
            )}
          </ContextMenuItem>
          {sortDirection && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onClearSort} className="py-1.5 px-2 flex items-center">
                <span>Clear Sort</span>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>

      {isFKColumn && connectionId && tableName && (
        <FKEmbedSubmenu
          column={column}
          connectionId={connectionId}
          schema={schema ?? "public"}
          table={tableName}
          referencedTableColumns={referencedTableColumns}
        />
      )}

      <ContextMenuSeparator />

      {isPinned ? (
        <ContextMenuItem onClick={onUnpin} className="py-1.5 px-2 flex items-center">
          <IconPinnedOff className="mr-2 h-4 w-4 shrink-0" />
          <span>Unpin Column</span>
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onClick={onPin} className="py-1.5 px-2 flex items-center">
          <IconPin className="mr-2 h-4 w-4 shrink-0" />
          <span>Pin Column</span>
        </ContextMenuItem>
      )}

      <ContextMenuItem onClick={onHide} className="py-1.5 px-2 flex items-center">
        <IconEyeOff className="mr-2 h-4 w-4 shrink-0" />
        <span>Hide Column</span>
      </ContextMenuItem>

      <ContextMenuSub>
        <ContextMenuSubTrigger className="py-1.5 px-2 flex items-center">
          <IconColumns className="mr-2 h-4 w-4 shrink-0" />
          <span>Column Visibility</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 overflow-y-auto w-56 !text-xs p-1.5">
          <ContextMenuItem onClick={onShowAllColumns} className="py-1.5 px-2 flex items-center">
            <IconEye className="mr-2 h-4 w-4 shrink-0" />
            <span>Show All Columns</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuLabel className="text-xs text-muted-foreground py-1 px-2">
              Toggle Columns
            </ContextMenuLabel>
            {allColumns.map((col) => {
              const isVisible = columnVisibility[col.id] !== false;
              return (
                <ContextMenuCheckboxItem
                  key={col.id}
                  checked={isVisible}
                  onCheckedChange={() => { onToggleColumnVisibility(col.id); }}
                  onSelect={(e) => { e.preventDefault(); }}
                  className="py-1.5"
                >
                  <span className="truncate">{col.name ?? col.field}</span>
                </ContextMenuCheckboxItem>
              );
            })}
          </ContextMenuGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator />

      {onFilterByColumn && (
        <ContextMenuItem onClick={onFilterByColumn} className="py-1.5 px-2 flex items-center">
          <IconFilter className="mr-2 h-4 w-4 shrink-0" />
          <span>Filter by this column</span>
        </ContextMenuItem>
      )}

      <ContextMenuItem onClick={onCopyColumnName} className="py-1.5 px-2 flex items-center">
        <IconCopy className="mr-2 h-4 w-4 shrink-0" />
        <span>Copy Column Name</span>
      </ContextMenuItem>
    </>
  );
}
