import { useCallback, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  EyeOff,
  Pin,
  PinOff,
  Copy,
  Filter,
} from "lucide-react";
import type { GridColumnV2 } from "../types";

export interface ColumnHeaderContextMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: { x: number; y: number };
  column: GridColumnV2 | null;
  sortDirection: "asc" | "desc" | null;
  isPinned: boolean;
  onSortAsc: () => void;
  onSortDesc: () => void;
  onClearSort: () => void;
  onHide: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onCopyColumnName: () => void;
  onFilterByColumn?: () => void;
}

export function ColumnHeaderContextMenu({
  open,
  onOpenChange,
  position,
  column,
  sortDirection,
  isPinned,
  onSortAsc,
  onSortDesc,
  onClearSort,
  onHide,
  onPin,
  onUnpin,
  onCopyColumnName,
  onFilterByColumn,
}: ColumnHeaderContextMenuProps) {
  if (!column) {
    return null;
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuContent
        className="min-w-48 !text-xs p-1"
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
        }}
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowUpDown className="mr-2 h-4 w-4" />
            Sort
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="w-44 !text-xs p-1"
            sideOffset={2}
            alignOffset={-5}
          >
            <DropdownMenuItem onClick={onSortAsc}>
              <ArrowUp className="mr-2 h-4 w-4" />
              Sort Ascending
              {sortDirection === "asc" && (
                <span className="ml-auto text-muted-foreground">✓</span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSortDesc}>
              <ArrowDown className="mr-2 h-4 w-4" />
              Sort Descending
              {sortDirection === "desc" && (
                <span className="ml-auto text-muted-foreground">✓</span>
              )}
            </DropdownMenuItem>
            {sortDirection && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onClearSort}>
                  Clear Sort
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {isPinned ? (
          <DropdownMenuItem onClick={onUnpin}>
            <PinOff className="mr-2 h-4 w-4" />
            Unpin Column
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onPin}>
            <Pin className="mr-2 h-4 w-4" />
            Pin Column
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={onHide}>
          <EyeOff className="mr-2 h-4 w-4" />
          Hide Column
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {onFilterByColumn && (
          <DropdownMenuItem onClick={onFilterByColumn}>
            <Filter className="mr-2 h-4 w-4" />
            Filter by this column
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={onCopyColumnName}>
          <Copy className="mr-2 h-4 w-4" />
          Copy Column Name
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Hook to manage column header context menu state
export interface UseColumnHeaderContextMenuOptions {
  columns: GridColumnV2[];
  pinnedColumns: string[];
  getSortDirection: (columnId: string) => "asc" | "desc" | null;
  onSort: (columnId: string, direction: "asc" | "desc") => void;
  onClearSort: (columnId: string) => void;
  onHide: (columnId: string) => void;
  onPin: (columnId: string) => void;
  onUnpin: (columnId: string) => void;
  onFilterByColumn?: (columnId: string) => void;
}

export interface ColumnHeaderContextMenuState {
  isOpen: boolean;
  column: GridColumnV2 | null;
  position: { x: number; y: number };
}

export function useColumnHeaderContextMenu({
  columns,
  pinnedColumns,
  getSortDirection,
  onSort,
  onClearSort,
  onHide,
  onPin,
  onUnpin,
  onFilterByColumn,
}: UseColumnHeaderContextMenuOptions) {
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
        navigator.clipboard.writeText(menuState.column?.field ?? columnId);
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
    getSortDirection,
    pinnedColumns,
    onSort,
    onClearSort,
    onHide,
    onPin,
    onUnpin,
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
