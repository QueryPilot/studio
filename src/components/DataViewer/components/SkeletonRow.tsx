import { memo } from "react";
import { Column } from "@tanstack/react-table";

interface SkeletonRowProps {
  virtualRow: any;
  columns: Column<any>[];
}

export const SkeletonRow = memo(({ virtualRow, columns }: SkeletonRowProps) => (
  <tr
    className="absolute w-full animate-pulse"
    style={{
      display: 'flex',
      height: `${virtualRow.size}px`,
      transform: `translateY(${virtualRow.start}px)`,
      willChange: "transform",
    }}
  >
    {columns.map((column) => (
      <td
        key={column.id}
        className="flex items-center px-2 py-1 border-b border-r border-border/50"
        style={{
          display: 'flex',
          width: `${column.getSize()}px`,
          flexShrink: 0,
        }}
      >
        <div className="h-4 bg-muted/50 rounded w-3/4"></div>
      </td>
    ))}
  </tr>
));

SkeletonRow.displayName = "SkeletonRow";