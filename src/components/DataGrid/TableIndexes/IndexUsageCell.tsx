import { memo } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { type IndexUsageStats } from "@/services/backend";

interface IndexUsageCellProps {
  indexName: string;
  usageStats?: Map<string, IndexUsageStats>;
  isLoading?: boolean;
}

export const IndexUsageCell = memo(function IndexUsageCell({
  indexName,
  usageStats,
  isLoading = false,
}: IndexUsageCellProps) {
  const stats = usageStats?.get(indexName);

  if (!stats) {
    return isLoading ? (
      <Skeleton className="h-4 w-16 inline-block" />
    ) : (
      <span className="text-muted-foreground">-</span>
    );
  }

  const displayValue = stats.is_unused
    ? "Unused"
    : stats.scan_count?.toLocaleString() || "Active";

  const colorClass = stats.is_unused
    ? "text-red-600 dark:text-red-400"
    : stats.scan_count && stats.scan_count < 100
    ? "text-yellow-600 dark:text-yellow-400"
    : "text-green-600 dark:text-green-400";

  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <span className={`${colorClass} font-medium cursor-help text-xs`}>
          {displayValue}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto p-3" side="top" align="end">
        <div className="space-y-1.5">
          <div className="font-semibold text-sm mb-2">
            Index Usage Statistics
          </div>
          {stats.scan_count !== undefined && (
            <div className="text-xs flex justify-between gap-4">
              <span className="text-muted-foreground">Scans:</span>
              <span className="font-mono">
                {stats.scan_count.toLocaleString()}
              </span>
            </div>
          )}
          {stats.last_used && (
            <div className="text-xs flex justify-between gap-4">
              <span className="text-muted-foreground">Last Used:</span>
              <span className="font-mono">{formatTimeAgo(stats.last_used)}</span>
            </div>
          )}
          {stats.rows_read !== undefined && (
            <div className="text-xs flex justify-between gap-4">
              <span className="text-muted-foreground">Rows Read:</span>
              <span className="font-mono">
                {stats.rows_read.toLocaleString()}
              </span>
            </div>
          )}
          {stats.cache_hit_ratio !== undefined && (
            <div className="text-xs flex justify-between gap-4">
              <span className="text-muted-foreground">Cache Hit:</span>
              <span className="font-mono">
                {stats.cache_hit_ratio.toFixed(1)}%
              </span>
            </div>
          )}
          {stats.efficiency_score !== undefined && (
            <div className="text-xs flex justify-between gap-4">
              <span className="text-muted-foreground">Efficiency:</span>
              <span className="font-mono">{stats.efficiency_score}/100</span>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
});

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}