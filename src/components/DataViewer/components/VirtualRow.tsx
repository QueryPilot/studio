import { useState } from "react";
import { flexRender } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Copy, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VirtualRowProps {
  row: any;
  virtualRow: any;
  isSelected: boolean;
  isHighlighted: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onDoubleClick: () => void;
}

export const VirtualRow = ({
  row,
  virtualRow,
  isSelected,
  isHighlighted,
  onMouseDown,
  onMouseEnter,
  onDoubleClick,
}: VirtualRowProps) => {
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  
  return (
  <tr
    className={cn(
      "absolute w-full hover:bg-muted/30 cursor-pointer select-none border-l-2 border-transparent",
      isSelected && "bg-primary/10 border-l-primary/60 hover:bg-primary/5",
      isHighlighted && "bg-accent/50",
    )}
    style={{
      display: 'flex',
      height: `${virtualRow.size}px`,
      transform: `translateY(${virtualRow.start}px)`,
      willChange: "transform",
      userSelect: "none",
    }}
    onMouseDown={onMouseDown}
    onMouseEnter={onMouseEnter}
    onDoubleClick={onDoubleClick}
  >
    {row.getVisibleCells().map((cell: any, index: number) => {
      const isLastColumn = index === row.getVisibleCells().length - 1;
      return (
        <td
          key={cell.id}
          className="group flex items-center px-1.5 py-0.5 text-xs border-b border-r border-border/50 box-border"
          style={{
            display: 'flex',
            width: cell.column.getSize(),
            minWidth: Math.max(cell.column.getSize(), 100),
            maxWidth: isLastColumn ? undefined : cell.column.getSize(),
            flex: isLastColumn ? "1 1 auto" : "none",
          }}
        >
          <div className="overflow-hidden flex-1">
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
            onClick={(e) => {
              e.stopPropagation();
              const value = cell.getValue();
              let textToCopy = "";
              if (value === null) {
                textToCopy = "NULL";
              } else if (typeof value === "object") {
                textToCopy = JSON.stringify(value, null, 2);
              } else {
                textToCopy = String(value);
              }
              navigator.clipboard.writeText(textToCopy);
              setCopiedCell(cell.id);
              setTimeout(() => setCopiedCell(null), 3000);
            }}
          >
            {copiedCell === cell.id ? (
              <ClipboardCheck className="h-3 w-3 text-green-600" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </td>
      );
    })}
  </tr>
  );
};

VirtualRow.displayName = "VirtualRow";
