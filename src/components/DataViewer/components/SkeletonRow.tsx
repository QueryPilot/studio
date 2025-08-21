import { memo } from "react";
import type { Column } from "@tanstack/react-table";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";

interface SkeletonRowProps {
  virtualRow: VirtualItem;
  columns: Column<any>[];
  columnVirtualizer?: Virtualizer<HTMLDivElement, Element>;
  shouldVirtualizeColumns?: boolean;
}

export const SkeletonRow = memo(
  ({
    virtualRow,
    columns,
    columnVirtualizer,
    shouldVirtualizeColumns = false,
  }: SkeletonRowProps) => (
    <tr
      className="absolute w-full animate-pulse"
      style={{
        display: "flex",
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
        willChange: "transform",
      }}
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
            const column = columns[virtualColumn.index];
            if (!column) return null;
            // Use the column's actual size, not the virtualizer's size
            const columnSize = column.getSize();
            // Ensure minimum width of 80px for all skeleton cells
            const finalColumnSize = Math.max(columnSize, 80);

            return (
              <td
                key={column.id}
                className="flex items-center px-2 py-1 border-b border-r border-border/50"
                style={{
                  display: "flex",
                  width: finalColumnSize,
                  minWidth: finalColumnSize,
                  maxWidth: finalColumnSize,
                  flex: "none",
                  flexShrink: 0,
                }}
              >
                <div className="h-4 bg-muted/50 rounded w-3/4"></div>
              </td>
            );
          })}
          {/* Spacer for columns after virtual range */}
          {(() => {
            const lastItem =
              columnVirtualizer.getVirtualItems()[
                columnVirtualizer.getVirtualItems().length - 1
              ];
            const remainingWidth = lastItem
              ? columnVirtualizer.getTotalSize() - lastItem.end
              : 0;
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
        columns.map((column, index) => {
          const isLastColumn = index === columns.length - 1;
          return (
            <td
              key={column.id}
              className="flex items-center px-2 py-1 border-b border-r border-border/50"
              style={{
                display: "flex",
                width: isLastColumn ? undefined : column.getSize(),
                minWidth: column.getSize(),
                maxWidth: isLastColumn ? undefined : column.getSize(),
                flex: isLastColumn ? "1 1 auto" : "0 0 auto",
              }}
            >
              <div className="h-4 bg-muted/50 rounded w-3/4"></div>
            </td>
          );
        })
      )}
    </tr>
  ),
);

SkeletonRow.displayName = "SkeletonRow";
