import { useState, useCallback, useMemo, type ReactNode, type RefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { GridColumnV2, GridRowModel } from "../types";
import type { DatabaseType } from "@/types";
import type { DataParadigm } from "../utils/copyUtils";
import { GridContextMenuItems } from "./GridContextMenuItems";
import { ColumnHeaderContextMenuItems } from "./ColumnHeaderContextMenuItems";
import { writeClipboardText } from "@/lib/clipboard";

export type ContextMenuTarget =
  | { type: "header"; columnIndex: number; column: GridColumnV2 }
  | { type: "cell"; columnIndex: number; rowIndex: number }
  | { type: "out-of-bounds" }
  | null;

export interface UnifiedContextMenuProps {
  children: ReactNode;
  // Row context menu props
  selectedRows: GridRowModel[];
  selectedRowKeys: string[];
  allRows: GridRowModel[];
  columns: GridColumnV2[];
  selectedColumns?: GridColumnV2[];
  pinnedRowKeys: string[];
  maxPinnedRows?: number;
  tableName?: string;
  schema?: string;
  databaseType?: DatabaseType;
  /** Data paradigm for context-aware copy options */
  paradigm?: DataParadigm;
  onPinRows?: (rowKeys: string[]) => void;
  onUnpinRows?: (rowKeys: string[]) => void;
  onAddRow?: () => void;
  onInsertRowAbove?: () => void;
  onInsertRowBelow?: () => void;
  onDuplicateRows?: () => void;
  onDeleteRows?: () => void;
  onPaste?: () => void;
  onViewDetails?: (rows: GridRowModel[]) => void;
  // Header context menu props
  allColumnsForVisibility?: GridColumnV2[];
  pinnedColumns: string[];
  columnVisibility: Record<string, boolean>;
  getSortDirection: (columnId: string) => "asc" | "desc" | null;
  onSort: (columnId: string, direction: "asc" | "desc") => void;
  onClearSort: (columnId: string) => void;
  onHideColumn: (columnId: string) => void;
  onPinColumn: (columnId: string) => void;
  onUnpinColumn: (columnId: string) => void;
  onToggleColumnVisibility: (columnId: string) => void;
  onShowAllColumns: () => void;
  onFilterByColumn?: (columnId: string) => void;
  // Callbacks
  onOpen?: () => void;
  // Ref to track what's being hovered (updated by onItemHovered in parent)
  contextMenuTargetRef: RefObject<ContextMenuTarget>;
  // FK embedding props
  connectionId?: string;
  referencedTableColumns?: Record<string, Array<{ name: string; db_type: string }>>;
}

export function UnifiedContextMenu({
  children,
  selectedRows,
  selectedRowKeys,
  allRows,
  columns,
  selectedColumns,
  pinnedRowKeys,
  maxPinnedRows = 5,
  tableName = "table",
  schema,
  databaseType = "postgresql",
  paradigm = "sql",
  onPinRows,
  onUnpinRows,
  onAddRow,
  onInsertRowAbove,
  onInsertRowBelow,
  onDuplicateRows,
  onDeleteRows,
  onPaste,
  onViewDetails,
  allColumnsForVisibility,
  pinnedColumns,
  columnVisibility,
  getSortDirection,
  onSort,
  onClearSort,
  onHideColumn,
  onPinColumn,
  onUnpinColumn,
  onToggleColumnVisibility,
  onShowAllColumns,
  onFilterByColumn,
  onOpen,
  contextMenuTargetRef,
  connectionId,
  referencedTableColumns,
}: UnifiedContextMenuProps) {
  const [menuTarget, setMenuTarget] = useState<ContextMenuTarget>(null);

  // Derive effective selection: if no explicit selection but right-clicking on a cell,
  // use that row as the contextual selection for the menu
  const effectiveSelectedRows = useMemo(() => {
    if (selectedRows.length > 0) {
      return selectedRows;
    }
    const target = menuTarget;
    if (target?.type === 'cell' && target.rowIndex >= 0) {
      const hoveredRow = allRows[target.rowIndex];
      if (hoveredRow) {
        return [hoveredRow];
      }
    }
    return [];
  }, [selectedRows, menuTarget, allRows]);

  // Derive effective row keys to match
  const effectiveSelectedRowKeys = useMemo(() => {
    if (selectedRowKeys.length > 0) {
      return selectedRowKeys;
    }
    const target = menuTarget;
    if (effectiveSelectedRows.length > 0 && target?.type === 'cell') {
      // Use row index as fallback key
      return [`__contextual_row_${target.rowIndex}`];
    }
    return [];
  }, [selectedRowKeys, effectiveSelectedRows, menuTarget]);

  const handleViewDetails = useCallback(() => {
    onViewDetails?.(effectiveSelectedRows);
  }, [onViewDetails, effectiveSelectedRows]);

  // Calculate row menu props
  const selectedPinnedKeys = effectiveSelectedRowKeys.filter((key) => pinnedRowKeys.includes(key));
  const selectedUnpinnedKeys = effectiveSelectedRowKeys.filter((key) => !pinnedRowKeys.includes(key));
  const canPinMore = pinnedRowKeys.length < maxPinnedRows;

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      // Capture hovered target exactly once when the menu opens.
      setMenuTarget(contextMenuTargetRef.current ?? null);
      onOpen?.();
    } else {
      setMenuTarget(null);
    }
  }, [onOpen, contextMenuTargetRef]);

  // Get current header column for header menu
  const currentHeaderColumn = menuTarget?.type === "header" ? menuTarget.column : null;
  const headerColumnId = currentHeaderColumn?.id ?? "";
  const sortDirection = currentHeaderColumn ? getSortDirection(headerColumnId) : null;
  const isColumnPinned = currentHeaderColumn ? pinnedColumns.includes(headerColumnId) : false;

  return (
    <>
      <ContextMenu onOpenChange={handleOpenChange}>
        <ContextMenuTrigger className="h-full w-full block">
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64 text-xs p-1">
          {menuTarget?.type === "header" && currentHeaderColumn ? (
            <ColumnHeaderContextMenuItems
              column={currentHeaderColumn}
              sortDirection={sortDirection}
              isPinned={isColumnPinned}
              allColumns={allColumnsForVisibility ?? columns}
              columnVisibility={columnVisibility}
              onSortAsc={() => { onSort(headerColumnId, "asc"); }}
              onSortDesc={() => { onSort(headerColumnId, "desc"); }}
              onClearSort={() => { onClearSort(headerColumnId); }}
              onHide={() => { onHideColumn(headerColumnId); }}
              onPin={() => { onPinColumn(headerColumnId); }}
              onUnpin={() => { onUnpinColumn(headerColumnId); }}
              onCopyColumnName={() => {
                void writeClipboardText(currentHeaderColumn.name);
              }}
              onToggleColumnVisibility={onToggleColumnVisibility}
              onShowAllColumns={onShowAllColumns}
              onFilterByColumn={onFilterByColumn ? () => { onFilterByColumn(headerColumnId); } : undefined}
              connectionId={connectionId}
              schema={schema}
              tableName={tableName}
              referencedTableColumns={referencedTableColumns?.[currentHeaderColumn.name]}
            />
          ) : (
            <GridContextMenuItems
              selectedRows={effectiveSelectedRows}
              selectedRowKeys={effectiveSelectedRowKeys}
              columns={columns}
              selectedColumns={selectedColumns}
              pinnedRowKeys={pinnedRowKeys}
              selectedPinnedKeys={selectedPinnedKeys}
              selectedUnpinnedKeys={selectedUnpinnedKeys}
              canPinMore={canPinMore}
              tableName={tableName}
              schema={schema}
              databaseType={databaseType}
              paradigm={paradigm}
              onViewDetails={handleViewDetails}
              onPinRows={onPinRows}
              onUnpinRows={onUnpinRows}
              onAddRow={onAddRow}
              onInsertRowAbove={onInsertRowAbove}
              onInsertRowBelow={onInsertRowBelow}
              onDuplicateRows={onDuplicateRows}
              onDeleteRows={onDeleteRows}
              onPaste={onPaste}
            />
          )}
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}
