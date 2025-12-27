import { useState, useMemo, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { GridColumnV2, GridRowModel } from "../types";
import type { DatabaseType } from "@/types";
import { RowDetailsSheet } from "./RowDetailsSheet";
import { GridContextMenuItems } from "./GridContextMenuItems";

export interface GridContextMenuProps {
  children: ReactNode;
  selectedRows: GridRowModel[];
  selectedRowKeys: string[];
  allRows: GridRowModel[];
  columns: GridColumnV2[];
  /** Columns in the current cell selection (for "Copy cells" - subset of columns) */
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
  /** When true or returns true, prevents the context menu from opening (e.g., when header menu is active) */
  disabled?: boolean | (() => boolean);
  /** Called when the context menu opens */
  onOpen?: () => void;
}

export function GridContextMenu({
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
  disabled = false,
  onOpen,
}: GridContextMenuProps) {
  const [internalShowDetailsSheet, setInternalShowDetailsSheet] =
    useState(false);

  // Use controlled state if provided, otherwise use internal state
  const showDetailsSheet =
    controlledShowDetailsSheet ?? internalShowDetailsSheet;
  const setShowDetailsSheet =
    onShowDetailsSheetChange ?? setInternalShowDetailsSheet;

  const handleViewDetails = () => {
    setShowDetailsSheet(true);
  };

  const selectedPinnedKeys = useMemo(
    () => selectedRowKeys.filter((key) => pinnedRowKeys.includes(key)),
    [selectedRowKeys, pinnedRowKeys],
  );

  const selectedUnpinnedKeys = useMemo(
    () => selectedRowKeys.filter((key) => !pinnedRowKeys.includes(key)),
    [selectedRowKeys, pinnedRowKeys],
  );

  const canPinMore = pinnedRowKeys.length < maxPinnedRows;

  // Handle open state changes - call onOpen when menu opens
  const handleOpenChange = (open: boolean) => {
    if (open && onOpen) {
      onOpen();
    }
  };

  // Prevent context menu from opening when disabled (e.g., header context menu is active)
  const handleContextMenu = (e: React.MouseEvent) => {
    const isDisabled = typeof disabled === "function" ? disabled() : disabled;
    if (isDisabled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <>
      <ContextMenu onOpenChange={handleOpenChange}>
        <ContextMenuTrigger className="h-full w-full block" onContextMenu={handleContextMenu}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56 text-xs p-1">
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
        </ContextMenuContent>
      </ContextMenu>

      {/* Row Details Sheet */}
      <RowDetailsSheet
        open={showDetailsSheet}
        onOpenChange={setShowDetailsSheet}
        rows={selectedRows}
        columns={columns}
      />
    </>
  );
}
