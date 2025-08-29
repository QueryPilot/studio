import { memo, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, KeyRound, Hash, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { databaseService, type TableIndex } from "@/services/databaseService";

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
  const [isLoading, setIsLoading] = useState(true);
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
          table
        );
        setIndexes(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load indexes");
        console.error("Failed to fetch table indexes:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchIndexes();
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
      <table className="w-full">
        <thead className="sticky top-0 z-10 bg-background border-b">
          <tr className="text-xs font-semibold text-foreground/85 dark:text-foreground/75" style={{ height: "32px" }}>
            <th className="text-left px-1.5 py-0.5 w-8">#</th>
            <th className="text-left px-1.5 py-0.5">Index Name</th>
            <th className="text-left px-1.5 py-0.5">Columns</th>
            <th className="text-left px-1.5 py-0.5">Type</th>
            <th className="text-left px-1.5 py-0.5">Unique</th>
            <th className="text-left px-1.5 py-0.5">Condition</th>
            <th className="text-left px-1.5 py-0.5">Size</th>
          </tr>
        </thead>
        <tbody>
          {indexes.map((index, i) => (
            <tr
              key={index.name}
              className={cn(
                "hover:bg-primary/10 transition-colors text-xs border-b",
                i % 2 === 0 && "bg-muted/10",
              )}
              style={{ height: "28px" }}
            >
              <td className="px-1.5 py-0.5 text-muted-foreground">{i + 1}</td>
              <td className="px-1.5 py-0.5 font-medium text-foreground/80 dark:text-foreground/70">
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
              <td className="px-1.5 py-0.5 text-foreground/80 dark:text-foreground/65 font-mono text-xs">
                {index.columns.join(", ")}
              </td>
              <td className="px-1.5 py-0.5 text-foreground/80 dark:text-foreground/65">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{index.index_type}</span>
                  {index.index_type === "btree" && (
                    <TrendingUp className="h-3 w-3 text-green-600 dark:text-green-500 opacity-70" />
                  )}
                </div>
              </td>
              <td className="px-1.5 py-0.5">
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
              <td className="px-1.5 py-0.5 text-foreground/60 dark:text-foreground/50 text-xs italic">
                -
              </td>
              <td className="px-1.5 py-0.5 text-foreground/70 dark:text-foreground/60 text-xs text-right font-mono">
                -
              </td>
            </tr>
          ))}
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