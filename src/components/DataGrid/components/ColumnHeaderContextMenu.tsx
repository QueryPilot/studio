import { useCallback, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { IconArrowsUpDown, IconSortAscendingSmallBig, IconSortDescendingSmallBig, IconEyeOff, IconPin, IconPinnedOff, IconCopy, IconFilter, IconColumns, IconEye } from '@tabler/icons-react';
import type { GridColumnV2 } from "../types";

export interface ColumnHeaderContextMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: { x: number; y: number };
  column: GridColumnV2 | null;
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
}

export function ColumnHeaderContextMenu({
  open,
  onOpenChange,
  position,
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
}: ColumnHeaderContextMenuProps) {
  if (!column) {
    return null;
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuContent
        className="min-w-52 !text-xs p-1.5"
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
        }}
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-1.5 px-2 flex items-center">
            <IconArrowsUpDown className="mr-2 h-4 w-4 shrink-0" />
            <span>Sort</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="w-48 !text-xs p-1.5"
            sideOffset={2}
            alignOffset={-5}
          >
            <DropdownMenuItem onClick={onSortAsc} className="py-1.5 px-2 flex items-center">
              <IconSortAscendingSmallBig className="mr-2 h-4 w-4 shrink-0" />
              <span className="flex-1">Sort Ascending</span>
              {sortDirection === "asc" && (
                <span className="ml-auto text-muted-foreground">✓</span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSortDesc} className="py-1.5 px-2 flex items-center">
              <IconSortDescendingSmallBig className="mr-2 h-4 w-4 shrink-0" />
              <span className="flex-1">Sort Descending</span>
              {sortDirection === "desc" && (
                <span className="ml-auto text-muted-foreground">✓</span>
              )}
            </DropdownMenuItem>
            {sortDirection && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onClearSort} className="py-1.5 px-2 flex items-center">
                  <span>Clear Sort</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {isPinned ? (
          <DropdownMenuItem onClick={onUnpin} className="py-1.5 px-2 flex items-center">
            <IconPinnedOff className="mr-2 h-4 w-4 shrink-0" />
            <span>Unpin Column</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onPin} className="py-1.5 px-2 flex items-center">
            <IconPin className="mr-2 h-4 w-4 shrink-0" />
            <span>Pin Column</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={onHide} className="py-1.5 px-2 flex items-center">
          <IconEyeOff className="mr-2 h-4 w-4 shrink-0" />
          <span>Hide Column</span>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-1.5 px-2 flex items-center">
            <IconColumns className="mr-2 h-4 w-4 shrink-0" />
            <span>Column Visibility</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="max-h-80 overflow-y-auto w-56 !text-xs p-1.5"
            sideOffset={2}
            alignOffset={-5}
          >
            <DropdownMenuItem onClick={onShowAllColumns} className="py-1.5 px-2 flex items-center">
              <IconEye className="mr-2 h-4 w-4 shrink-0" />
              <span>Show All Columns</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground py-1 px-2">
                Toggle Columns
              </DropdownMenuLabel>
              {allColumns.map((col) => {
                const isVisible = columnVisibility[col.id] !== false;
                return (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={isVisible}
                    onCheckedChange={() => onToggleColumnVisibility(col.id)}
                    onSelect={(e) => e.preventDefault()}
                    className="py-1.5"
                  >
                    <span className="truncate">{col.name ?? col.field}</span>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {onFilterByColumn && (
          <DropdownMenuItem onClick={onFilterByColumn} className="py-1.5 px-2 flex items-center">
            <IconFilter className="mr-2 h-4 w-4 shrink-0" />
            <span>Filter by this column</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={onCopyColumnName} className="py-1.5 px-2 flex items-center">
          <IconCopy className="mr-2 h-4 w-4 shrink-0" />
          <span>Copy Column Name</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Hook to manage column header context menu state
export interface UseColumnHeaderContextMenuOptions {
  columns: GridColumnV2[]; // Columns as displayed in grid (for index lookup)
  allColumnsForVisibility?: GridColumnV2[]; // All columns for visibility submenu (optional, defaults to columns)
  pinnedColumns: string[];
  columnVisibility: Record<string, boolean>;
  getSortDirection: (columnId: string) => "asc" | "desc" | null;
  onSort: (columnId: string, direction: "asc" | "desc") => void;
  onClearSort: (columnId: string) => void;
  onHide: (columnId: string) => void;
  onPin: (columnId: string) => void;
  onUnpin: (columnId: string) => void;
  onToggleColumnVisibility: (columnId: string) => void;
  onShowAllColumns: () => void;
  onFilterByColumn?: (columnId: string) => void;
}

export interface ColumnHeaderContextMenuState {
  isOpen: boolean;
  column: GridColumnV2 | null;
  position: { x: number; y: number };
}

export function useColumnHeaderContextMenu({
  columns,
  allColumnsForVisibility,
  pinnedColumns,
  columnVisibility,
  getSortDirection,
  onSort,
  onClearSort,
  onHide,
  onPin,
  onUnpin,
  onToggleColumnVisibility,
  onShowAllColumns,
  onFilterByColumn,
}: UseColumnHeaderContextMenuOptions) {
  // Use allColumnsForVisibility for the visibility submenu, fallback to columns
  const visibilityColumns = allColumnsForVisibility ?? columns;
  const [menuState, setMenuState] = useState<ColumnHeaderContextMenuState>({
    isOpen: false,
    column: null,
    position: { x: 0, y: 0 },
  });

  const handleHeaderContextMenu = useCallback(
    (
      colIndex: number,
      event: {
        bounds: { x: number; y: number; width: number; height: number };
        preventDefault: () => void;
      },
    ) => {
      event.preventDefault();
      const column = columns[colIndex];
      if (!column) return;

      setMenuState({
        isOpen: true,
        column,
        position: {
          x: event.bounds.x + event.bounds.width / 2,
          y: event.bounds.y + event.bounds.height,
        },
      });
    },
    [columns],
  );

  const closeMenu = useCallback(() => {
    setMenuState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const getMenuProps = useCallback((): Omit<
    ColumnHeaderContextMenuProps,
    "open" | "onOpenChange" | "position"
  > | null => {
    if (!menuState.column) return null;

    const columnId = menuState.column.id;
    const sortDirection = getSortDirection(columnId);
    const isPinned = pinnedColumns.includes(columnId);

    return {
      column: menuState.column,
      sortDirection,
      isPinned,
      allColumns: visibilityColumns,
      columnVisibility,
      onSortAsc: () => {
        onSort(columnId, "asc");
        closeMenu();
      },
      onSortDesc: () => {
        onSort(columnId, "desc");
        closeMenu();
      },
      onClearSort: () => {
        onClearSort(columnId);
        closeMenu();
      },
      onHide: () => {
        onHide(columnId);
        closeMenu();
      },
      onPin: () => {
        onPin(columnId);
        closeMenu();
      },
      onUnpin: () => {
        onUnpin(columnId);
        closeMenu();
      },
      onCopyColumnName: () => {
        // Use actual column name, not internal field identifier
        navigator.clipboard.writeText(menuState.column?.name ?? menuState.column?.field ?? columnId);
        closeMenu();
      },
      onToggleColumnVisibility: (colId: string) => {
        onToggleColumnVisibility(colId);
      },
      onShowAllColumns: () => {
        onShowAllColumns();
        closeMenu();
      },
      onFilterByColumn: onFilterByColumn
        ? () => {
            onFilterByColumn(columnId);
            closeMenu();
          }
        : undefined,
    };
  }, [
    menuState.column,
    visibilityColumns,
    columnVisibility,
    getSortDirection,
    pinnedColumns,
    onSort,
    onClearSort,
    onHide,
    onPin,
    onUnpin,
    onToggleColumnVisibility,
    onShowAllColumns,
    onFilterByColumn,
    closeMenu,
  ]);

  return {
    menuState,
    handleHeaderContextMenu,
    closeMenu,
    getMenuProps,
  };
}
