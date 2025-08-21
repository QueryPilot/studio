import { memo } from "react";

export const TableSkeleton = memo(() => (
  <div className="h-full overflow-hidden bg-background">
    <div className="h-full border border-border/50 bg-card">
      <div className="overflow-hidden">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/50">
          <div className="flex w-full">
            {Array.from({ length: 10 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center px-2 py-2 border-r border-border/50 bg-muted/30 animate-pulse flex-1 min-w-0"
              >
                <div className="h-4 bg-muted/50 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative">
          {Array.from({ length: 5 }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="flex animate-pulse border-b border-border/50 w-full"
              style={{ height: "33px" }}
            >
              {Array.from({ length: 10 }).map((_, colIndex) => (
                <div
                  key={colIndex}
                  className="flex items-center px-2 py-1 border-r border-border/50 flex-1 min-w-0"
                >
                  <div className="h-4 bg-muted/50 rounded w-3/4"></div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
));

TableSkeleton.displayName = "TableSkeleton";