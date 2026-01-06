import { useState, useCallback, type ReactNode, type MutableRefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { GridColumnV2, GridRowModel } from "../types";
import type { DatabaseType } from "@/types";
import { RowDetailsSheet } from "./RowDetailsSheet";
import { GridContextMenuItems } from "./GridContextMenuItems";
import { ColumnHeaderContextMenuItems } from "./ColumnHeaderContextMenuItems";

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
  onPinRows?: (rowKeys: string[]) => void;
  onUnpinRows?: (rowKeys: string[]) => void;
  onAddRow?: () => void;
  onInsertRowAbove?: () => void;
  onInsertRowBelow?: () => void;
  onDeleteRows?: () => void;
  onPaste?: () => void;
  showDetailsSheet?: boolean;
  onShowDetailsSheetChange?: (show: boolean) => void;
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
  contextMenuTargetRef: MutableRefObject<ContextMenuTarget>;
  // FK embedding props
  connectionId?: string;
  referencedTableColumns?: Record<string, Array<{ name: string; db_type: string }>>;
}

export function UnifiedContextMenu({
  children,
  selectedRows,
  selectedRowKeys,
  allRows: _allRows,
  columns,
  selectedColumns,
  pinnedRowKeys,
  maxPinnedRows = 5,
  tableName = "table",
  schema,
  databaseType = "postgresql",
  onPinRows,
  onUnpinRows,
  onAddRow,
  onInsertRowAbove,
  onInsertRowBelow,
  onDeleteRows,
  onPaste,
  showDetailsSheet: controlledShowDetailsSheet,
  onShowDetailsSheetChange,
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
  const [internalShowDetailsSheet, setInternalShowDetailsSheet] = useState(false);
  const [menuTarget, setMenuTarget] = useState<ContextMenuTarget>(null);

  const showDetailsSheet = controlledShowDetailsSheet ?? internalShowDetailsSheet;
  const setShowDetailsSheet = onShowDetailsSheetChange ?? setInternalShowDetailsSheet;

  const handleViewDetails = () => {
    setShowDetailsSheet(true);
  };

  // Calculate row menu props
  const selectedPinnedKeys = selectedRowKeys.filter((key) => pinnedRowKeys.includes(key));
  const selectedUnpinnedKeys = selectedRowKeys.filter((key) => !pinnedRowKeys.includes(key));
  const canPinMore = pinnedRowKeys.length < maxPinnedRows;

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      // When menu opens, capture what was last hovered from the ref
      setMenuTarget(contextMenuTargetRef.current);
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
        <ContextMenuContent className="w-56 text-xs p-1">
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
                navigator.clipboard.writeText(currentHeaderColumn.name ?? currentHeaderColumn.field ?? headerColumnId);
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
              selectedRows={selectedRows}
              selectedRowKeys={selectedRowKeys}
              columns={columns}
              selectedColumns={selectedColumns}
              pinnedRowKeys={pinnedRowKeys}
              selectedPinnedKeys={selectedPinnedKeys}
              selectedUnpinnedKeys={selectedUnpinnedKeys}
              canPinMore={canPinMore}
              tableName={tableName}
              schema={schema}
              databaseType={databaseType}
              onViewDetails={handleViewDetails}
              onPinRows={onPinRows}
              onUnpinRows={onUnpinRows}
              onAddRow={onAddRow}
              onInsertRowAbove={onInsertRowAbove}
              onInsertRowBelow={onInsertRowBelow}
              onDeleteRows={onDeleteRows}
              onPaste={onPaste}
            />
          )}
        </ContextMenuContent>
      </ContextMenu>

      <RowDetailsSheet
        open={showDetailsSheet}
        onOpenChange={setShowDetailsSheet}
        rows={selectedRows}
        columns={columns}
      />
    </>
  );
}
