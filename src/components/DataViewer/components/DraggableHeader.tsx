import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { flexRender } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { ColumnContextMenu } from "./ColumnContextMenu";

interface DraggableHeaderProps {
  column: any;
  header: any;
  onHideColumn?: (columnId: string) => void;
  virtualSize?: number;
}

export const DraggableHeader = memo(
  ({ column, header, onHideColumn, virtualSize }: DraggableHeaderProps) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id: column.id,
    });

    const isLastColumn = header.column.getIsLastColumn();
    // Always use the column's actual size for consistency
    const columnWidth = header.getSize();
    // Ensure minimum width of 80px for all headers
    const finalColumnWidth = Math.max(columnWidth, 80) + 0.3;
    const style = {
      transform: transform ? `translateX(${transform.x}px)` : undefined,
      transition,
      opacity: isDragging ? 0.5 : 1,
      cursor: isDragging ? "grabbing" : "grab",
      width: finalColumnWidth,
      minWidth: finalColumnWidth,
      maxWidth: isLastColumn ? undefined : finalColumnWidth,
      flex: virtualSize ? "none" : isLastColumn ? "1 1 auto" : "none",
    };

    const headerElement = (
      <th
        ref={setNodeRef}
        style={{
          ...style,
          display: "flex",
        }}
        className="relative flex items-center text-left text-xs bg-muted/50 border-r border-border/50 box-border"
        {...attributes}
      >
        <div
          className="flex items-center justify-between w-full px-2 py-0.5 h-7"
          {...listeners}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
        </div>

        {!header.isPlaceholder && header.column.getCanResize() && (
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              header.getResizeHandler()(e);
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              header.getResizeHandler()(e);
            }}
            className={cn(
              "absolute -right-0.5 top-0 h-full w-1 cursor-col-resize select-none touch-none z-20",
              "hover:bg-primary/50",
              header.column.getIsResizing() && "bg-primary",
            )}
            onClick={(e) => {
              e.stopPropagation();
            }}
          />
        )}
      </th>
    );

    // Only wrap in context menu if onHideColumn is provided
    if (onHideColumn) {
      return (
        <ColumnContextMenu columnId={column.id} onHideColumn={onHideColumn}>
          {headerElement}
        </ColumnContextMenu>
      );
    }

    return headerElement;
  },
);

DraggableHeader.displayName = "DraggableHeader";
