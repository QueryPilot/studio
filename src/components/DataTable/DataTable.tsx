/**
 * Enhanced DataTable component with selection, context menu, and keyboard navigation
 */
import { memo, useRef, useState, useCallback, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
// import { Clipboard, ClipboardCheck } from "lucide-react"; // Icons not currently used
import { useVirtualization } from "./hooks/useVirtualization";
// import { useSelection } from "./hooks/useSelection"; // TEMPORARILY DISABLED
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
// import { useDragSelection } from "./hooks/useDragSelection"; // TEMPORARILY DISABLED
import { TableHeader } from "./components/TableHeader";
import { TableCell } from "./components/TableCell";
import { TableSkeleton } from "./components/TableSkeleton";
import { ContextMenu } from "./components/ContextMenu";
import {
  type DataTableProps,
  type DataTableRow,
  type CellValue,
  type CopyFormat,
} from "./types";

const DataTable = memo(function InnerDataTable({
  data,
  columns,
  isLoading,
  rowIdField,
  onLoadMore,
  hasNextPage,
  selectedRows: _externalSelectedRows,
  onRowSelect: _onRowSelect,
  onCellEdit,
  editableColumns,
  onRowDelete,
  onCopyRows,
  showPreviewPanel: _showPreviewPanel,
  previewMode: _previewMode,
  onPreviewModeChange: _onPreviewModeChange,
}: DataTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const [sortColumn, setSortColumn] = useState<string>();
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [_hoveredCell, _setHoveredCell] = useState<string | null>(null);
  const [_copiedFormat, _setCopiedFormat] = useState<string | null>(null);
  // const [showPreview, setShowPreview] = useState(false); // TODO: Implement preview panel

  // Setup virtualization
  const { virtualRows, virtualColumns, totalHeight, totalWidth } =
    useVirtualization({
      rowCount: data.length,
      columns,
      scrollElement: scrollElementRef,
    });

  // Fallback when column virtualizer hasn't measured yet
  const fallbackColumns = useMemo(() => {
    if (virtualColumns.length > 0) return null;
    let acc = 0;
    const items = columns.map((col, index) => {
      const size = col.width || 150;
      const start = acc;
      acc += size;
      return { index, start, size } as const;
    });
    return { items, width: acc };
  }, [virtualColumns, columns]);

  // Fallback when row virtualizer hasn't measured yet
  const fallbackRows = useMemo(() => {
    if (virtualRows.length > 0) return null;
    return data.map((_, index) => ({
      index,
      start: index * 32,
      size: 32,
    }));
  }, [virtualRows, data]);

  // Setup selection - TEMPORARILY DISABLED
  // const {
  //   selectedRows: _internalSelectedRows,
  //   selectedRowsData,
  //   selectionMode,
  //   isSelecting,
  //   focusedCell,
  //   selectAllRows,
  //   handleRowClick,
  //   selectCell,
  //   handleCellClick,
  //   clearSelection,
  //   startDragSelection,
  //   updateDragSelection,
  //   endDragSelection,
  //   navigateCell,
  //   isRowSelected,
  //   isCellSelected,
  //   isCellFocused,
  // } = useSelection({
  //   data,
  //   rowIdField,
  //   onSelectionChange: useCallback(
  //     (rows: Set<string>, _cells: Set<string>) => {
  //       const areSetsEqual = (a: Set<string>, b: Set<string>) => {
  //         if (a.size !== b.size) return false;
  //         for (const v of a) if (!b.has(v)) return false;
  //         return true;
  //       };

  //       if (areSetsEqual(rows, externalSelectedRows)) return;

  //       onRowSelect(
  //         Array.from(rows)
  //           .map((rowId) =>
  //             data.find((row) => String(row[rowIdField]?.value) === rowId),
  //           )
  //           .filter((r): r is DataTableRow => Boolean(r)),
  //         "single",
  //       );
  //     },
  //     [externalSelectedRows, onRowSelect, data, rowIdField],
  //   ),
  // });
  
  // Temporary stubs for disabled selection
  const selectedRowsData: DataTableRow[] = [];
  // const _isSelecting = false; // unused
  // const _focusedCell = null as string | null; // unused
  const isRowSelected = (_rowId: string) => false;
  const isCellSelected = (_cellId: string) => false;
  const isCellFocused = (_cellId: string) => false;
  const navigateCell = () => {};
  const selectAllRows = () => {};
  const clearSelection = () => {};
  const selectCell = (_cellId: string) => {};

  // Use external or internal selected rows - TEMPORARILY DISABLED
  // const selectedRows = externalSelectedRows;
  // const _selectedRows = externalSelectedRows; // unused

  // Setup drag selection - TEMPORARILY DISABLED
  // const { isDragging, selectionBox } = useDragSelection({
  //   enabled: true,
  //   containerRef,
  //   onSelectionStart: (elementId, isCell) => {
  //     startDragSelection(elementId, isCell);
  //   },
  //   onSelectionUpdate: (elementId) => {
  //     updateDragSelection(elementId);
  //   },
  //   onSelectionEnd: () => {
  //     endDragSelection();
  //   },
  // });
  // const _isDragging = false; // unused
  // const _selectionBox = null as { left: number; top: number; width: number; height: number } | null; // unused

  // Handle sorting
  const handleSort = useCallback(
    (columnId: string, direction: "asc" | "desc") => {
      setSortColumn(columnId);
      setSortDirection(direction);
      // TODO: Implement actual sorting logic based on backend requirements
    },
    [],
  );

  // Handle cell editing
  const handleStartEdit = useCallback(
    (rowId: string, columnId: string) => {
      if (editableColumns?.has(columnId) !== false) {
        setEditingCell(`${rowId}:${columnId}`);
        selectCell(`${rowId}:${columnId}`);
      }
    },
    [editableColumns, selectCell],
  );

  const handleCellEdit = useCallback(
    (rowId: string, columnId: string, newValue: CellValue) => {
      setEditingCell(null);
      onCellEdit(rowId, columnId, newValue);
    },
    [onCellEdit],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingCell(null);
  }, []);

  // Handle cell copy
  const handleCellCopy = useCallback((value: CellValue) => {
    if (value.value !== null) {
      const v: unknown = value.value;
      const text =
        v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
      void navigator.clipboard.writeText(text);
    }
  }, []);

  // Handle copy with format
  const handleCopyRows = useCallback(
    (format: CopyFormat) => {
      onCopyRows(selectedRowsData, format);
      
      // Show copied feedback
      _setCopiedFormat(format);
      setTimeout(() => {
        _setCopiedFormat(null);
      }, 3000);

      // Also copy to clipboard
      let clipboardText = "";

      switch (format) {
        case "json": {
          clipboardText = JSON.stringify(
            selectedRowsData.map((row) => {
              const obj: Record<string, unknown> = {};
              Object.entries(row).forEach(([key, value]) => {
                obj[key] = value.value;
              });
              return obj;
            }),
            null,
            2,
          );
          break;
        }

        case "csv": {
          const headers = columns.map((col) => col.name).join(",");
          const rows = selectedRowsData
            .map((row) =>
              columns
                .map((col) => {
                  const v: unknown = row[col.id]?.value;
                  const raw =
                    v !== null && typeof v === "object"
                      ? JSON.stringify(v)
                      : typeof v === "string"
                      ? v
                      : typeof v === "number" || typeof v === "boolean"
                      ? String(v)
                      : "";
                  return raw.includes(",") ||
                    raw.includes('"') ||
                    raw.includes("\n")
                    ? `"${raw.replace(/"/g, '""')}"`
                    : raw;
                })
                .join(","),
            )
            .join("\n");
          clipboardText = `${headers}\n${rows}`;
          break;
        }

        case "insert": {
          // TODO: Implement INSERT statement generation
          clipboardText = "-- INSERT statements not yet implemented";
          break;
        }
      }

      if (clipboardText) {
        void navigator.clipboard.writeText(clipboardText);
      }
    },
    [selectedRowsData, columns, onCopyRows],
  );

  // Handle delete
  const handleDelete = useCallback(() => {
    onRowDelete(selectedRowsData);
  }, [selectedRowsData, onRowDelete]);

  // Handle preview toggle
  const handleTogglePreview = useCallback(() => {
    // TODO: Implement preview panel toggle
    console.log("Toggle preview panel");
  }, []);

  // Setup keyboard navigation
  useKeyboardNavigation({
    enabled: true,
    containerRef,
    onNavigate: navigateCell,
    onSelectAll: selectAllRows,
    onClearSelection: clearSelection,
    onDelete: handleDelete,
    onCopy: (format) => {
      handleCopyRows(format || "json");
    },
    onStartEdit: () => {
      // Temporarily disabled with selection
      // if (focusedCell) {
      //   const [rowId, columnId] = focusedCell.split(":");
      //   if (rowId && columnId) {
      //     handleStartEdit(rowId, columnId);
      //   }
      // }
    },
    onCancelEdit: handleCancelEdit,
    onTogglePreview: handleTogglePreview,
  });

  // Throttled scroll handler for performance
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollTopRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollElement = e.currentTarget;
    const headerElement = headerScrollRef.current;
    
    // Sync horizontal scroll with header immediately for smooth experience
    if (headerElement) {
      headerElement.scrollLeft = scrollElement.scrollLeft;
    }
    
    // Throttle vertical scroll handling for infinite loading
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      if (!hasNextPage || isLoading || isLoadingMoreRef.current) return;
      
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
      
      // Only check for load more if scrolling down and near bottom
      if (scrollTop > lastScrollTopRef.current && scrollPercentage > 0.9) {
        console.log("[DataTable] Triggering loadMore, scrollPercentage:", scrollPercentage);
        isLoadingMoreRef.current = true;
        onLoadMore();
        // Reset flag after a delay to allow next load
        setTimeout(() => {
          isLoadingMoreRef.current = false;
        }, 1000);
      }
      lastScrollTopRef.current = scrollTop;
    }, 200); // Increased throttle time
  }, [hasNextPage, isLoading, onLoadMore]);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Get row ID helper
  const getRowId = useCallback(
    (row: DataTableRow): string => {
      const idVal: unknown = row[rowIdField]?.value;
      if (idVal === null || idVal === undefined) return "";
      if (typeof idVal === "object") return JSON.stringify(idVal);
      if (typeof idVal === "string") return idVal;
      if (typeof idVal === "number" || typeof idVal === "boolean")
        return String(idVal);
      return "";
    },
    [rowIdField],
  );

  // Loading state
  if (isLoading && data.length === 0) {
    return <TableSkeleton columns={columns} />;
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full overflow-hidden outline-none"
      tabIndex={0}
    >
      {/* Sticky Header with horizontal scroll sync */}
      <div 
        ref={headerScrollRef} 
        className="overflow-x-auto overflow-y-hidden flex-shrink-0" 
        style={{ 
          scrollbarWidth: 'none', 
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <TableHeader
          columns={columns}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
        />
      </div>

      {/* Virtualized Table Body with Context Menu */}
      <ContextMenu
        selectedRows={selectedRowsData}
        onCopy={handleCopyRows}
        onDelete={handleDelete}
        onOpenPreview={handleTogglePreview}
        className="flex-1 min-h-0 flex flex-col"
      >
        <div
          ref={scrollElementRef}
          className="flex-1 overflow-auto"
          onScroll={handleScroll}
        >
          <div
            className="relative"
            style={{
              height: Math.max(totalHeight, data.length * 32, 100),
              width: Math.max(fallbackColumns ? fallbackColumns.width : totalWidth, 1200),
              minHeight: 100,
              paddingBottom: 8,
              paddingRight: 8,
            }}
          >
            {/* Render visible rows */}
            {(virtualRows.length > 0 ? virtualRows : fallbackRows || []).map(
              (virtualRow: { index: number; start: number; size: number }) => {
                const row = data[virtualRow.index];
                if (!row) return null;

                const rowId = getRowId(row);
                const isRowSelectedState = isRowSelected(rowId);

                return (
                  <div
                    key={`row-${virtualRow.index}`}
                    data-row-id={rowId}
                    className={cn(
                      "absolute flex border-b cursor-pointer transition-colors",
                      isRowSelectedState
                        ? "bg-primary/10 dark:bg-primary/10"
                        : "hover:bg-primary/5",
                      virtualRow.index % 2 === 0
                        ? "bg-background"
                        : "bg-muted/10",
                      // isSelecting && "select-none", // TEMPORARILY DISABLED
                    )}
                    style={{
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                      width: "100%",
                    }}
                    onClick={(_e) => {
                      // Selection temporarily disabled
                      // handleRowClick(rowId, _e);
                    }}
                  >
                    {/* Render visible cells */}
                    {(virtualColumns.length > 0
                      ? virtualColumns
                      : fallbackColumns?.items || []
                    ).map(
                      (virtualColumn: {
                        index: number;
                        start: number;
                        size: number;
                      }) => {
                        const colIndex = virtualColumn.index;
                        const column = columns[colIndex];
                        if (!column) return null;

                        // Robust cell lookup: try direct id, then case-insensitive match
                        let cellValue = row[column.id];
                        if (!cellValue) {
                          const altKey = Object.keys(row).find(
                            (k) => k.toLowerCase() === column.id.toLowerCase(),
                          );
                          if (altKey) cellValue = row[altKey];
                        }
                        if (!cellValue) {
                          // Render an empty placeholder cell to preserve layout
                          return (
                            <div
                              key={`cell-${virtualRow.index}-${virtualColumn.index}`}
                              className={cn("border-r last:border-r-0")}
                              style={{
                                position: "absolute",
                                left: virtualColumn.start,
                                width: virtualColumn.size,
                                height: "100%",
                              }}
                            />
                          );
                        }

                        const cellId = `${rowId}:${column.id}`;
                        const isEditing = editingCell === cellId;
                        const isHovered = _hoveredCell === cellId;
                        const isCellSelectedState = isCellSelected(cellId);
                        const isFocused = isCellFocused(cellId);

                        return (
                          <div
                            key={`cell-${virtualRow.index}-${virtualColumn.index}`}
                            data-cell-id={cellId}
                            className={cn(
                              "border-r last:border-r-0",
                              isCellSelectedState &&
                                "bg-primary/10",
                              isFocused && "ring-2 ring-primary ring-inset",
                            )}
                            style={{
                              position: "absolute",
                              left: virtualColumn.start,
                              width: virtualColumn.size,
                              height: "100%",
                            }}
                            // onClick temporarily disabled
                            // onClick={(_e) => {
                            //   if (selectionMode === "cell") {
                            //     _e.stopPropagation();
                            //     handleCellClick(cellId, _e);
                            //   }
                            // }}
                            // Removed onMouseEnter/Leave to improve performance
                          >
                            <TableCell
                              value={cellValue}
                              rowId={rowId}
                              columnId={column.id}
                              isSelected={
                                isRowSelectedState || isCellSelectedState
                              }
                              isEditing={isEditing}
                              isHovered={isHovered}
                              onEdit={(newValue) => {
                                handleCellEdit(rowId, column.id, newValue);
                              }}
                              onCopy={() => {
                                handleCellCopy(cellValue);
                              }}
                              onStartEdit={() => {
                                handleStartEdit(rowId, column.id);
                              }}
                              onCancelEdit={handleCancelEdit}
                              column={column}
                              rowIndex={virtualRow.index}
                              columnIndex={virtualColumn.index}
                            />
                          </div>
                        );
                      },
                    )}
                  </div>
                );
              },
            )}

            {/* Drag selection box overlay - TEMPORARILY DISABLED */}
            {/* {isDragging && selectionBox && (
              <div
                className="absolute border-2 border-primary bg-primary/10 pointer-events-none z-50"
                style={{
                  left: selectionBox.left,
                  top: selectionBox.top,
                  width: selectionBox.width,
                  height: selectionBox.height,
                }}
              />
            )} */}

            {/* Loading indicator for infinite scroll */}
            {isLoading && data.length > 0 && (
              <div
                className="absolute bottom-0 left-0 right-0 flex justify-center py-4"
                style={{
                  transform: `translateY(${totalHeight}px)`,
                }}
              >
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            )}
          </div>
        </div>
      </ContextMenu>

      {/* Empty state */}
      {!isLoading && data.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="text-lg font-medium mb-2">No data available</p>
            <p className="text-sm">
              The table is empty or no results match your criteria
            </p>
          </div>
        </div>
      )}

      {/* Selection info bar - temporarily disabled */}
    </div>
  );
});

export { DataTable };
