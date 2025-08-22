import { useState, memo, useCallback } from "react";
import { flexRender, type Row, type Cell } from "@tanstack/react-table";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Clipboard, ClipboardCheck, Edit2 } from "lucide-react";
import { DataCell, type ColumnMeta } from "@/components/cells";
import styles from "./VirtualRow.module.css";

interface VirtualRowProps {
  row: Row<any>;
  virtualRow: VirtualItem;
  isSelected: boolean;
  isHighlighted: boolean;
  isSelecting?: boolean;
  selectedCell?: { rowId: string; columnId: string } | null;
  editingCell?: { rowId: string; columnId: string } | null;
  cellValues?: Map<string, any>;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onDoubleClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  columnVirtualizer?: Virtualizer<HTMLDivElement, Element>;
  shouldVirtualizeColumns?: boolean;
  onCellClick?: (
    rowId: string,
    columnId: string,
    event: React.MouseEvent,
  ) => void;
  onCellDoubleClick?: (
    rowId: string,
    columnId: string,
    event: React.MouseEvent,
  ) => void;
  onEditButtonClick?: (
    rowId: string,
    columnId: string,
    event: React.MouseEvent,
  ) => void;
  onCellValueChange?: (rowId: string, columnId: string, value: any) => void;
  onEditComplete?: () => void;
  onCellKeyDown?: (
    event: React.KeyboardEvent,
    rowId: string,
    columnId: string,
  ) => void;
}

// Proper comparison function for memoization
const areEqual = (prev: VirtualRowProps, next: VirtualRowProps): boolean => {
  // Compare only the props that should trigger re-render
  const baseEqual = 
    prev.row.id === next.row.id &&
    prev.isSelected === next.isSelected &&
    prev.isHighlighted === next.isHighlighted &&
    prev.virtualRow.start === next.virtualRow.start &&
    prev.virtualRow.size === next.virtualRow.size &&
    prev.selectedCell?.rowId === next.selectedCell?.rowId &&
    prev.selectedCell?.columnId === next.selectedCell?.columnId &&
    prev.editingCell?.rowId === next.editingCell?.rowId &&
    prev.editingCell?.columnId === next.editingCell?.columnId &&
    prev.isSelecting === next.isSelecting;
  
  if (!baseEqual) return false;
  
  // Check if cell values for this row have changed
  if (prev.cellValues === next.cellValues) return true;
  if (!prev.cellValues || !next.cellValues) return false;
  
  const rowKeys = Array.from(prev.cellValues.keys()).filter(k => k.startsWith(prev.row.id));
  return rowKeys.every(key => prev.cellValues?.get(key) === next.cellValues?.get(key));
};

const VirtualRowComponent = ({
    row,
    virtualRow,
    isSelected,
    isHighlighted,
    isSelecting = false,
    selectedCell,
    editingCell,
    cellValues,
    onMouseDown,
    onMouseEnter,
    onDoubleClick,
    onContextMenu,
    columnVirtualizer,
    shouldVirtualizeColumns = false,
    onCellClick,
    onCellDoubleClick,
    onEditButtonClick,
    onCellValueChange,
    onEditComplete,
    onCellKeyDown,
  }: VirtualRowProps) => {
    const [copiedCell, setCopiedCell] = useState<string | null>(null);
    // Removed hoveredCell state - using CSS hover instead

    // Simplified copy handler without hover state management
    const handleCopy = useCallback(async (cell: Cell<any, unknown>) => {
      const value = cell.getValue();
      let textToCopy = "";

      if (value === null) {
        textToCopy = "NULL";
      } else if (typeof value === "object") {
        textToCopy = JSON.stringify(value, null, 2);
      } else {
        textToCopy = String(value);
      }

      try {
        await navigator.clipboard.writeText(textToCopy);
        setCopiedCell(cell.id);
        setTimeout(() => {
          setCopiedCell(null);
        }, 2000);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    }, []);

    return (
      <tr
        className={cn(
          "absolute w-full hover:bg-muted/30 cursor-pointer select-none border-l-2 border-transparent flex",
          isSelected && "bg-primary/10 border-l-primary/60 hover:bg-primary/5",
          isHighlighted && "bg-primary/20",
        )}
        style={{
          height: `${virtualRow.size}px`,
          transform: `translate3d(0, ${virtualRow.start}px, 0)`, // Use 3D transform for GPU acceleration
          contain: "layout style paint", // CSS containment for better performance
        }}
        onMouseDown={onMouseDown}
        onMouseEnter={onMouseEnter}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        {shouldVirtualizeColumns && columnVirtualizer ? (
          // Column virtualization enabled - render only visible columns
          <>
            {/* Spacer for columns before virtual range */}
            {(() => {
              const virtualItems = columnVirtualizer.getVirtualItems();
              const firstItem = virtualItems[0];
              
              // Check if editing cell is before the virtual range
              let editingCellBeforeRange = false;
              let editingCellIndex = -1;
              
              if (editingCell?.rowId === row.id && firstItem) {
                const cells = row.getVisibleCells();
                editingCellIndex = cells.findIndex(c => c.column.id === editingCell.columnId);
                editingCellBeforeRange = editingCellIndex >= 0 && editingCellIndex < firstItem.index;
              }
              
              const spacerWidth = firstItem?.start || 0;
              
              // If editing cell is before range, render it in the spacer area
              if (editingCellBeforeRange && editingCellIndex >= 0) {
                const editingCellData = row.getVisibleCells()[editingCellIndex];
                const columnSize = editingCellData.column.getSize();
                const finalColumnSize = Math.max(columnSize, 80);
                const columnId = editingCellData.column.id;
                const columnMeta = editingCellData.column.columnDef.meta as ColumnMeta;
                const cellKey = `${row.id}-${columnId}`;
                const editedValue = cellValues?.get(cellKey);
                const cellValue = editedValue !== undefined ? editedValue : editingCellData.getValue();
                
                return (
                  <>
                    {spacerWidth > finalColumnSize && (
                      <td
                        style={{
                          width: spacerWidth - finalColumnSize,
                          minWidth: spacerWidth - finalColumnSize,
                          maxWidth: spacerWidth - finalColumnSize,
                          padding: 0,
                          border: "none",
                          backgroundColor: "transparent",
                          fontSize: 0,
                          lineHeight: 0,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <td
                      key={editingCellData.id}
                      className={cn(
                        "relative flex items-center px-2 py-1 text-xs border-b border-border/50 box-border",
                        "ring-2 ring-primary ring-offset-0 bg-background z-20",
                        styles.cell,
                      )}
                      style={{
                        display: "flex",
                        width: finalColumnSize,
                        minWidth: finalColumnSize,
                        maxWidth: finalColumnSize,
                        flex: "none",
                        flexShrink: 0,
                      }}
                      onKeyDown={(e) => onCellKeyDown?.(e, row.id, columnId)}
                    >
                      <div className="overflow-hidden flex-1 truncate">
                          <DataCell
                            value={cellValue as string | number | boolean | null}
                            columnMeta={columnMeta}
                            isEditing={true}
                            onChange={(value) => onCellValueChange?.(row.id, columnId, value)}
                            onEditComplete={onEditComplete}
                          />
                      </div>
                    </td>
                  </>
                );
              }
              
              return spacerWidth > 0 ? (
                <td
                  style={{
                    width: spacerWidth,
                    minWidth: spacerWidth,
                    maxWidth: spacerWidth,
                    padding: 0,
                    border: "none",
                    backgroundColor: "transparent",
                    fontSize: 0,
                    lineHeight: 0,
                    flexShrink: 0,
                  }}
                />
              ) : null;
            })()}
            {columnVirtualizer.getVirtualItems().map((virtualColumn) => {
              const cell = row.getVisibleCells()[virtualColumn.index];
              if (!cell) return null;
              
              // Skip if this is the editing cell and we already rendered it
              const columnId = cell.column.id;
              if (editingCell?.rowId === row.id && editingCell?.columnId === columnId) {
                const virtualItems = columnVirtualizer.getVirtualItems();
                const firstItem = virtualItems[0];
                if (firstItem && virtualColumn.index < firstItem.index) {
                  return null; // Already rendered in spacer
                }
              }

              // Use the column's actual size, not the virtualizer's size
              const columnSize = cell.column.getSize();
              // Ensure minimum width of 80px for all cells
              const finalColumnSize = Math.max(columnSize, 80);
              const columnMeta = cell.column.columnDef.meta as ColumnMeta;
              const isCellSelected =
                selectedCell?.rowId === row.id &&
                selectedCell.columnId === columnId;
              const isCellEditing =
                editingCell?.rowId === row.id &&
                editingCell.columnId === columnId;
              const dbType = columnMeta.db_type ? columnMeta.db_type.toLowerCase() : null;
              const isDateColumn = dbType ? (dbType.includes("date") || dbType.includes("time")) : false;
              const showEditButton = !isCellEditing && !isDateColumn;

              // Get the edited value if it exists
              const cellKey = `${row.id}-${columnId}`;
              const editedValue = cellValues?.get(cellKey);
              const cellValue = editedValue !== undefined ? editedValue : cell.getValue();

              return (
                <td
                  key={cell.id}
                  className={cn(
                    "relative flex items-center px-2 py-1 text-xs border-b border-border/50 box-border",
                    !isCellEditing && "border-r",
                    styles.cell,
                    isSelecting && styles.selecting,
                    isCellSelected &&
                      !isCellEditing &&
                      "border border-primary z-10",
                    isCellEditing &&
                      "ring-2 ring-primary ring-offset-0 bg-background z-20",
                  )}
                  style={{
                    display: "flex",
                    width: finalColumnSize,
                    minWidth: finalColumnSize,
                    maxWidth: finalColumnSize,
                    flex: "none",
                    flexShrink: 0,
                  }}
                  onClick={(e) => onCellClick?.(row.id, columnId, e)}
                  onDoubleClick={(e) =>
                    onCellDoubleClick?.(row.id, columnId, e)
                  }
                  onKeyDown={(e) => onCellKeyDown?.(e, row.id, columnId)}
                >
                  <div className="overflow-hidden flex-1 truncate">
                    {isCellEditing ? (
                      cell.column.columnDef.meta ? (
                        <DataCell
                          value={cellValue as string | number | boolean | null}
                          columnMeta={cell.column.columnDef.meta as ColumnMeta}
                          isEditing={true}
                          onChange={(value) =>
                            onCellValueChange?.(row.id, columnId, value)
                          }
                          onEditComplete={onEditComplete}
                        />
                      ) : (
                        // Fallback to StringCell if no metadata
                        <DataCell
                          value={cellValue as string | number | boolean | null}
                          columnMeta={{ name: columnId, db_type: "text", nullable: true }}
                          isEditing={true}
                          onChange={(value) =>
                            onCellValueChange?.(row.id, columnId, value)
                          }
                          onEditComplete={onEditComplete}
                        />
                      )
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    )}
                  </div>
                  {!isCellEditing && (
                    <>
                      {showEditButton && (
                        <button
                          type="button"
                          className={cn(styles["cell-btn"], styles.editButton)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) =>
                            onEditButtonClick?.(row.id, columnId, e)
                          }
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                      )}
                      {cell.getValue() !== null && (
                        <button
                          type="button"
                          className={cn(styles["cell-btn"], styles.copyButton)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleCopy(cell);
                          }}
                        >
                          {copiedCell === cell.id ? (
                            <ClipboardCheck className="h-3 w-3 text-green-600" />
                          ) : (
                            <Clipboard className="h-3 w-3" />
                          )}
                        </button>
                      )}
                    </>
                  )}
                </td>
              );
            })}
            {/* Spacer for columns after virtual range */}
            {(() => {
              const virtualItems = columnVirtualizer.getVirtualItems();
              const lastItem = virtualItems[virtualItems.length - 1];
              
              // Check if editing cell is after the virtual range
              let editingCellAfterRange = false;
              let editingCellIndex = -1;
              
              if (editingCell?.rowId === row.id && lastItem) {
                const cells = row.getVisibleCells();
                editingCellIndex = cells.findIndex(c => c.column.id === editingCell.columnId);
                editingCellAfterRange = editingCellIndex >= 0 && editingCellIndex > lastItem.index;
              }
              
              const remainingWidth = lastItem
                ? columnVirtualizer.getTotalSize() - lastItem.end
                : 0;
              
              // If editing cell is after range, render it in the spacer area
              if (editingCellAfterRange && editingCellIndex >= 0) {
                const editingCellData = row.getVisibleCells()[editingCellIndex];
                if (!editingCellData) return null;
                const columnSize = editingCellData.column.getSize();
                const finalColumnSize = Math.max(columnSize, 80);
                const columnId = editingCellData.column.id;
                const columnMeta = editingCellData.column.columnDef.meta as ColumnMeta;
                const cellKey = `${row.id}-${columnId}`;
                const editedValue = cellValues?.get(cellKey);
                const cellValue = editedValue !== undefined ? editedValue : editingCellData.getValue();
                
                return (
                  <>
                    <td
                      key={editingCellData.id}
                      className={cn(
                        "relative flex items-center px-2 py-1 text-xs border-b border-border/50 box-border",
                        "ring-2 ring-primary ring-offset-0 bg-background z-20",
                        styles.cell,
                      )}
                      style={{
                        display: "flex",
                        width: finalColumnSize,
                        minWidth: finalColumnSize,
                        maxWidth: finalColumnSize,
                        flex: "none",
                        flexShrink: 0,
                      }}
                      onKeyDown={(e) => onCellKeyDown?.(e, row.id, columnId)}
                    >
                      <div className="overflow-hidden flex-1 truncate">
                          <DataCell
                            value={cellValue as string | number | boolean | null}
                            columnMeta={columnMeta}
                            isEditing={true}
                            onChange={(value) => onCellValueChange?.(row.id, columnId, value)}
                            onEditComplete={onEditComplete}
                          />
                      </div>
                    </td>
                    {remainingWidth > finalColumnSize && (
                      <td
                        style={{
                          width: remainingWidth - finalColumnSize,
                          minWidth: remainingWidth - finalColumnSize,
                          maxWidth: remainingWidth - finalColumnSize,
                          padding: 0,
                          border: "none",
                          backgroundColor: "transparent",
                          fontSize: 0,
                          lineHeight: 0,
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </>
                );
              }
              
              return remainingWidth > 0 ? (
                <td
                  style={{
                    width: remainingWidth,
                    minWidth: remainingWidth,
                    maxWidth: remainingWidth,
                    padding: 0,
                    border: "none",
                    backgroundColor: "transparent",
                    fontSize: 0,
                    lineHeight: 0,
                    flexShrink: 0,
                  }}
                />
              ) : null;
            })()}
          </>
        ) : (
          // Standard rendering - all columns visible
          row.getVisibleCells().map((cell, index) => {
            const isLastColumn = index === row.getVisibleCells().length - 1;
            const columnId = cell.column.id;
            const isCellSelected =
              (selectedCell?.rowId === row.id &&
              selectedCell?.columnId === columnId) || false;
            const isCellEditing =
              (editingCell?.rowId === row.id &&
              editingCell?.columnId === columnId) || false;
            const columnMeta = cell.column.columnDef.meta as ColumnMeta;
            const dbType = columnMeta.db_type ? columnMeta.db_type.toLowerCase() : null;
            const isDateColumn = dbType ? (dbType.includes("date") || dbType.includes("time")) : false;
            const showEditButton = !isCellEditing && !isDateColumn;

            // Get the edited value if it exists
            const cellKey = `${row.id}-${columnId}`;
            const editedValue = cellValues?.get(cellKey);
            const cellValue = editedValue !== undefined ? editedValue : cell.getValue();

            return (
              <td
                key={cell.id}
                className={cn(
                  "relative flex items-center px-2 py-1 text-xs border-b border-border/50 box-border",
                  !isCellEditing && "border-r",
                  styles.cell,
                  isSelecting && styles.selecting,
                  isCellSelected &&
                    !isCellEditing &&
                    "border border-primary z-10",
                  isCellEditing &&
                    "ring-2 ring-primary ring-offset-0 bg-background z-20",
                )}
                style={{
                  display: "flex",
                  width: isLastColumn ? undefined : cell.column.getSize(),
                  minWidth: Math.max(cell.column.getSize(), 100),
                  maxWidth: isLastColumn ? undefined : cell.column.getSize(),
                  flex: isLastColumn ? "1 1 auto" : "0 0 auto",
                }}
                onClick={(e) => onCellClick?.(row.id, columnId, e)}
                onDoubleClick={(e) => onCellDoubleClick?.(row.id, columnId, e)}
                onKeyDown={(e) => onCellKeyDown?.(e, row.id, columnId)}
              >
                <div className="overflow-hidden flex-1 truncate">
                  {isCellEditing ? (
                    cell.column.columnDef.meta ? (
                      <DataCell
                        value={cellValue}
                        columnMeta={cell.column.columnDef.meta as ColumnMeta}
                        isEditing={true}
                        onChange={(value) =>
                          onCellValueChange?.(row.id, columnId, value)
                        }
                        onEditComplete={onEditComplete}
                      />
                    ) : (
                      // Fallback to StringCell if no metadata
                      <DataCell
                        value={cellValue}
                        columnMeta={{ name: columnId, db_type: "text", nullable: true }}
                        isEditing={true}
                        onChange={(value) =>
                          onCellValueChange?.(row.id, columnId, value)
                        }
                        onEditComplete={onEditComplete}
                      />
                    )
                  ) : (
                    flexRender(cell.column.columnDef.cell, cell.getContext())
                  )}
                </div>
                {!isCellEditing && (
                  <>
                    {showEditButton && (
                      <button
                        type="button"
                        className={cn(styles["cell-btn"], styles.editButton)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) =>
                          onEditButtonClick?.(row.id, columnId, e)
                        }
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                    )}
                    {cell.getValue() !== null && (
                      <button
                        type="button"
                        className={cn(styles["cell-btn"], styles.copyButton)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleCopy(cell);
                        }}
                      >
                        {copiedCell === cell.id ? (
                          <ClipboardCheck className="h-3 w-3 text-green-600" />
                        ) : (
                          <Clipboard className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </>
                )}
              </td>
            );
          })
        )}
      </tr>
    );
  };

// Export memoized component with proper comparison
export const VirtualRow = memo(VirtualRowComponent, areEqual);

VirtualRow.displayName = "VirtualRow";
