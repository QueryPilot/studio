import { IconStack2 } from "@tabler/icons-react";
import { usePartitionsQuery } from "@/hooks/usePartitionsQuery";
import { SidebarItem } from "./DatabaseSidebarItem";
import { DbType } from "@/types/connection";
import { Skeleton } from "@/components/ui/skeleton";

interface PartitionSubTreeProps {
  connectionId: string;
  schema: string;
  tableName: string;
  dbType: DbType;
  onPartitionClick: (partitionName: string, schema: string) => void;
  isPartitionActive?: (partitionName: string, schema: string) => boolean;
}

/**
 * Renders partition items as a sub-tree under a partitioned table.
 * Fetches partitions on-demand when the parent table is expanded.
 */
export function PartitionSubTree({
  connectionId,
  schema,
  tableName,
  dbType,
  onPartitionClick,
  isPartitionActive,
}: PartitionSubTreeProps) {
  const { partitions, isLoading, error, hasPartitions } = usePartitionsQuery({
    connectionId,
    schema,
    table: tableName,
    dbType,
    enabled: true,
  });

  if (isLoading) {
    return (
      <div className="ml-6 space-y-1 py-1">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-28" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="ml-6 py-1">
        <span className="text-xs text-destructive">{error}</span>
      </div>
    );
  }

  if (!hasPartitions) {
    return (
      <div className="ml-6 py-1">
        <span className="text-xs text-muted-foreground">
          No partitions found
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {partitions.map((partition) => (
        <SidebarItem
          key={partition.partition_name}
          icon={
            <IconStack2 className="h-3.5 w-4 min-w-4 text-muted-foreground shrink-0" />
          }
          name={partition.partition_name}
          isActive={
            isPartitionActive?.(partition.partition_name, schema) ?? false
          }
          onClick={() => onPartitionClick(partition.partition_name, schema)}
          rowCount={partition.table_rows}
          level={1}
        />
      ))}
    </div>
  );
}
