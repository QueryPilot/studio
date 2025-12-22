import { memo, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ColumnStats } from "../utils/columnStats";
import { formatNumber, formatPercentage } from "../utils/columnStats";

interface ColumnStatsPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnName: string;
  stats: ColumnStats;
  bounds: { x: number; y: number; width: number; height: number };
}

export const ColumnStatsPopover = memo(function ColumnStatsPopover({
  open,
  onOpenChange,
  columnName,
  stats,
  bounds,
}: ColumnStatsPopoverProps) {
  const hasNumericStats =
    stats.min !== undefined && stats.max !== undefined && stats.avg !== undefined;
  const hasStringStats =
    stats.minLength !== undefined && stats.maxLength !== undefined;

  const nullPercentage = formatPercentage(stats.nullCount, stats.totalRows);

  // Create a virtual trigger element at the bounds position
  const triggerStyle = useMemo(
    () => ({
      position: "fixed" as const,
      left: `${bounds.x}px`,
      top: `${bounds.y}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      pointerEvents: "none" as const,
      opacity: 0,
    }),
    [bounds],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger style={triggerStyle} />
      <PopoverContent
        side="bottom"
        align="start"
        className="w-64 p-3 text-xs"
        onPointerDown={(e) => {
          // Prevent closing when interacting with content
          e.stopPropagation();
        }}
      >
        <div className="space-y-2">
          <div className="font-semibold text-foreground border-b border-border pb-1.5">
            Column: {columnName}
          </div>

          <div className="space-y-1.5">
            <StatRow label="Total rows" value={formatNumber(stats.totalRows, 0)} />
            <StatRow
              label="NULL values"
              value={`${formatNumber(stats.nullCount, 0)} (${nullPercentage})`}
            />
            <StatRow
              label="Distinct"
              value={formatNumber(stats.distinctCount, 0)}
            />
          </div>

          {hasNumericStats && (
            <>
              <div className="border-t border-border pt-1.5" />
              <div className="space-y-1.5">
                <StatRow label="Min" value={formatNumber(stats.min!, 2)} />
                <StatRow label="Max" value={formatNumber(stats.max!, 2)} />
                <StatRow label="Avg" value={formatNumber(stats.avg!, 2)} />
              </div>
            </>
          )}

          {hasStringStats && (
            <>
              <div className="border-t border-border pt-1.5" />
              <div className="space-y-1.5">
                <StatRow
                  label="Min length"
                  value={formatNumber(stats.minLength!, 0)}
                />
                <StatRow
                  label="Max length"
                  value={formatNumber(stats.maxLength!, 0)}
                />
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});

interface StatRowProps {
  label: string;
  value: string;
}

const StatRow = memo(function StatRow({ label, value }: StatRowProps) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
});
