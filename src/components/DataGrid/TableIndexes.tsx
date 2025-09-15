import { memo, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { AlertCircle, KeyRound, Hash, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { databaseService, type TableIndex } from "@/services/databaseService";
import { type IndexUsageStats } from "@/services/backend";

interface TableIndexesProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

export const TableIndexes = memo(function TableIndexes({
  connectionId,
  database,
  table,
  schema,
}: TableIndexesProps) {
  const [indexes, setIndexes] = useState<TableIndex[]>([]);
  const [usageStats, setUsageStats] = useState<Map<string, IndexUsageStats>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchIndexes() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await databaseService.tableIndexes(
          connectionId,
          database,
          schema || "public",
          table,
        );
        setIndexes(result);

        // Fetch usage stats separately (non-blocking)
        setStatsLoading(true);
        try {
          console.log("Fetching index usage stats for:", {
            connectionId,
            table,
          });
          const stats = await databaseService.getIndexUsageStats(
            connectionId,
            table,
          );
          console.log("Received index usage stats:", stats);
          const statsMap = new Map<string, IndexUsageStats>();
          stats.forEach((stat) => {
            statsMap.set(stat.index_name, stat);
          });
          setUsageStats(statsMap);
          console.log("Stats map:", Array.from(statsMap.entries()));
        } catch (err) {
          // Log the error for debugging
          console.error("Could not fetch index usage stats:", err);
        } finally {
          setStatsLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load indexes");
        console.error("Failed to fetch table indexes:", err);
      } finally {
        setIsLoading(false);
      }
    }

    void fetchIndexes();
  }, [connectionId, database, schema, table]);

  if (isLoading) {
    return <TableIndexesSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load indexes</h3>
        <p className="text-sm text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full border-separate border-spacing-0">
        <thead className="sticky top-0 z-10 bg-muted border-b border-border">
          <tr className="text-xs" style={{ height: "28px" }}>
            <th className="text-left px-2 py-1 w-10 border-r border-border font-semibold text-foreground/80">
              #
            </th>
            <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80">
              Index Name
            </th>
            <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80">
              Columns
            </th>
            <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80">
              Type
            </th>
            <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80">
              Unique
            </th>
            <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80">
              Condition
            </th>
            <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80">
              Size
            </th>
            <th className="text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80">
              Usage
            </th>
          </tr>
        </thead>
        <tbody>
          {indexes.length === 0 ? (
            <tr>
              <td colSpan={8} className="text-center py-8">
                <div className="flex flex-col items-center justify-center">
                  <Hash className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-semibold mb-2 text-foreground/70">
                    No indexes found
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md text-center">
                    This table doesn't have any indexes defined.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            indexes.map((index, i) => (
              <tr
                key={index.name}
                className={cn(
                  "hover:bg-primary/10 transition-colors text-xs border-b border-r",
                  i % 2 === 0 && "bg-muted/10",
                )}
                style={{ height: "28px" }}
              >
                <td className="px-1.5 py-0.5 border-b border-r text-muted-foreground">
                  {i + 1}
                </td>
                <td className="px-1.5 py-0.5 border-b border-r font-medium text-foreground/80 dark:text-foreground/70 whitespace-nowrap">
                  <div className="flex items-center justify-between">
                    <span className={index.primary ? "font-semibold" : ""}>
                      {index.name}
                    </span>
                    <div className="flex items-center gap-1">
                      {index.primary && (
                        <KeyRound className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
                      )}
                      {index.unique && !index.primary && (
                        <Hash className="h-3 w-3 text-blue-600 dark:text-blue-500" />
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-1.5 py-0.5 border-b border-r text-foreground/80 dark:text-foreground/65 font-mono text-xs whitespace-nowrap">
                  {index.columns.join(", ")}
                </td>
                <td className="px-1.5 py-0.5 border-b border-r text-foreground/80 dark:text-foreground/65 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs">
                      {index.index_type}
                    </span>
                    {index.index_type === "btree" && (
                      <TrendingUp className="h-3 w-3 text-green-600 dark:text-green-500 opacity-70" />
                    )}
                  </div>
                </td>
                <td className="px-1.5 py-0.5 border-b border-r whitespace-nowrap">
                  <span
                    className={cn(
                      "inline-flex px-1.5 py-0 rounded text-xs",
                      index.unique
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
                    )}
                  >
                    {index.unique ? "UNIQUE" : "NO"}
                  </span>
                </td>
                <td className="px-1.5 py-0.5 border-b border-r text-foreground/60 dark:text-foreground/50 text-xs italic whitespace-nowrap">
                  {index.condition || "-"}
                </td>
                <td className="px-1.5 py-0.5 border-b border-r text-foreground/70 dark:text-foreground/60 text-xs text-right font-mono whitespace-nowrap">
                  {(() => {
                    const stats = usageStats.get(index.name);
                    return stats?.size_pretty || index.size || "-";
                  })()}
                </td>
                <td className="px-1.5 py-0.5 border-b border-r text-foreground/70 dark:text-foreground/60 text-xs whitespace-nowrap">
                  {(() => {
                    const stats = usageStats.get(index.name);
                    if (!stats) {
                      return statsLoading ? (
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
                          <span
                            className={`${colorClass} font-medium cursor-help`}
                          >
                            {displayValue}
                          </span>
                        </HoverCardTrigger>
                        <HoverCardContent
                          className="w-auto p-3"
                          side="top"
                          align="end"
                        >
                          <div className="space-y-1.5">
                            <div className="font-semibold text-sm mb-2">
                              Index Usage Statistics
                            </div>
                            {stats.scan_count !== undefined && (
                              <div className="text-xs flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                  Scans:
                                </span>
                                <span className="font-mono">
                                  {stats.scan_count.toLocaleString()}
                                </span>
                              </div>
                            )}
                            {stats.last_used && (
                              <div className="text-xs flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                  Last Used:
                                </span>
                                <span className="font-mono">
                                  {(() => {
                                    const date = new Date(stats.last_used);
                                    const now = new Date();
                                    const diffMs =
                                      now.getTime() - date.getTime();
                                    const diffDays = Math.floor(
                                      diffMs / (1000 * 60 * 60 * 24),
                                    );
                                    const diffHours = Math.floor(
                                      diffMs / (1000 * 60 * 60),
                                    );
                                    const diffMinutes = Math.floor(
                                      diffMs / (1000 * 60),
                                    );

                                    if (diffMinutes < 1) return "Just now";
                                    if (diffMinutes < 60)
                                      return `${diffMinutes}m ago`;
                                    if (diffHours < 24)
                                      return `${diffHours}h ago`;
                                    if (diffDays < 7) return `${diffDays}d ago`;
                                    if (diffDays < 30)
                                      return `${Math.floor(diffDays / 7)}w ago`;
                                    if (diffDays < 365)
                                      return `${Math.floor(
                                        diffDays / 30,
                                      )}mo ago`;
                                    return `${Math.floor(diffDays / 365)}y ago`;
                                  })()}
                                </span>
                              </div>
                            )}
                            {stats.rows_read !== undefined && (
                              <div className="text-xs flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                  Rows Read:
                                </span>
                                <span className="font-mono">
                                  {stats.rows_read.toLocaleString()}
                                </span>
                              </div>
                            )}
                            {stats.cache_hit_ratio !== undefined && (
                              <div className="text-xs flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                  Cache Hit:
                                </span>
                                <span className="font-mono">
                                  {stats.cache_hit_ratio.toFixed(1)}%
                                </span>
                              </div>
                            )}
                            {stats.efficiency_score !== undefined && (
                              <div className="text-xs flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                  Efficiency:
                                </span>
                                <span className="font-mono">
                                  {stats.efficiency_score}/100
                                </span>
                              </div>
                            )}
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    );
                  })()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
});

const TableIndexesSkeleton = memo(function TableIndexesSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
      ))}
    </div>
  );
});
