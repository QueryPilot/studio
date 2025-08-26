import { memo } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export const DataGridSkeleton = memo(function DataGridSkeleton() {
  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-none border-b bg-muted/30 px-2 py-1.5">
        <div className="flex gap-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-7 flex-1 min-w-[100px] max-w-[200px]" />
          ))}
        </div>
      </div>

      <div className="flex-1 p-2 space-y-1 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <div key={i} className="flex gap-2">
            {[...Array(6)].map((_, j) => (
              <Skeleton key={j} className="h-7 flex-1 min-w-[100px] max-w-[200px]" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});