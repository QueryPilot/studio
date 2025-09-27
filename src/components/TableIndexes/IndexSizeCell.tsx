import { memo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { type IndexUsageStats } from "@/services/backend";

interface IndexSizeCellProps {
  indexName: string;
  size?: string;
  usageStats?: Map<string, IndexUsageStats>;
  isLoading?: boolean;
}

export const IndexSizeCell = memo(function IndexSizeCell({
  indexName,
  size,
  usageStats,
  isLoading = false,
}: IndexSizeCellProps) {
  const stats = usageStats?.get(indexName);
  const displaySize = stats?.size_pretty || size || "-";

  if (isLoading) {
    return <Skeleton className="h-4 w-16 inline-block" />;
  }

  return (
    <span className="font-mono text-xs text-foreground/70 dark:text-foreground/60">
      {displaySize}
    </span>
  );
});