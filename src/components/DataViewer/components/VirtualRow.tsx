import { useState, memo, useCallback } from "react";
import { flexRender } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Clipboard, ClipboardCheck } from "lucide-react";
import styles from "./VirtualRow.module.css";

interface VirtualRowProps {
  row: any;
  virtualRow: any;
  isSelected: boolean;
  isHighlighted: boolean;
  isSelecting?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onDoubleClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  columnVirtualizer?: any; // Optional column virtualizer for performance
  shouldVirtualizeColumns?: boolean;
}

export const VirtualRow = memo(
  ({
    row,
    virtualRow,
    isSelected,
    isHighlighted,
    isSelecting = false,
    onMouseDown,
    onMouseEnter,
    onDoubleClick,
    onContextMenu,
    columnVirtualizer,
    shouldVirtualizeColumns = false,
  }: VirtualRowProps) => {
    const [copiedCell, setCopiedCell] = useState<string | null>(null);
    
    // Simplified copy handler without hover state management
    const handleCopy = useCallback(async (cell: any) => {
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
        setTimeout(() => setCopiedCell(null), 2000);
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
              const firstItem = columnVirtualizer.getVirtualItems()[0];
              const spacerWidth = firstItem?.start || 0;
              return spacerWidth > 0 ? (
                <td
                  style={{
                    width: spacerWidth,
                    minWidth: spacerWidth,
                    maxWidth: spacerWidth,
                    padding: 0,
                    border: 'none',
                    backgroundColor: 'transparent',
                    fontSize: 0,
                    lineHeight: 0,
                    flexShrink: 0,
                  }}
                />
              ) : null;
            })()}
            {columnVirtualizer.getVirtualItems().map((virtualColumn: any) => {
              const cell = row.getVisibleCells()[virtualColumn.index];
              if (!cell) return null;
              
              const isLastColumn = virtualColumn.index === row.getVisibleCells().length - 1;
              // Use the column's actual size, not the virtualizer's size
              const columnSize = cell.column.getSize();
              // Ensure minimum width of 80px for all cells
              const finalColumnSize = Math.max(columnSize, 80);
              return (
                <td
                  key={cell.id}
                  className={cn(
                    "relative flex items-center px-2 py-1 text-xs border-b border-r border-border/50 box-border",
                    styles.cell,
                    isSelecting && styles.selecting
                  )}
                  style={{
                    display: "flex",
                    width: finalColumnSize,
                    minWidth: finalColumnSize,
                    maxWidth: finalColumnSize,
                    flex: "none",
                    flexShrink: 0,
                  }}
                >
                  <div className="overflow-hidden flex-1 truncate">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                  {cell.getValue() !== null && (
                    <button
                      type="button"
                      className={styles.copyButton}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleCopy(cell);
                      }}
                    >
                      {copiedCell === cell.id ? (
                        <ClipboardCheck className="h-3 w-3 text-green-600" />
                      ) : (
                        <Clipboard className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </td>
              );
            })}
            {/* Spacer for columns after virtual range */}
            {(() => {
              const lastItem = columnVirtualizer.getVirtualItems()[columnVirtualizer.getVirtualItems().length - 1];
              const remainingWidth = lastItem ? columnVirtualizer.getTotalSize() - lastItem.end : 0;
              return remainingWidth > 0 ? (
                <td
                  style={{
                    width: remainingWidth,
                    minWidth: remainingWidth,
                    maxWidth: remainingWidth,
                    padding: 0,
                    border: 'none',
                    backgroundColor: 'transparent',
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
          row.getVisibleCells().map((cell: any, index: number) => {
            const isLastColumn = index === row.getVisibleCells().length - 1;
            return (
              <td
                key={cell.id}
                className={cn(
                  "relative flex items-center px-2 py-1 text-xs border-b border-r border-border/50 box-border",
                  styles.cell,
                  isSelecting && styles.selecting
                )}
                style={{
                  display: "flex",
                  width: isLastColumn ? undefined : cell.column.getSize(),
                  minWidth: Math.max(cell.column.getSize(), 100),
                  maxWidth: isLastColumn ? undefined : cell.column.getSize(),
                  flex: isLastColumn ? "1 1 auto" : "0 0 auto",
                }}
              >
                <div className="overflow-hidden flex-1 truncate">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
                {cell.getValue() !== null && (
                  <button
                    type="button"
                    className={styles.copyButton}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCopy(cell);
                    }}
                  >
                    {copiedCell === cell.id ? (
                      <ClipboardCheck className="h-3 w-3 text-green-600" />
                    ) : (
                      <Clipboard className="h-3 w-3" />
                    )}
                  </button>
                )}
              </td>
            );
          })
        )}
      </tr>
    );
  },
);

VirtualRow.displayName = "VirtualRow";
