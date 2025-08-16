import { memo } from "react";

interface SkeletonRowProps {
  virtualRow: any;
  columnCount: number;
}

export const SkeletonRow = memo(({ virtualRow, columnCount }: SkeletonRowProps) => (
  <tr
    className="absolute w-full animate-pulse"
    style={{
      display: 'flex',
      height: `${virtualRow.size}px`,
      transform: `translateY(${virtualRow.start}px)`,
      willChange: "transform",
    }}
  >
    {Array.from({ length: columnCount }).map((_, index) => (
      <td
        key={index}
        className="flex items-center px-2 py-1 border-b border-r border-border/50"
        style={{
          display: 'flex',
          width: `${100 / columnCount}%`,
        }}
      >
        <div className="h-4 bg-muted/50 rounded w-3/4"></div>
      </td>
    ))}
  </tr>
));

SkeletonRow.displayName = "SkeletonRow";