import { useState, useMemo, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { GridColumnV2, GridRowModel } from "../types";
import type { DatabaseType } from "@/types/database";
import { RowDetailsSheet } from "./RowDetailsSheet";
import { GridContextMenuItems } from "./GridContextMenuItems";

export interface GridContextMenuProps {
  children: ReactNode;
  selectedRows: GridRowModel[];
  selectedRowKeys: string[];
  allRows: GridRowModel[];
  columns: GridColumnV2[];
  pinnedRowKeys: string[];
  maxPinnedRows?: number;
  tableName?: string;
  schema?: string;
  databaseType?: DatabaseType;
  onPinRows?: (rowKeys: string[]) => void;
  onUnpinRows?: (rowKeys: string[]) => void;
  onAddRow?: () => void;
  onDeleteRows?: () => void;
  onPaste?: () => void;
  showDetailsSheet?: boolean;
  onShowDetailsSheetChange?: (show: boolean) => void;
}

export function GridContextMenu({
  children,
  selectedRows,
  selectedRowKeys,
  allRows: _allRows,
  columns,
  pinnedRowKeys,
  maxPinnedRows = 5,
  tableName = "table",
  schema,
  databaseType = "postgresql",
  onPinRows,
  onUnpinRows,
  onAddRow,
  onDeleteRows,
  onPaste,
  showDetailsSheet: controlledShowDetailsSheet,
  onShowDetailsSheetChange,
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

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className="h-full w-full block">
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48 text-xs p-1">
          <GridContextMenuItems
            selectedRows={selectedRows}
            selectedRowKeys={selectedRowKeys}
            columns={columns}
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
