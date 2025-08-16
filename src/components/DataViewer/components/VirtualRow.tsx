import { useState, memo, useCallback, useRef, useEffect } from "react";
import { flexRender } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Clipboard, ClipboardCheck } from "lucide-react";

interface VirtualRowProps {
  row: any;
  virtualRow: any;
  isSelected: boolean;
  isHighlighted: boolean;
  isSelecting?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onDoubleClick: () => void;
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
  }: VirtualRowProps) => {
    const [copiedCell, setCopiedCell] = useState<string | null>(null);
    const [hoveredCellId, setHoveredCellId] = useState<string | null>(null);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Hide copy button when selection starts
    useEffect(() => {
      if (isSelecting) {
        setHoveredCellId(null);
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }
      }
    }, [isSelecting]);

    // Debounced hover handlers to prevent rapid state changes
    const handleCellEnter = useCallback(
      (cellId: string) => {
        // Don't show copy button when selecting
        if (isSelecting) return;

        // Clear any pending timeout
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }
        // Show after 300ms delay to avoid showing when just moving mouse around
        hoverTimeoutRef.current = setTimeout(() => {
          setHoveredCellId(cellId);
        }, 300);
      },
      [isSelecting],
    );

    const handleCellLeave = useCallback(() => {
      // Clear the show timeout if mouse leaves before delay
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      setHoveredCellId(null);
    }, []);

    return (
      <tr
        className={cn(
          "absolute w-full hover:bg-muted/30 cursor-pointer select-none border-l-2 border-transparent flex",
          isSelected && "bg-primary/10 border-l-primary/60 hover:bg-primary/5",
          isHighlighted && "bg-accent/50",
        )}
        style={{
          height: `${virtualRow.size}px`,
          transform: `translate3d(0, ${virtualRow.start}px, 0)`, // Use 3D transform for GPU acceleration
          contain: "layout style paint", // CSS containment for better performance
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
              className="relative flex items-center px-2 py-1 text-sm border-b border-r border-border/50 box-border"
              style={{
                display: "flex",
                width: cell.column.getSize(),
                minWidth: Math.max(cell.column.getSize(), 100),
                maxWidth: isLastColumn ? undefined : cell.column.getSize(),
                flex: isLastColumn ? "1 1 auto" : "none",
              }}
              onMouseEnter={() => handleCellEnter(cell.id)}
              onMouseLeave={handleCellLeave}
            >
              <div className="overflow-hidden flex-1">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </div>
              {hoveredCellId === cell.id && cell.getValue() !== null && (
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 bg-background/95 hover:bg-accent rounded flex items-center justify-center"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={async (e) => {
                    e.preventDefault();
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

                    try {
                      await navigator.clipboard.writeText(textToCopy);
                      setCopiedCell(cell.id);
                      setTimeout(() => setCopiedCell(null), 3000);
                    } catch (err) {
                      console.error("Failed to copy:", err);
                      // Fallback for older browsers
                      const textArea = document.createElement("textarea");
                      textArea.value = textToCopy;
                      textArea.style.position = "fixed";
                      textArea.style.left = "-999999px";
                      document.body.appendChild(textArea);
                      textArea.focus();
                      textArea.select();
                      try {
                        document.execCommand("copy");
                        setCopiedCell(cell.id);
                        setTimeout(() => setCopiedCell(null), 3000);
                      } catch (err) {
                        console.error("Fallback copy failed:", err);
                      }
                      document.body.removeChild(textArea);
                    }
                  }}
                >
                  {copiedCell === cell.id ? (
                    <ClipboardCheck className="h-4 w-4 text-green-600" />
                  ) : (
                    <Clipboard className="h-4 w-4" />
                  )}
                </button>
              )}
            </td>
          );
        })}
      </tr>
    );
  },
);

VirtualRow.displayName = "VirtualRow";
