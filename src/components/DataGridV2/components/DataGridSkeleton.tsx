import { memo, useEffect, useState, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export const DataGridSkeleton = memo(function DataGridSkeleton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRows, setVisibleRows] = useState(40); // Default to 40 rows

  useEffect(() => {
    // Calculate how many rows can fit in the viewport
    const calculateVisibleRows = () => {
      if (containerRef.current) {
        const containerHeight = containerRef.current.clientHeight;
        const headerHeight = 28; // V2 uses 28px
        const rowHeight = 28; // V2 uses 28px
        const padding = 16;
        const availableHeight = containerHeight - headerHeight - padding;
        const rows = Math.floor(availableHeight / rowHeight);
        setVisibleRows(Math.max(rows, 20)); // At least 20 rows
      }
    };

    calculateVisibleRows();

    // Recalculate on resize
    const resizeObserver = new ResizeObserver(calculateVisibleRows);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Number of columns to show
  const columnCount = 8;

  return (
    <div ref={containerRef} className="flex flex-col h-full w-full">
      {/* Header skeleton */}
      <div className="flex-none border-b bg-muted/30 h-7 px-1">
        <div className="flex gap-1 h-full items-center">
          {[...Array(columnCount)].map((_, i) => (
            <Skeleton key={i} className="h-5 flex-1 min-w-[80px] max-w-[180px]" />
          ))}
        </div>
      </div>

      {/* Body skeleton - fills the viewport */}
      <div className="flex-1 overflow-hidden">
        <div className="space-y-0">
          {[...Array(visibleRows)].map((_, i) => (
            <div
              key={i}
              className="flex gap-1 px-1 border-b border-border/5"
              style={{ height: '28px' }}
            >
              {[...Array(columnCount)].map((_, j) => (
                <div key={j} className="flex-1 min-w-[80px] max-w-[180px] py-1">
                  <Skeleton
                    className="h-full w-full"
                    style={{
                      animationDelay: `${(i * 50 + j * 30) % 1000}ms`,
                      opacity: 0.3 + (Math.random() * 0.4)
                    }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Status bar skeleton */}
      <div className="flex-none border-t bg-muted/30 h-6 px-2">
        <div className="flex items-center justify-between h-full">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    </div>
  );
});