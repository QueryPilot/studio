import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { databaseService, type TableIndex } from "@/services/databaseService";
import { cn } from "@/lib/utils";

interface TableIndexesProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableIndexes = memo(function TableIndexes({
  connectionId,
  database,
  table,
  schema,
  onActionsChange,
}: TableIndexesProps) {
  const [indexes, setIndexes] = useState<TableIndex[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!onActionsChange) return;
    onActionsChange(null);
    return () => {
      onActionsChange(null);
    };
  }, [onActionsChange]);

  const loadIndexes = useCallback(async () => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load indexes");
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database, schema, table]);

  useEffect(() => {
    void loadIndexes();
  }, [loadIndexes]);

  const hasIndexes = useMemo(() => indexes.length > 0, [indexes.length]);

  if (isLoading) {
    return <TableIndexesSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load indexes</h3>
        <p className="text-sm text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (!hasIndexes) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No indexes defined for this table.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-muted border-b border-border">
            <tr className="text-xs" style={{ height: "28px" }}>
              <HeaderCell className="w-12">#</HeaderCell>
              <HeaderCell className="w-48">Name</HeaderCell>
              <HeaderCell className="w-60">Columns</HeaderCell>
              <HeaderCell className="w-32">Type</HeaderCell>
              <HeaderCell className="w-24">Unique</HeaderCell>
              <HeaderCell className="">Definition</HeaderCell>
            </tr>
          </thead>
          <tbody className="text-xs">
            {indexes.map((index, idx) => (
              <tr
                key={index.name}
                className={cn(
                  "border-b border-border hover:bg-muted/40 transition-colors",
                  index.primary && "bg-muted/20",
                )}
              >
                <Cell className="text-muted-foreground">{idx + 1}</Cell>
                <Cell className="font-medium">
                  {index.name}
                  {index.primary && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-yellow-600">
                      PRIMARY
                    </span>
                  )}
                  {index.unique && !index.primary && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-600">
                      UNIQUE
                    </span>
                  )}
                </Cell>
                <Cell className="font-mono text-[11px]">
                  {index.columns.join(", ")}
                </Cell>
                <Cell>{index.index_type}</Cell>
                <Cell>{index.unique ? "YES" : "NO"}</Cell>
                <Cell className="font-mono text-[11px]">
                  {index.condition || ""}
                </Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground border-t">
        Total indexes: {indexes.length}
        <button
          type="button"
          onClick={() => loadIndexes().catch(() => undefined)}
          className="ml-4 text-primary hover:underline"
        >
          Refresh
        </button>
      </div>
    </div>
  );
});

const HeaderCell = ({ children, className }: { children: ReactNode; className?: string }) => (
  <th
    className={cn(
      "text-left px-2 py-1 border-r border-b border-border font-semibold text-foreground/80",
      className,
    )}
  >
    {children}
  </th>
);

const Cell = ({ children, className }: { children: ReactNode; className?: string }) => (
  <td className={cn("px-2 py-1 border-b border-r border-border", className)}>{children}</td>
);

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

export default TableIndexes;

